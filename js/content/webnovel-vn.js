
var readAloudDoc = new function() {
  this.getCurrentIndex = function() {
    return 0
  }

  this.getTexts = function(index) {
    if (index == 0) return parse()
    else return null
  }

  function parse() {
    var container = document.querySelector('#chapter-c')
    if (!container || container.innerText.trim().length < 50) return null

    var texts = []

    var heading = document.querySelector('h1, h2, .reader__chapter')
    if (heading) {
      var h = heading.innerText.trim()
      if (h) texts.push(h)
    }

    // Walk nodes manually: convert <br> to \n, skip ad divs (adsbygoogle/script)
    function extractText(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue
      if (node.nodeType !== Node.ELEMENT_NODE) return ''
      var tag = node.tagName.toLowerCase()
      if (tag === 'script' || tag === 'style') return ''
      if (tag === 'ins' || node.classList.contains('adsbygoogle')) return ''
      if (tag === 'br') return '\n'
      var text = ''
      for (var i = 0; i < node.childNodes.length; i++) {
        text += extractText(node.childNodes[i])
      }
      if (/^(div|p|blockquote|li|h[1-6])$/.test(tag)) {
        text = text.replace(/^\n+|\n+$/g, '')
        if (text) text = '\n' + text + '\n'
      }
      return text
    }

    var raw = extractText(container)
    raw.split(/\n{2,}/).forEach(function(block) {
      var t = block.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim()
      if (t) texts.push(t)
    })

    return texts.filter(Boolean)
  }
}
