# Bilingual EN Chunk — Proper TTS Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the inline `SpeechSynthesisUtterance` EN reading in bilingual mode with a `getSpeech()` call so the EN chunk supports highlight tracking, pause, forward, and rewind.

**Architecture:** In `js/document.js`, the `read()` function's `activeSpeech.onEnd` bilingual branch is replaced: after translation, call `getSpeech(translatedTexts, "english")` to get a full `Speech` object, assign it to `activeSpeech`, wire its `onEnd`, and call `play()`. All other code is untouched.

**Tech Stack:** Vanilla JS, RxJS, Chrome extension APIs (already in place).

---

### Task 1: Replace bilingual EN branch in `read()`

**Files:**
- Modify: `js/document.js:204-256`

**Step 1: Read the current bilingual branch**

Open `js/document.js` and locate the `activeSpeech.onEnd` assignment inside `read()` (around line 204). The `if (isBilingual)` branch spans roughly lines 210–248 and contains a `translateTexts(...).then(...)` call that builds a `SpeechSynthesisUtterance`.

**Step 2: Replace the bilingual branch**

Replace the entire `if (isBilingual) { ... } else { ... }` block inside `activeSpeech.onEnd` with:

```javascript
activeSpeech.onEnd = function(err) {
  if (err) {
    if (onEnd) onEnd(err);
  }
  else {
    activeSpeech = null;
    if (isBilingual) {
      translateTexts(texts)
        .then(async function(translatedTexts) {
          activeSpeech = await getSpeech(translatedTexts, "english")
          activeSpeech.onEnd = function(err) {
            if (err) {
              if (onEnd) onEnd(err)
            } else {
              activeSpeech = null
              currentIndex++
              readCurrent().catch(function(err) { if (onEnd) onEnd(err) })
            }
          }
          return activeSpeech.play()
        })
        .catch(function(err) {
          console.error("[Bilingual] EN error, skipping:", err)
          activeSpeech = null
          currentIndex++
          readCurrent().catch(function(err2) { if (onEnd) onEnd(err2) })
        })
    } else {
      currentIndex++;
      readCurrent()
        .catch(function(err) {
          if (onEnd) onEnd(err)
        })
    }
  }
};
```

Key differences from the old code:
- No `SpeechSynthesisUtterance`, no `speechSynthesis.cancel()`, no manual `stopped` flag
- `getSpeech(translatedTexts, "english")` auto-selects an English voice and returns a full `Speech` object
- `activeSpeech.onEnd` for the EN speech follows the same pattern as the normal (non-bilingual) path
- Error path still skips EN and advances `currentIndex`

**Step 3: Manual test — bilingual mode plays EN with highlight**

1. Load the extension in Chrome (`chrome://extensions` → Load unpacked)
2. Open any Vietnamese web page with text
3. Open popup → click "Gốc" button to switch to "Gốc+EN" mode
4. Press Play
5. Verify:
   - Original chunk reads and highlights correctly (unchanged)
   - After original finishes, EN translation starts automatically
   - Highlight panel updates during EN reading
   - Pause button pauses the EN reading
   - Play/resume resumes it
   - After EN finishes, next chunk's original starts

**Step 4: Manual test — error path**

1. Disable network (DevTools → Network → Offline)
2. Play in bilingual mode
3. Verify: after original finishes, EN is skipped silently and the next chunk's original starts

**Step 5: Manual test — stop during EN**

1. Play in bilingual mode; wait for EN chunk to start
2. Click Stop
3. Verify: playback stops immediately and state returns to STOPPED

**Step 6: Commit**

```bash
git add js/document.js
git commit -m "Replace SpeechSynthesisUtterance with getSpeech() for bilingual EN chunk"
```
