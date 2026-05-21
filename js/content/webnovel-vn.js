
var readAloudDoc = new function() {
  this.getCurrentIndex = function() {
    return 0
  }

  this.getTexts = function(index) {
    if (index == 0) return parse()
    else return null
  }

  this.getNextPageUrl = function() {
    var next = document.querySelector('a[rel="next"]')
    return next ? next.href : null
  }

  function parse() {
    var container = document.querySelector('#chapter-c')
    if (!container) return null

    var texts = []

    var heading = document.querySelector('.reader__chapter, h1')
    if (heading) {
      var h = heading.innerText.trim()
      if (h) texts.push(h)
    }

    // Paid/unlocked chapters: <P display:flex> with scrambled <SPAN order:N> children
    var pTags = Array.from(container.querySelectorAll('p')).filter(isVisible)
    if (pTags.length >= 2) {
      pTags.forEach(function(p) {
        var t = getParaText(p).trim()
        if (t) texts.push(t)
      })
      return texts.filter(Boolean)
    }

    // Free chapters: plain text with <br><br> separators
    var raw = extractTextBr(container)
    raw.split(/\n{2,}/).forEach(function(block) {
      var t = block.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim()
      if (t) texts.push(t)
    })

    return texts.filter(Boolean)
  }

  // Extract text from a <P display:flex> paragraph, respecting CSS order on child spans
  function getParaText(p) {
    var spans = Array.from(p.children).filter(function(el) {
      return el.tagName === 'SPAN' && isVisible(el)
    })

    if (spans.length === 0) {
      // No span children — text is direct in P
      return p.innerText
    }

    if (spans.length === 1) {
      return spans[0].innerText
    }

    // Multiple spans: sort by CSS order value, then by visual left position
    spans.sort(function(a, b) {
      var oa = parseInt(window.getComputedStyle(a).order) || 0
      var ob = parseInt(window.getComputedStyle(b).order) || 0
      if (oa !== ob) return oa - ob
      // Same order value: fall back to visual position
      var ra = a.getBoundingClientRect()
      var rb = b.getBoundingClientRect()
      if (Math.abs(ra.top - rb.top) > 5) return ra.top - rb.top
      return ra.left - rb.left
    })

    return spans.map(function(s) { return s.innerText }).join('')
  }

  function isVisible(el) {
    var style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    if (parseFloat(style.opacity) < 0.01) return false
    if (parseFloat(style.fontSize) < 1) return false
    return el.getBoundingClientRect().height > 0
  }

  // Walk DOM for <br>-based free chapter content
  function extractTextBr(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    var tag = node.tagName.toLowerCase()
    if (tag === 'script' || tag === 'style') return ''
    if (tag === 'ins' || node.classList.contains('adsbygoogle')) return ''
    if (tag === 'br') return '\n'

    var style = window.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return ''
    if (parseFloat(style.opacity) < 0.01) return ''
    if (parseFloat(style.fontSize) < 1) return ''

    var text = ''
    for (var i = 0; i < node.childNodes.length; i++) {
      text += extractTextBr(node.childNodes[i])
    }
    var isBlock = /^(p|div|li|h[1-6]|blockquote)$/.test(tag)
    if (isBlock) {
      text = text.replace(/^\n+|\n+$/g, '')
      if (text) text = '\n' + text + '\n'
    }
    return text
  }
}
