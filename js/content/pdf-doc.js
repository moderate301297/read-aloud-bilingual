
var readAloudDoc = location.pathname.match(/readaloud\.html$/) ? new Standalone() : new Embedded()


function Embedded() {
  const ready = Promise.reject(new Error(JSON.stringify({code: "error_ajax_pdf"})))

  this.getCurrentIndex = function() {
    return ready
  }
  this.getTexts = function() {
    return ready
  }
}


function Standalone() {
  var queue = new EventQueue("PdfDoc");
  var ready = new Promise(f => queue.once("documentLoaded", f).trigger("loadDocument"))

  this.getCurrentIndex = function() {
    return ready.then(function() {
      return new Promise(function(fulfill) {
        queue.once("currentIndexGot", fulfill).trigger("getCurrentIndex");
      })
    })
  }

  this.getTexts = function(index, quietly) {
    return new Promise(function(fulfill) {
      queue.once("textsGot", fulfill).trigger("getTexts", index, quietly);
    })
  }

  function EventQueue(prefix) {
    this.on = function(eventType, callback) {
      document.addEventListener(prefix+eventType, function(event) {
        callback.apply(null, JSON.parse(event.detail));
      })
      return this;
    }
    this.once = function(eventType, callback) {
      var handler = function(event) {
        document.removeEventListener(prefix+eventType, handler);
        callback.apply(null, JSON.parse(event.detail));
      };
      document.addEventListener(prefix+eventType, handler);
      return this;
    }
    this.trigger = function(eventType) {
      var args = Array.prototype.slice.call(arguments, 1);
      document.dispatchEvent(new CustomEvent(prefix+eventType, {detail: JSON.stringify(args)}));
      return this;
    }
  }
}
