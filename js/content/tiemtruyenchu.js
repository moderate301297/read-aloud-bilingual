
var readAloudDoc = new function() {
  this.getCurrentIndex = function() {
    return 0
  }

  this.getTexts = function(index) {
    if (index == 0) return parse()
    else return null
  }

  // Walk the live DOM and collect text, skipping obfuscation elements.
  // tiemtruyenchu.com splits words with hidden <span style="font-size:0"> </span>
  // between character clusters. innerText includes those spaces; this walker skips them.
  function extractText(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return ''

    var tag = node.tagName.toLowerCase()
    var style = window.getComputedStyle(node)

    // Skip fully hidden elements
    if (style.display === 'none' || style.visibility === 'hidden') return ''

    // Skip copy-protection elements: font-size 0 (invisible spacer spans)
    if (parseFloat(style.fontSize) < 1) return ''

    // Skip zero-opacity elements
    if (parseFloat(style.opacity) < 0.01) return ''

    var isBlock = /^(p|div|br|li|h[1-6]|blockquote|section|article)$/.test(tag)

    var text = ''
    if (tag === 'br') return '\n'

    for (var i = 0; i < node.childNodes.length; i++) {
      text += extractText(node.childNodes[i])
    }

    if (isBlock) {
      // Wrap block content with newlines so paragraphs stay separate
      text = text.replace(/^\n+|\n+$/g, '')
      if (text) text = '\n' + text + '\n'
    }

    return text
  }

  function parse() {
    var selectors = [
      ".box-chap",
      "#chapter-content",
      ".chapter-content",
      ".content-chapter",
      ".reading-content",
      "[class*='chap']",
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

    // Title from heading
    var heading = document.querySelector("h1, h2")
    if (heading) {
      var headingText = extractText(heading).trim()
      if (headingText) texts.push(headingText)
    }

    // Extract clean text from the container, then split on paragraph breaks
    var raw = extractText(container)
    raw.split(/\n{2,}/).forEach(function(block) {
      var t = block.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim()
      if (t) texts.push(t)
    })

    return texts.filter(isNotEmpty)
  }
}
