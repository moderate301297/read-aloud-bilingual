# Bilingual EN Prefetch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preload EN translation + audio synthesis while the Gốc chunk is playing, eliminating the gap between Gốc ending and EN starting.

**Architecture:** In `readBilingualTexts()`, fire `enSpeechPromise = translateTexts(chunk).then(getSpeech(...))` immediately before calling `activeSpeech.play()` for Gốc. The `onEnd` handler then awaits this already-in-flight promise instead of starting fresh. Non-legacy TTS engines begin fetching audio URLs immediately inside the `Speech` constructor, so synthesis runs in parallel with Gốc playback.

**Tech Stack:** Vanilla JS, RxJS (bundled), Chrome Extension MV3, no test framework.

---

### Task 1: Replace sequential EN load with parallel prefetch

**File to modify:** `js/document.js:229–272`

**Context — current code (lines 229–272):**
```js
async function readBilingualTexts(texts, textIndex, rewinded) {
  while (textIndex < texts.length && !texts[textIndex]) textIndex++
  if (textIndex >= texts.length) {
    currentIndex++
    return readCurrent()
  }
  await wait(playbackState, "resumed")
  if (activeSpeech) return
  const chunk = [texts[textIndex]]
  activeSpeech = await getSpeech(chunk, "original")
  patchBilingualGetInfo(activeSpeech, texts, textIndex)
  await wait(playbackState, "resumed")
  activeSpeech.onEnd = function(err) {
    if (err) {
      if (onEnd) onEnd(err)
    } else {
      activeSpeech = null
      translateTexts(chunk)
        .then(async function(translatedTexts) {
          activeSpeech = await getSpeech(translatedTexts, "english")
          patchBilingualGetInfo(activeSpeech, texts, textIndex)
          await wait(playbackState, "resumed")
          activeSpeech.onEnd = function(err) {
            if (err) {
              if (onEnd) onEnd(err)
            } else {
              activeSpeech = null
              readBilingualTexts(texts, textIndex + 1)
                .catch(function(err) { if (onEnd) onEnd(err) })
            }
          }
          return activeSpeech.play()
        })
        .catch(function(err) {
          console.error("[Bilingual] EN error, skipping:", err)
          activeSpeech = null
          readBilingualTexts(texts, textIndex + 1)
            .catch(function(err2) { if (onEnd) onEnd(err2) })
        })
    }
  }
  if (rewinded && textIndex === 0) await activeSpeech.gotoEnd()
  return activeSpeech.play()
}
```

**Step 1: Apply the change**

Replace the entire function body with the version below. The only structural change is:
- Add `enSpeechPromise` fired right after the second `await wait(playbackState, "resumed")` line (before `activeSpeech.onEnd` is assigned)
- In `onEnd`, replace `translateTexts(chunk).then(...)` with `enSpeechPromise.then(...)`

```js
async function readBilingualTexts(texts, textIndex, rewinded) {
  while (textIndex < texts.length && !texts[textIndex]) textIndex++
  if (textIndex >= texts.length) {
    currentIndex++
    return readCurrent()
  }
  await wait(playbackState, "resumed")
  if (activeSpeech) return
  const chunk = [texts[textIndex]]
  activeSpeech = await getSpeech(chunk, "original")
  patchBilingualGetInfo(activeSpeech, texts, textIndex)
  await wait(playbackState, "resumed")

  // Fire EN prefetch in background while Gốc plays
  const enSpeechPromise = translateTexts(chunk)
    .then(function(translatedTexts) { return getSpeech(translatedTexts, "english") })
    .catch(function(err) {
      console.error("[Bilingual] EN prefetch error:", err)
      return null
    })

  activeSpeech.onEnd = function(err) {
    if (err) {
      if (onEnd) onEnd(err)
    } else {
      activeSpeech = null
      enSpeechPromise
        .then(async function(enSpeech) {
          if (!enSpeech) throw new Error("EN prefetch failed")
          activeSpeech = enSpeech
          patchBilingualGetInfo(activeSpeech, texts, textIndex)
          await wait(playbackState, "resumed")
          activeSpeech.onEnd = function(err) {
            if (err) {
              if (onEnd) onEnd(err)
            } else {
              activeSpeech = null
              readBilingualTexts(texts, textIndex + 1)
                .catch(function(err) { if (onEnd) onEnd(err) })
            }
          }
          return activeSpeech.play()
        })
        .catch(function(err) {
          console.error("[Bilingual] EN error, skipping:", err)
          activeSpeech = null
          readBilingualTexts(texts, textIndex + 1)
            .catch(function(err2) { if (onEnd) onEnd(err2) })
        })
    }
  }
  if (rewinded && textIndex === 0) await activeSpeech.gotoEnd()
  return activeSpeech.play()
}
```

**Step 2: Verify in browser**

1. Load extension in Chrome (`chrome://extensions` → Load unpacked)
2. Open a Vietnamese webpage, activate Read Aloud
3. Enable bilingual mode (click "Gốc" button → becomes "Gốc+EN")
4. Play — observe: after each Gốc chunk, EN should follow with **no/minimal pause**
5. Open DevTools Console, confirm logs:
   - `[Bilingual] EN prefetch error:` should NOT appear (no errors)
   - No unhandled promise rejections

**Step 3: Test edge cases manually**

- **Stop during Gốc playback:** press Stop → verify no errors in console
- **Forward/Skip during Gốc:** press Forward → verify continues to next chunk correctly
- **Pause during Gốc, then Resume:** verify EN still plays after resume
- **Short Gốc chunk (EN might not be ready yet):** verify EN still plays (just with small delay from `await enSpeechPromise`)
- **Translation fails (disable network):** verify skips EN and continues to next Gốc chunk

**Step 4: Commit**

```bash
git add js/document.js
git commit -m "prefetch EN translation+audio while Gốc chunk is playing"
```
