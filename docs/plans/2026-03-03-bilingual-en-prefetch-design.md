# Bilingual EN Prefetch Design

**Date:** 2026-03-03
**File:** `js/document.js` → `readBilingualTexts()`

## Problem

In bilingual mode ("Gốc+EN"), translation and EN audio synthesis only start **after** the Gốc chunk finishes playing, causing a noticeable gap:

```
Gốc plays → [Gốc ends] → translateTexts() → getSpeech(EN) → EN plays
                          ↑ delay ~1–2.5s here
```

## Goal

Fire EN prefetch (translate + synthesize) in background while Gốc is still playing, so EN is ready (or nearly ready) by the time Gốc ends.

```
Gốc plays ──────────────────────────────────→ [Gốc ends] → EN plays (no gap)
           └→ translateTexts() → getSpeech(EN) [background]
```

## Solution

In `readBilingualTexts()`, fire `enSpeechPromise` immediately before calling `activeSpeech.play()` for Gốc. When Gốc ends, `await` the already-in-flight promise instead of starting fresh.

**Why this works:** Non-legacy TTS engines (Premium, GoogleTranslate, Azure, etc.) begin fetching the audio URL immediately when `engine.speak()` is called inside the `Speech` constructor. The audio is cached and playback only starts when `.play()` is explicitly called.

## Code Change

Only `readBilingualTexts` in `js/document.js` is modified (~5–8 lines net change).

**Before:**
```js
activeSpeech.onEnd = function(err) {
  activeSpeech = null
  translateTexts(chunk)
    .then(async function(translatedTexts) {
      activeSpeech = await getSpeech(translatedTexts, "english")
      // ...
    })
}
return activeSpeech.play()
```

**After:**
```js
// Fire EN prefetch immediately — do not await
const enSpeechPromise = translateTexts(chunk)
  .then(translatedTexts => getSpeech(translatedTexts, "english"))
  .catch(err => { console.error("[Bilingual] EN prefetch error:", err); return null })

activeSpeech.onEnd = function(err) {
  activeSpeech = null
  enSpeechPromise  // already in-flight, likely resolved
    .then(async function(enSpeech) {
      if (!enSpeech) throw new Error("EN prefetch failed")
      activeSpeech = enSpeech
      // ...
    })
}
return activeSpeech.play()  // Gốc starts, EN is being prefetched
```

## Edge Cases

| Scenario | Handling |
|---|---|
| User stops during Gốc | EN Speech object abandoned; audio blob evicted by FIFO cache (max 5 entries) |
| User forward/skip during Gốc | Prefetch wasted but harmless |
| Translation fails | `catch` returns `null`; `onEnd` throws, falls through to skip EN (same as current) |
| EN synthesis fails | Same — skip EN, continue to next chunk |
| `playbackState` paused | Prefetch fires before `wait()` check in `onEnd`, so not blocked by user pause |

## Scope

- **Only file changed:** `js/document.js`
- **Only function changed:** `readBilingualTexts`
- No changes to `Speech` class, TTS engines, or cache
