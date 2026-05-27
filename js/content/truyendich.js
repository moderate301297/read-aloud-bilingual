// Loaded after html-doc.js — inherits its robust content parser.
// Only adds getNextPageUrl for chapter navigation.

readAloudDoc.getNextPageUrl = function() {
  // 1. Standard rel="next" link
  var next = document.querySelector('a[rel="next"]')
  if (next && next.href) return next.href

  // 2. Common next-chapter button/link selectors
  var buttonSelectors = [
    'a.next-chap', 'a.next_chapter', 'a.btn-next', 'a.next-chapter',
    '.next-chapter a', '.next-chap a', '.nav-next a',
    'a[title*="Tiếp"]', 'a[title*="tiếp"]', 'a[title*="Next"]',
  ]
  for (var i = 0; i < buttonSelectors.length; i++) {
    var el = document.querySelector(buttonSelectors[i])
    if (el && el.href) return el.href
  }

  // 3. URL increment — handles: chuong-1, chuong1, chapter-1, chapter1, c-1, c1
  var url = location.href
  var m = url.match(/(chuong|chapter|c)([-_]?)(\d+)/i)
  if (m) {
    var nextNum = parseInt(m[3]) + 1
    return url.replace(m[0], m[1] + m[2] + nextNum)
  }

  // 4. Last path segment is a plain number: /1, /123
  var pathname = location.pathname.replace(/\/$/, '')
  var parts = pathname.split('/')
  var lastSeg = parts[parts.length - 1]
  if (/^\d+$/.test(lastSeg)) {
    parts[parts.length - 1] = String(parseInt(lastSeg) + 1)
    return location.protocol + '//' + location.host + parts.join('/') + location.search + location.hash
  }

  return null
}
