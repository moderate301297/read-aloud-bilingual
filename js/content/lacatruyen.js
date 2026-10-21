
// lacatruyen.homes — Next.js reader with aggressive anti-scraping: the chapter text is
// AES-encrypted (keys rotate server-side, so reproducing the decryption is not durable),
// the DOM is populated with invisible decoy <p data-decoy> paragraphs, and real
// paragraphs are only un-scrambled by the site once they are scrolled near the viewport.
//
// So reading the DOM in one shot yields a mix of scrambled/decoy text. Instead we drive
// the site's own un-scrambling: scroll each real paragraph into view, let the site reveal
// it, then capture its text. This is slower but immune to whatever crypto/scramble the
// site changes.

var readAloudDoc = new function() {
  var cachedTexts = null   // Promise<string[]>

  this.getCurrentIndex = function() {
    return 0
  }

  this.getTexts = function(index) {
    if (index != 0) return null
    if (!cachedTexts) cachedTexts = readChapter()
    return cachedTexts
  }

  this.getNextPageUrl = function() {
    var slug = inlineChapterRightSlug()
    if (slug) return location.origin + "/chapter/" + slug
    var next = document.querySelector('a[rel="next"]')
    return next ? next.href : null
  }


  function wait(ms) {
    return new Promise(function(r) { setTimeout(r, ms) })
  }

  function inlineChapterRightSlug() {
    try {
      var data = JSON.parse(document.getElementById("__NEXT_DATA__").textContent)
      var right = data.props.pageProps.chapterRight
      return right && right.slug ? right.slug : null
    }
    catch (e) {
      return null
    }
  }

  async function readChapter() {
    var container = document.querySelector(".chapter-content-element")
    if (!container) return domHeadingOnly()

    var paras = Array.from(container.querySelectorAll("p")).filter(isReal)

    var texts = []
    var h1 = document.querySelector("h1")
    if (h1 && h1.innerText.trim()) texts.push(h1.innerText.trim())

    var savedY = window.scrollY
    for (var i = 0; i < paras.length; i++) {
      var t = await revealAndRead(paras[i])
      if (t) texts.push(t)
    }
    window.scrollTo(0, savedY)

    return texts.length ? texts : domHeadingOnly()
  }

  // Scroll a paragraph into view and wait until its text stops changing (the site swaps
  // the scrambled spans for real text once it's revealed), then return the cleaned text.
  async function revealAndRead(p) {
    p.scrollIntoView({ block: "center", behavior: "instant" })
    var prev = null
    for (var i = 0; i < 10; i++) {          // up to ~300ms per paragraph
      await wait(30)
      var cur = p.innerText
      if (cur && cur === prev) break        // stabilised
      prev = cur
    }
    return (prev || "").replace(/\s+/g, " ").trim()
  }

  // A "real" paragraph: not a decoy, actually visible, and has text.
  function isReal(p) {
    if (p.getAttribute("data-decoy") === "true") return false
    var style = window.getComputedStyle(p)
    if (style.display === "none" || style.visibility === "hidden") return false
    if (parseFloat(style.opacity) < 0.01) return false
    if (parseFloat(style.fontSize) < 1) return false
    // decoys are parked far off-screen (left: -99999px)
    var rect = p.getBoundingClientRect()
    if (rect.left < -9999 || rect.width < 1) return false
    return true
  }

  function domHeadingOnly() {
    var h1 = document.querySelector("h1")
    var h = h1 ? h1.innerText.trim() : ""
    return h ? [h] : null
  }
}
