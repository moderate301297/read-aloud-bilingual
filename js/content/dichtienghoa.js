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
