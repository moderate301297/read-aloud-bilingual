
var readAloudDoc = new function() {
  this.getCurrentIndex = function() {
    return 0
  }

  this.getTexts = function(index) {
    if (index == 0) return parse()
    else return null
  }

  this.getNextPageUrl = function() {
    // 1. Try standard rel="next" link
    var next = document.querySelector('a[rel="next"]')
    if (next && next.href) return next.href

    // 2. Try common next-chapter button/link selectors
    var buttonSelectors = [
      'a.next-chap', 'a.next_chapter', 'a.btn-next', 'a.next-chapter',
      '.next-chapter a', '.next-chap a', '.nav-next a',
      'a[title*="Tiếp"]', 'a[title*="tiếp"]', 'a[title*="Next"]',
    ]
    for (var i = 0; i < buttonSelectors.length; i++) {
      var el = document.querySelector(buttonSelectors[i])
      if (el && el.href) return el.href
    }

    // 3. URL increment fallback — tries patterns in order of specificity.
    var url = location.href

    // chuong-1, chuong1, chapter-1, chapter1, c-1, c1
    var m = url.match(/(chuong|chapter|c)([-_]?)(\d+)/i)
    if (m) {
      var nextNum = parseInt(m[3]) + 1
      return url.replace(m[0], m[1] + m[2] + nextNum)
    }

    // Last path segment is a plain number: /1, /123
    var pathname = location.pathname.replace(/\/$/, '')
    var parts = pathname.split('/')
    var lastSeg = parts[parts.length - 1]
    if (/^\d+$/.test(lastSeg)) {
      parts[parts.length - 1] = String(parseInt(lastSeg) + 1)
      return location.protocol + '//' + location.host + parts.join('/') + location.search + location.hash
    }

    return null
  }

  function parse() {
    var selectors = [
      '#chapter-content',
      '.chapter-content',
      '.box-chap',
      '.content-chapter',
      '.reading-content',
      '[class*="chapter-body"]',
      '[class*="chap"]',
    ]
    var container = null
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i])
      if (el && el.innerText && el.innerText.trim().length > 100) {
        container = el
        break
      }
    }
    if (!container) return null

    var texts = []

    var heading = document.querySelector('h1, h2')
    if (heading) {
      var headingText = extractText(heading).trim()
      if (headingText) texts.push(headingText)
    }

    var raw = extractText(container)
    raw.split(/\n{2,}/).forEach(function(block) {
      var t = block.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim()
      if (t) texts.push(t)
    })

    return texts.filter(Boolean)
  }

  function extractText(node) {
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
      text += extractText(node.childNodes[i])
    }

    var isBlock = /^(p|div|li|h[1-6]|blockquote|section|article)$/.test(tag)
    if (isBlock) {
      text = text.replace(/^\n+|\n+$/g, '')
      if (text) text = '\n' + text + '\n'
    }
    return text
  }
}
