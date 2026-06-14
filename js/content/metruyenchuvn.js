
var readAloudDoc = new function() {
  this.getCurrentIndex = function() {
    return 0
  }

  this.getTexts = function(index) {
    if (index == 0) return tryGetTexts(parse, 4000)
    else return null
  }

  this.getNextPageUrl = function() {
    // 1. rel="next" link
    var next = document.querySelector('a[rel="next"]')
    if (next && next.href) return next.href

    // 2. Common Vietnamese novel site selectors
    var selectors = [
      'a.next', 'a.btn-next', 'a.next-chap', 'a.next-chapter',
      '.chapter-nav a.next', '.next-chapter a', '.nav-next a',
      'a[title*="Tiếp"]', 'a[title*="tiếp"]', 'a[title*="Next"]',
      'a[aria-label*="next" i]',
    ]
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i])
      if (el && el.href) return el.href
    }

    // 3. URL pattern: chuong-N, chapterN, etc.
    var url = location.href
    var m = url.match(/(chuong|chapter|c)([-_]?)(\d+)/i)
    if (m) {
      return url.replace(m[0], m[1] + m[2] + (parseInt(m[3]) + 1))
    }

    // 4. Trailing numeric path segment
    var pathname = location.pathname.replace(/\/$/, '')
    var parts = pathname.split('/')
    var last = parts[parts.length - 1]
    if (/^\d+$/.test(last)) {
      parts[parts.length - 1] = String(parseInt(last) + 1)
      return location.protocol + '//' + location.host + parts.join('/') + location.search
    }

    return null
  }

  function findContainer() {
    var selectors = [
      'div.truyen',
      '#chapter-content',
      '.chapter-content',
      '.content-chapter',
      '.box-chap',
      '.reading-content',
      'article.chapter',
      '.truyen-content',
      '[class*="chapter"][class*="content"]',
      '[id*="chapter"][id*="content"]',
    ]
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i])
      if (el && el.innerText && el.innerText.trim().length > 100) return el
    }
    return null
  }

  function parse() {
    var container = findContainer()
    if (!container) return []

    var texts = []

    var heading = document.querySelector('h1.chapter-title, h2.chapter-title, .chapter-heading, h1, h2')
    if (heading) {
      var h = heading.innerText.trim()
      if (h) texts.push(h)
    }

    var raw = extractTextBr(container)
    raw.split(/\n{2,}/).forEach(function(block) {
      var t = block.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim()
      if (t) texts.push(t)
    })

    return texts.filter(Boolean)
  }

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
