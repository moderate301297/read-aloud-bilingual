# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Manifest V3 Chrome extension for reading Vietnamese web novels with bilingual VN–EN mode. Fork of [ken107/read-aloud](https://github.com/ken107/read-aloud). No build step — all files are loaded directly as unpacked extension.

## Development

```bash
# Package the extension for submission
npm run package   # produces build/package.zip
```

**Testing**: Load unpacked via `chrome://extensions` (Developer mode → Load unpacked → point to repo root). No test suite — test manually in Chrome.

**Version** is tracked in two places and must stay in sync: `manifest.json` (`version`) and `package.json` (`version`).

## Architecture

The extension has three execution contexts:

| Context | Entry | Role |
|---|---|---|
| Service Worker | `background.js` | Orchestrates playback, IPC hub, keep-alive strategy |
| Content Script | `js/content.js` | Injected into tabs; selects & runs the right site handler |
| Player Page | `player.html` + `js/player.js` | Embedded iframe rendered in the tab for playback controls and highlighting |

**Message passing** flows through `js/messaging.js` using `brapi` (Chrome/Firefox polyfill defined in `js/defaults.js`).

### Core JS Files

- `js/defaults.js` — `brapi` wrapper, global `config`, default settings
- `js/events.js` — Service worker IPC handlers (play, pause, stop, forward, rewind, seek, auto-next chapter logic)
- `js/document.js` — `TabSource` and `SimpleSource` — abstractions over content script / text-selection sources; handles auto-next chapter navigation
- `js/speech.js` — `Speech` class: chunk splitting, engine selection, RxJS-driven playback pipeline
- `js/tts-engines.js` — TTS engine adapters: browser, Google Translate, Google Wavenet, Amazon Polly, Azure, OpenAI, Piper, Supertonic, IBM Watson, phone, premium
- `js/content.js` — Content script entry: maps `location.hostname` to the correct site handler script(s)
- `js/content-handlers.js` — Service worker–side URL-to-handler routing (PDF, Google Docs, Google Play Books, etc.)
- `js/popup.js` — Popup UI, sentence highlighting, inline translation display
- `js/player.js` — Player iframe: playback controls, progress, dark mode, bilingual mode toggle

### Site Handlers (`js/content/`)

Each handler exposes a `readAloudDoc` object with:
- `getCurrentIndex()` — returns current paragraph index
- `getTexts(index)` — returns array of paragraph strings (or `null` at end)
- `getNextPageUrl()` — (optional) returns next chapter URL for auto-next

Vietnamese-specific handlers:
- `webnovel-vn.js` — handles both free chapters (`<br><br>` DOM walking) and paid chapters (CSS flex-order scrambling via `getBoundingClientRect` sort)
- `tiemtruyenchu.js` — tiemtruyenchu.com
- `truyendich.js` — truyendich.ai (used alongside `html-doc.js`)
- `html-doc.js` — generic fallback for standard HTML pages

### Bilingual Mode

Bilingual (Original+EN) is implemented in `js/document.js` / `js/player.js`:
1. Each VN sentence is read first
2. Then translated (Google Translate or Gemini API) and read in EN
3. 8 chunks prefetched ahead to eliminate translation latency
4. EN translation displayed inline below the highlighted VN sentence

### Keep-Alive Strategy (Service Worker)

MV3 service workers can be killed mid-playback. Two mechanisms in `js/events.js`:
1. `chrome.alarms` fires every 20 s to wake the SW
2. Long-lived port (`keepAlive`) from the player tab blocks termination while open

## Adding a Site Handler

1. Create `js/content/your-site.js` exposing `var readAloudDoc = new function() { ... }`
2. Register in `js/content.js` inside `getRequireJs()`:
   ```javascript
   else if (location.hostname == "your-site.com") return ["js/content/your-site.js"];
   ```

## Localization

String keys live in `_locales/`. UI strings are referenced via `__MSG_key__` in HTML and `brapi.i18n.getMessage(key)` in JS.
