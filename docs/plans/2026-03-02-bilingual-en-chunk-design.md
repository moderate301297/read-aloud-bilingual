# Bilingual EN Chunk — Use Proper TTS Engine

**Date:** 2026-03-02

## Problem

In bilingual mode (`readMode === "english"`), after the original chunk finishes the EN
translation is read using `SpeechSynthesisUtterance` directly. This means:

- No highlight tracking during EN playback
- Pause / forward / rewind do not work during the EN part
- Uses browser default voice, not the configured TTS engine

## Goal

Replace the inline `SpeechSynthesisUtterance` code with a call to `getSpeech()`, so the
EN chunk behaves identically to the original chunk (highlight, pause, forward, rewind,
TTS engine all work).

## Design

**File changed:** `js/document.js` — `read()` function only.

**Current bilingual flow:**
1. `getSpeech(texts, "original")` → play original chunk
2. `activeSpeech.onEnd` → translate texts → create `SpeechSynthesisUtterance` → speak

**New bilingual flow:**
1. `getSpeech(texts, "original")` → play original chunk  (unchanged)
2. `activeSpeech.onEnd` →
   - `translateTexts(texts)` (unchanged helper)
   - `getSpeech(translatedTexts, "english")` — auto-selects EN voice, creates full `Speech` object
   - assign to `activeSpeech`
   - set `activeSpeech.onEnd` → `currentIndex++; readCurrent()`
   - `activeSpeech.play()`

**Error handling:** if translation fails, skip EN and continue to `currentIndex++; readCurrent()`.

**No other files change.** Popup, settings, voice selection, popup.html, CSS are untouched.

## Why `getSpeech(translatedTexts, "english")` works

`getSpeech` with `readMode === "english"` already:
- sets `lang = "en-US"`
- passes `voiceName = null` so voice is auto-selected for English
- returns a `Speech` object with full chunk/highlight/pause support
