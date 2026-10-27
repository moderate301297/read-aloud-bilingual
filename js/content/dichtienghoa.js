// Loaded after html-doc.js — inherits its getNextPageUrl (chapter IDs on
// dichtienghoa.net are sequential, so the generic last-segment increment works).
//
// dichtienghoa.net wraps EVERY word in its own <i> tag (word-by-word Hán–Việt
// lookup). The generic parser drops to its low threshold and treats each <i> as
// a separate paragraph, so playback shatters into one-word "lines". This handler
// reads the whole .chapter-body via innerText — which concatenates the <i> words
// back into full Vietnamese sentences — and splits paragraphs on the <br><br>
// the site uses between them.

readAloudDoc.getCurrentIndex = function() {
  return 0
}

// The inherited generic getNextPageUrl (html-doc.js) applies heuristics across
// the WHOLE URL: a greedy /(chuong|chapter|c)[-_]?\d+/ match and broad "next"
// selectors. On dichtienghoa those jump to UNRELATED novels — the bare `c\d+`
// branch can increment a digit buried in the novel's slug, and sidebar
// "đề cử" / slider links get mistaken for the next-chapter link.
//
// Override with a next-link that is guaranteed to stay inside THIS novel:
// accept a candidate only if it shares the current novel's path prefix, and
// otherwise increment the number in the LAST path segment only.
readAloudDoc.getNextPageUrl = function() {
  var here = location.pathname.replace(/\/+$/, "")
  var parts = here.split("/")
  var lastSeg = parts[parts.length - 1]
  var novelPrefix = parts.slice(0, -1).join("/")   // path without the chapter id

  // A candidate is valid only if it stays on this host AND keeps the same
  // novel prefix (differing only in the trailing chapter segment).
  function sameNovel(href) {
    try {
      var u = new URL(href, location.href)
      if (u.host !== location.host) return false
      var p = u.pathname.replace(/\/+$/, "")
      return p !== here && p.indexOf(novelPrefix + "/") === 0
    } catch (e) {
      return false
    }
  }

  // 1. The site's real next-chapter button/link — chapter-nav specific only.
  var selectors = [
    'a[rel="next"]',
    "a.next-chap", "a.next_chapter", "a.next-chapter", "a.chapter-next",
    'a[title*="Chương sau" i]', 'a[title*="Chương tiếp" i]',
    'a[aria-label*="next" i]',
  ]
  for (var i = 0; i < selectors.length; i++) {
    var el = document.querySelector(selectors[i])
    if (el && el.href && sameNovel(el.href)) return el.href
  }

  // 2. Anchor whose visible text is a next-chapter label — same novel only.
  var labelRe = /(chương\s*)?(tiếp|sau)\b|next\s*chapter|»|→/i
  var anchors = document.querySelectorAll("a[href]")
  for (var j = 0; j < anchors.length; j++) {
    var a = anchors[j]
    var txt = (a.textContent || "").trim()
    if (txt && txt.length <= 30 && labelRe.test(txt) && sameNovel(a.href)) return a.href
  }

  // 3. Fallback: increment the number in the LAST path segment only. Confining
  // this to the final segment (never the whole URL) keeps us inside this novel.
  // Handles 123, chuong-123, chapter-123, c-123, 123.html, etc.
  var m = lastSeg.match(/^(.*?)(\d+)(\D*)$/)
  if (m) {
    parts[parts.length - 1] = m[1] + (parseInt(m[2], 10) + 1) + m[3]
    return location.protocol + "//" + location.host + parts.join("/") + location.search
  }

  return null
}

readAloudDoc.getTexts = async function(index) {
  if (index != 0) return null

  // dichtienghoa.net is a Vue SPA — after auto-next navigation the chapter body
  // renders asynchronously. Wait until it's fully loaded and stable (up to 45s)
  // before reading, so we never grab partial content and rapid-fire to the next
  // chapter. Falls back to a direct query if the shared helper isn't present.
  var container = readAloudDoc.waitForStableText
    ? await readAloudDoc.waitForStableText([".chapter-body", ".chapter-content"], {minLen: 100, maxWaitMs: 45000})
    : (document.querySelector(".chapter-body") || document.querySelector(".chapter-content"))
  if (!container || !container.innerText || container.innerText.trim().length < 50) return null

  var texts = []

  // Chapter title
  var heading = document.querySelector(".chapter-title, h1, h2")
  if (heading) {
    var headingText = (heading.innerText || "").trim()
    if (headingText) texts.push(headingText)
  }

  // innerText renders each <i> word as visible text and <br><br> as blank lines.
  // Split on blank lines into paragraphs, collapse the rest of the whitespace.
  container.innerText.split(/\n{2,}/).forEach(function(block) {
    var t = block.replace(/\s+/g, " ").trim()
    if (t) texts.push(t)
  })

  return texts.filter(isNotEmpty)
}
