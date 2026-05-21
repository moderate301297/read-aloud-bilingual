# Read Aloud — Bilingual Fork

Chrome extension for reading Vietnamese web novels with bilingual VN–EN mode. Fork of [Read Aloud](https://github.com/ken107/read-aloud) with customizations for Vietnamese web novel reading.

---

## Features

### Read Modes

| Button | Mode | Behavior |
|--------|------|----------|
| **Original+EN** | Bilingual | Reads each VN sentence → translates and reads EN → next sentence |
| **Original** | Original | Reads source text only, highlights each sentence, no translation |

### Bilingual (Original+EN)
- Each sentence is split and read individually (VN first, then EN)
- Auto-translation via Google Translate / Gemini API
- Prefetches 8 chunks ahead to eliminate loading delays
- EN translation shown inline below the current highlight

### Original
- Highlights each sentence per paragraph
- No translation API calls, no EN frame
- Faster; suitable when content is already familiar

### Auto-next Chapter
Toggle the **⏭** button in the toolbar: when a chapter finishes, the extension automatically navigates to the next chapter and begins reading without pressing Play again.

### UI
- Dark mode toggle
- Adjustable font size and window size
- Highlighted active sentence with word-level marking

---

## webnovel.vn Support

Dedicated handler `js/content/webnovel-vn.js` handles two HTML structures:

**Free chapters** (`<br><br>` based)
- Walks DOM manually, skips ad divs (`ins.adsbygoogle`)
- Checks CSS visibility to skip hidden elements

**Paid / unlocked chapters** (`<P display:flex>` + `<SPAN>` children)
- Auto-detected via `<p>` element count
- Each `<p>` = one paragraph
- Child SPANs sorted by CSS `order` value then visual position (`getBoundingClientRect`) to undo the site's CSS flex-order scrambling

**Auto-next chapter**: reads `a[rel="next"]` for the next chapter URL.

---

## Installation (Load Unpacked)

1. Clone this repo or download ZIP
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** → point to this folder

> Not yet published on the Chrome Web Store.

---

## Project Structure

```
js/
├── content.js              # Content script entry, routes sites to handlers
├── document.js             # Doc/Tab source, bilingual + original chunk logic
├── speech.js               # TTS engine wrapper, chunk playlist
├── player.js               # Playback control (play/pause/stop/forward/rewind)
├── popup.js                # Popup UI, highlighting, translate popup
├── tts-engines.js          # TTS engine adapters (browser, Google, AWS, Azure...)
└── content/
    ├── webnovel-vn.js      # webnovel.vn — VN novel site handler
    ├── tiemtruyenchu.js    # tiemtruyenchu.com handler
    ├── html-doc.js         # Generic HTML fallback
    └── ...                 # Other site-specific handlers
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Alt+P` | Play / Pause |
| `Alt+O` | Play / Stop |
| `Alt+,` | Rewind |
| `Alt+.` | Forward |

---

## Adding a Handler for a New Site

1. Create `js/content/your-site.js`:

```javascript
var readAloudDoc = new function() {
  this.getCurrentIndex = function() { return 0 }

  this.getTexts = function(index) {
    if (index == 0) return parse()
    return null
  }

  // Optional: required for auto-next chapter
  this.getNextPageUrl = function() {
    var next = document.querySelector('a[rel="next"]')
    return next ? next.href : null
  }

  function parse() {
    var container = document.querySelector('#your-content-selector')
    if (!container) return null
    // return array of paragraph strings
  }
}
```

2. Register in `js/content.js`:

```javascript
else if (location.hostname == "your-site.com") return ["js/content/your-site.js"];
```

---

## Upstream

Fork of [ken107/read-aloud](https://github.com/ken107/read-aloud) — MIT License.
