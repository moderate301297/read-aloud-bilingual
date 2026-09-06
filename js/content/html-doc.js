
var readAloudDoc = new function() {
  var self = this;

  this.ignoreTags = "select, textarea, button, label, audio, video, dialog, embed, menu, nav, noframes, noscript, object, script, style, svg, aside, footer, #footer, .no-read-aloud, [aria-hidden=true]";

  this.getCurrentIndex = function() {
    return 0;
  }

  // Auto-next lands on a fresh URL, but SPA sites (Vue/React) render the chapter
  // body asynchronously AFTER the page 'complete' event. If getTexts runs before
  // that, it grabs an empty/partial container, the (tiny) text finishes reading
  // instantly, and auto-next fires again — chaining through chapters at speed.
  //
  // Poll the container until its visible text is substantial AND stable
  // (unchanged across consecutive polls = rendering has settled), capped by
  // maxWaitMs. Resolves with the element once ready, or null if the content
  // never materializes (caller then reports "no text" instead of chaining).
  this.waitForStableText = function(selectors, opts) {
    opts = opts || {};
    var sels = [].concat(selectors);
    var minLen = opts.minLen || 200;
    var maxWaitMs = opts.maxWaitMs || 45000;
    var stableNeeded = opts.stableNeeded || 2;
    var pollMs = opts.pollMs || 300;
    // Requiring the length to be EXACTLY equal between polls is too strict: sites
    // like dichtienghoa.net wrap each word in its own <i> (Hán–Việt lookup) and
    // attach per-word annotations progressively, plus view counters / ad slots
    // jitter the innerText by a few chars every poll. Exact equality then never
    // holds, the stability streak resets each tick, and we burn the full
    // maxWaitMs even though the chapter has been fully readable for seconds.
    // Treat the text as stable once its length stops changing by more than a
    // tolerance — a small absolute floor, or 1% of the current length for long
    // chapters (missing a few trailing annotation chars is harmless; the VN text
    // is all there). A container going empty -> full is a large relative jump, so
    // partial content is still rejected.
    var absTol = opts.tolerance != null ? opts.tolerance : 12;
    return new Promise(function(resolve) {
      var deadline = Date.now() + maxWaitMs;
      var lastLen = -1, stable = 0;
      (function poll() {
        var el = null;
        for (var i = 0; i < sels.length && !el; i++) el = document.querySelector(sels[i]);
        var len = (el && el.innerText) ? el.innerText.trim().length : 0;
        var tol = Math.max(absTol, Math.floor(len * 0.01));
        if (len >= minLen && lastLen >= 0 && Math.abs(len - lastLen) <= tol) {
          if (++stable >= stableNeeded) return resolve(el);
        } else {
          stable = 0;
        }
        lastLen = len;
        if (Date.now() >= deadline) return resolve(len >= minLen ? el : null);
        setTimeout(poll, pollMs);
      })();
    });
  }

  this.getTexts = async function(index) {
    if (index == 0) {
      const math = await getMath()
      try {
        if (math) math.show()
        return parse()
      }
      finally {
        if (math) math.hide()
      }
    }
    else return null;
  }

  // Generic next-chapter detection — applies to every unregistered site
  // (and to sites whose domain changed, e.g. truyendich) so auto-next keeps
  // working without a per-host handler. Site handlers loaded after this file
  // may still override readAloudDoc.getNextPageUrl for better precision.
  this.getNextPageUrl = function() {
    // 1. Standard rel="next" link
    var next = document.querySelector('a[rel="next"]')
    if (next && next.href) return next.href

    // 2. Common next-chapter button/link selectors (VN + EN novel sites)
    var selectors = [
      'a.next', 'a.next-chap', 'a.next_chapter', 'a.btn-next',
      'a.next-chapter', 'a.chapter-next',
      '.next-chapter a', '.next-chap a', '.nav-next a', '.chapter-nav a.next',
      'a[title*="Tiếp"]', 'a[title*="tiếp"]', 'a[title*="Sau"]',
      'a[title*="Next"]', 'a[aria-label*="next" i]', 'a[rel="next"]',
    ]
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i])
      if (el && el.href && !/#$/.test(el.getAttribute('href') || '')) return el.href
    }

    // 3. Link whose visible text looks like a next-chapter label
    var labelRe = /(chương|chapter)?\s*(tiếp|sau|next)\b|»|→/i
    var anchors = document.querySelectorAll('a[href]')
    for (var j = 0; j < anchors.length; j++) {
      var a = anchors[j]
      var txt = (a.textContent || '').trim()
      if (txt && txt.length <= 30 && labelRe.test(txt) && a.href) return a.href
    }

    // 4. URL increment — chuong-1, chuong1, chapter-1, chapter1, c-1, c1
    var url = location.href
    var m = url.match(/(chuong|chapter|c)([-_]?)(\d+)/i)
    if (m) return url.replace(m[0], m[1] + m[2] + (parseInt(m[3]) + 1))

    // 5. Last path segment is a plain number: /1, /123
    var pathname = location.pathname.replace(/\/$/, '')
    var parts = pathname.split('/')
    var lastSeg = parts[parts.length - 1]
    if (/^\d+$/.test(lastSeg)) {
      parts[parts.length - 1] = String(parseInt(lastSeg) + 1)
      return location.protocol + '//' + location.host + parts.join('/') + location.search + location.hash
    }

    return null
  }

  this.getSelectedText = async function() {
    const math = await getMath()
    try {
      if (math) math.show()
      return window.getSelection().toString().trim()
    }
    finally {
      if (math) math.hide()
    }
  }



  function parse() {
    //find blocks containing text
    var start = new Date();
    var textBlocks = findTextBlocks(50);
    var countChars = textBlocks.reduce(function(sum, elem) {return sum + getInnerText(elem).length}, 0);
    console.log("Found", textBlocks.length, "blocks", countChars, "chars in", new Date()-start, "ms");

    if (countChars < 1000) {
      // Word-by-word obfuscation guard: some sites (VN novel/translation sites)
      // wrap every word in its own inline <i>/<span>. The block walker then finds
      // almost no text and shatters playback into one-word fragments. If a
      // recognizable content container holds far more text than we captured,
      // read it directly (innerText re-joins the words) and split on blank lines.
      var container = findContentContainer(countChars);
      if (container) {
        var paras = [];
        var heading = document.querySelector(".chapter-title, h1, h2");
        if (heading) {
          var ht = (heading.innerText || "").trim();
          if (ht) paras.push(ht);
        }
        container.innerText.split(/\n{2,}/).forEach(function(block) {
          var t = block.replace(/\s+/g, " ").trim();
          if (t) paras.push(t);
        });
        var joined = paras.filter(isNotEmpty);
        if (joined.length) {
          console.log("Using content-container fallback:", joined.length, "paragraphs");
          return joined;
        }
      }

      textBlocks = findTextBlocks(3);
      var texts = textBlocks.map(getInnerText);
      console.log("Using lower threshold, found", textBlocks.length, "blocks", texts.join("").length, "chars");

      //trim the head and the tail
      var head, tail;
      for (var i=3; i<texts.length && !head; i++) {
        var dist = getGaussian(texts, 0, i);
        if (texts[i].length > dist.mean + 2*dist.stdev) head = i;
      }
      for (var i=texts.length-4; i>=0 && !tail; i--) {
        var dist = getGaussian(texts, i+1, texts.length);
        if (texts[i].length > dist.mean + 2*dist.stdev) tail = i+1;
      }
      if (head||tail) {
        textBlocks = textBlocks.slice(head||0, tail);
        console.log("Trimmed", head, tail);
      }
    }

    //mark the elements to be read
    var toRead = [];
    for (var i=0; i<textBlocks.length; i++) {
      toRead.push.apply(toRead, findHeadingsFor(textBlocks[i], textBlocks[i-1]));
      toRead.push(textBlocks[i]);
    }
    $(toRead).addClass("read-aloud");   //for debugging only

    //extract texts
    return toRead.flatMap(getTexts).filter(isNotEmpty);
  }

  // Look for a chapter/article container whose visible text is much larger than
  // what the block walker captured (capturedChars). That gap is the signature of
  // per-word inline wrapping; only then do we override with direct innerText.
  function findContentContainer(capturedChars) {
    var selectors = [
      ".chapter-body", ".chapter-content", "#chapter-content",
      ".content-chapter", ".reading-content", ".box-chap",
      "#chapter-c", ".chapter-c", "article", "[class*='chapter']", "[id*='chapter']",
    ];
    var minLen = Math.max(capturedChars * 3, 400);
    var best = null, bestLen = 0;
    for (var i = 0; i < selectors.length; i++) {
      var els = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        if (!$(el).is(":visible")) continue;
        var len = (el.innerText || "").trim().length;
        if (len > bestLen && len >= minLen) { best = el; bestLen = len; }
      }
    }
    return best;
  }

  function findTextBlocks(threshold) {
    var skipTags = "h1, h2, h3, h4, h5, h6, p, a[href], " + self.ignoreTags;
    var isTextNode = function(node) {
      return node.nodeType == 3 && node.nodeValue.trim().length >= 3;
    };
    var isParagraph = function(node) {
      return node.nodeType == 1 && $(node).is("p:visible") && getInnerText(node).length >= threshold;
    };
    var hasTextNodes = function(elem) {
      return someChildNodes(elem, isTextNode) && getInnerText(elem).length >= threshold;
    };
    var hasParagraphs = function(elem) {
      return someChildNodes(elem, isParagraph);
    };
    var containsTextBlocks = function(elem) {
      var childElems = $(elem).children(":not(" + skipTags + ")").get();
      return childElems.some(hasTextNodes) || childElems.some(hasParagraphs) || childElems.some(containsTextBlocks);
    };
    var addBlock = function(elem, multi) {
      if (multi) $(elem).data("read-aloud-multi-block", true);
      textBlocks.push(elem);
    };
    var walk = function() {
      if ($(this).is("frame, iframe")) try {walk.call(this.contentDocument.body)} catch(err) {}
      else if ($(this).is("dl")) addBlock(this);
      else if ($(this).is("ol, ul")) {
        var items = $(this).children().get();
        if (items.some(hasTextNodes)) addBlock(this);
        else if (items.some(hasParagraphs)) addBlock(this, true);
        else if (items.some(containsTextBlocks)) addBlock(this, true);
      }
      else if ($(this).is("tbody")) {
        var rows = $(this).children();
        if (rows.length > 3 || rows.eq(0).children().length > 3) {
          if (rows.get().some(containsTextBlocks)) addBlock(this, true);
        }
        else rows.each(walk);
      }
      else {
        if (hasTextNodes(this)) addBlock(this);
        else if (hasParagraphs(this)) addBlock(this, true);
        else $(this).add(this.shadowRoot).children(":not(" + skipTags + ")").each(walk);
      }
    };
    var textBlocks = [];
    walk.call(document.body);
    return textBlocks.filter(function(elem) {
      return $(elem).is(":visible") && $(elem).offset().left >= 0;
    })
  }

  function getGaussian(texts, start, end) {
    if (start == undefined) start = 0;
    if (end == undefined) end = texts.length;
    var sum = 0;
    for (var i=start; i<end; i++) sum += texts[i].length;
    var mean = sum / (end-start);
    var variance = 0;
    for (var i=start; i<end; i++) variance += (texts[i].length-mean)*(texts[i].length-mean);
    return {mean: mean, stdev: Math.sqrt(variance)};
  }

  function getTexts(elem) {
    var toHide = $(elem).find(":visible").filter(dontRead).hide();
    $(elem).find("ol, ul").addBack("ol, ul").each(addNumbering);
    var texts = $(elem).data("read-aloud-multi-block")
      ? $(elem).children(":visible").get().map(getText)
      : getText(elem).split(paragraphSplitter);
    $(elem).find(".read-aloud-numbering").remove();
    toHide.show();
    return texts;
  }

  function addNumbering() {
    var children = $(this).children();
    var text = children.length ? getInnerText(children.get(0)) : null;
    if (text && !text.match(/^[(]?(\d|[a-zA-Z][).])/))
      children.each(function(index) {
        $("<span>").addClass("read-aloud-numbering").text((index +1) + ". ").prependTo(this);
      })
  }

  function dontRead() {
    var float = $(this).css("float");
    var position = $(this).css("position");
    return $(this).is(self.ignoreTags) || $(this).is("sup") || float == "right" || position == "fixed";
  }

  function getText(elem) {
    return addMissingPunctuation(elem.innerText).trim();
  }

  function addMissingPunctuation(text) {
    return text.replace(/(\w)(\s*?\r?\n)/g, "$1.$2");
  }

  function findHeadingsFor(block, prevBlock) {
    var result = [];
    var firstInnerElem = $(block).find("h1, h2, h3, h4, h5, h6, p").filter(":visible").get(0);
    var currentLevel = getHeadingLevel(firstInnerElem);
    var node = previousNode(block, true);
    while (node && node != prevBlock) {
      var ignore = $(node).is(self.ignoreTags);
      if (!ignore && node.nodeType == 1 && $(node).is(":visible")) {
        var level = getHeadingLevel(node);
        if (level < currentLevel) {
          result.push(node);
          currentLevel = level;
        }
      }
      node = previousNode(node, ignore);
    }
    return result.reverse();
  }

  function getHeadingLevel(elem) {
    var matches = elem && /^H(\d)$/i.exec(elem.tagName);
    return matches ? Number(matches[1]) : 100;
  }

  function previousNode(node, skipChildren) {
    if ($(node).is('body')) return null;
    if (node.nodeType == 1 && !skipChildren && node.lastChild) return node.lastChild;
    if (node.previousSibling) return node.previousSibling;
    if (node.parentNode) return previousNode(node.parentNode, true);
    return null;
  }

  function someChildNodes(elem, test) {
    var child = elem.firstChild;
    while (child) {
      if (test(child)) return true;
      child = child.nextSibling;
    }
    return false;
  }
}
