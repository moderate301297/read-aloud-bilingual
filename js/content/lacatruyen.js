
// lacatruyen.homes — Next.js reader with aggressive anti-scraping: the chapter text is
// AES-encrypted (keys rotate server-side, so reproducing the decryption is not durable),
// the DOM is seeded with invisible decoy <p data-decoy> paragraphs, and a real paragraph is
// only un-scrambled by the site once it is scrolled near the viewport.
//
// Strategy — reveal the WHOLE chapter up front, one paragraph at a time, while the tab is
// still foreground (the user just opened/played it), then read from the captured text:
//   * Scroll EACH real paragraph to the centre of the viewport so it lands squarely in the
//     site's decrypt zone, then poll its text until it changes away from the scrambled
//     snapshot and settles. Centring every paragraph (rather than stepping by half a screen)
//     is what makes this reliable — a half-viewport sweep leaves some paragraphs only partly
//     on screen, so they never decrypt and come back as scrambled "lộn từ" text.
//   * A paragraph revealed as a side effect of a neighbour's scroll is taken immediately.
//
// Everything is revealed before playback begins, so reading never triggers a reveal — which
// means correctness does not depend on the tab staying foreground during playback (on Kiwi
// the novel tab gets suspended the moment the user switches away, and a suspended tab can't
// un-scramble anything).

var readAloudDoc = new function() {
  var cached = null   // { href, promise } — chapter text, keyed by URL so auto-next rebuilds

  this.getCurrentIndex = function() {
    return 0
  }

  this.getTexts = function(index) {
    if (index !== 0) return null
    // Key the cache by URL: after auto-next the tab is on a new chapter, so a stale cache
    // (or a lingering previous-chapter DOM) must not be reused — rebuild for the new URL.
    if (!cached || cached.href !== location.href) {
      cached = { href: location.href, promise: readChapter() }
    }
    return cached.promise
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

  function clean(s) {
    return (s || "").replace(/\s+/g, " ").trim()
  }

  function headingText() {
    var h1 = document.querySelector("h1")
    return h1 && h1.innerText.trim() ? h1.innerText.trim() : null
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
    var container = await waitForContent()
    if (!container) return domHeadingOnly()

    var paras = Array.from(container.querySelectorAll("p")).filter(isReal)

    // Snapshot each paragraph's initial (mostly scrambled) text BEFORE scrolling, so
    // revealAndRead can tell "still scrambled" from "the site swapped in the real text".
    var snapshot = paras.map(function(p) { return clean(p.innerText) })

    var texts = []
    var h = headingText()
    if (h) texts.push(h)

    var savedY = window.scrollY
    for (var i = 0; i < paras.length; i++) {
      var t = await revealAndRead(paras[i], snapshot[i])
      if (t) texts.push(t)
    }
    window.scrollTo(0, savedY)

    return texts.length ? texts : domHeadingOnly()
  }

  // Reveal a single paragraph and return its real (un-scrambled) text. Centre it in the
  // viewport, then poll innerText until it has changed away from the scrambled snapshot AND
  // settled. We must NOT accept text still equal to the snapshot — on slow reveals the
  // scrambled text sits unchanged for a bit and would be grabbed as the jumbled "lộn từ"
  // output. A paragraph genuinely un-scrambled from the start never changes and falls through
  // to return its (real) snapshot after the budget.
  async function revealAndRead(p, scrambled) {
    var cur = clean(p.innerText)
    if (cur && cur !== scrambled) return cur   // already revealed (e.g. by a neighbour's scroll)

    p.scrollIntoView({ block: "center", behavior: "instant" })

    var prev = clean(p.innerText)
    for (var i = 0; i < 40; i++) {             // ~1.2s budget; resolves in a few polls once revealed
      await wait(30)
      cur = clean(p.innerText)
      if (cur && cur !== scrambled && cur === prev) return cur   // revealed + settled
      prev = cur
    }
    return prev || scrambled
  }

  // Wait until the chapter container exists and its text has rendered and stopped changing.
  // After auto-next the new page may still be hydrating (Next.js renders the body AFTER the
  // load 'complete' event the service worker waits on); reading too early grabs an empty or
  // stale container — which is why playback was re-reading nothing / the old chapter.
  function waitForContent() {
    var minLen = 200, maxWaitMs = 20000, pollMs = 250, stableNeeded = 2, absTol = 12
    return new Promise(function(resolve) {
      var deadline = Date.now() + maxWaitMs
      var lastLen = -1, stable = 0
      ;(function poll() {
        var el = document.querySelector(".chapter-content-element")
        var len = el ? clean(el.innerText).length : 0
        var tol = Math.max(absTol, Math.floor(len * 0.01))
        if (len >= minLen && lastLen >= 0 && Math.abs(len - lastLen) <= tol) {
          if (++stable >= stableNeeded) return resolve(el)
        } else {
          stable = 0
        }
        lastLen = len
        if (Date.now() >= deadline) return resolve(el)
        setTimeout(poll, pollMs)
      })()
    })
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
    var h = headingText()
    return h ? [h] : null
  }
}
