
function SimpleSource(texts, opts) {
  opts = opts || {}
  this.ready = Promise.resolve({
    lang: opts.lang,
  })
  this.isWaiting = function() {
    return false;
  }
  this.getCurrentIndex = function() {
    return Promise.resolve(0);
  }
  this.getTexts = function(index) {
    return Promise.resolve(index == 0 ? texts : null);
  }
  this.close = function() {
    return Promise.resolve();
  }
  this.getUri = function() {
    var textLen = texts.reduce(function(sum, text) {return sum+text.length}, 0);
    return "text-selection:(" + textLen + ")" + encodeURIComponent((texts[0] || "").substr(0, 100));
  }
}


function TabSource() {
  var waiting = true;
  var sendToSource;

  this.ready = brapi.storage.local.get(["sourceUri"])
    .then(({sourceUri: uri}) => {
      if (uri.startsWith("contentscript:")) {
        const tabId = Number(uri.substr(14))
        sendToSource = sendToContentScript.bind(null, tabId)
        return sendToSource({method: "getDocumentInfo"})
      }
      else if (uri.startsWith("epubreader:")) {
        const extensionId = uri.substr(11)
        sendToSource = sendToEpubReader.bind({}, extensionId)
        return sendToSource({method: "getDocumentInfo"})
          .then(res => {
            if (!res.success) throw new Error("Failed to get EPUB document info")
            if (res.lang && !/^[a-z][a-z](-[A-Z][A-Z])?$/.test(res.lang)) res.lang = null
            if (res.lang) res.detectedLang = res.lang   //prevent lang detection
            return res
          })
      }
      else if (uri.startsWith("pdfviewer:")) {
        sendToSource = sendToPdfViewer
        return sendToSource({method: "getDocumentInfo"})
      }
      else throw new Error("Invalid source")
    })
    .finally(function() {
      waiting = false;
    })

  this.isWaiting = function() {
    return waiting;
  }
  this.getCurrentIndex = function() {
    waiting = true;
    return sendToSource({method: "getCurrentIndex"})
      .finally(function() {waiting = false})
  }
  this.getTexts = function(index, quietly) {
    waiting = true;
    return sendToSource({method: "getTexts", args: [index, quietly]})
      .finally(function() {waiting = false})
  }
  this.close = function() {
    return Promise.resolve();
  }
  this.getUri = function() {
    return this.ready
      .then(function(info) {return info.url})
  }

  async function sendToContentScript(tabId, message) {
    message.dest = "contentScript"
    const result = await brapi.tabs.sendMessage(tabId, message)
      .catch(err => {
        brapi.storage.local.remove("contentScriptTabId")
        if (/^(A listener indicated|Could not establish)/.test(err.message)) throw new Error(err.message + " " + message.method)
        throw err
      })
    if (result && result.error) throw result.error
    else return result
  }

  async function sendToEpubReader(extId, message) {
    if (this.currentPage == null) this.currentPage = 0
    switch (message.method) {
      case "getDocumentInfo": return brapi.runtime.sendMessage(extId, {name: "getDocumentInfo"})
      case "getCurrentIndex": return this.currentPage
      case "getTexts": return getTexts.apply(this, message.args)
      default: throw new Error("Bad method")
    }
    async function getTexts(index) {
      var res = {success: true, paged: true}
      for (; this.currentPage<index; this.currentPage++) res = await brapi.runtime.sendMessage(extId, {name: "pageForward"})
      for (; this.currentPage>index; this.currentPage--) res = await brapi.runtime.sendMessage(extId, {name: "pageBackward"})
      if (!res.success) throw new Error("Failed to flip EPUB page");
      res = res.paged ? await brapi.runtime.sendMessage(extId, {name: "getPageText"}) : {success: true, text: null}
      if (!res.success) throw new Error("Failed to get EPUB text");
      return res.text && parseXhtml(res.text)
    }
    function parseXhtml(xml) {
      const dom = new DOMParser().parseFromString(xml, "text/xml");
      const nodes = dom.body.querySelectorAll("h1, h2, h3, h4, h5, h6, p");
      return Array.prototype.slice.call(nodes)
        .map(node => node.innerText && node.innerText.trim().replace(/\r?\n/g, " "))
        .filter(text => text)
    }
  }

  async function sendToPdfViewer(message) {
    message.dest = "pdfViewer"
    const result = await brapi.runtime.sendMessage(message)
      .catch(err => {
        if (/^(A listener indicated|Could not establish)/.test(err.message)) throw new Error(err.message + " " + message.method)
        throw err
      })
    if (result && result.error) throw result.error
    else return result
  }
}


function Doc(source, onEnd) {
  var info;
  var currentIndex;
  var activeSpeech;
  var bilingualChunks = null;
  var ready = source.ready
    .then(function(result) {info = result})
  var foundText;
  const playbackState = new rxjs.BehaviorSubject("resumed")

  this.close = close;
  this.play = play;
  this.stop = stop;
  this.pause = pause;
  this.getState = getState;
  this.getActiveSpeech = getActiveSpeech;
  this.forward = forward;
  this.rewind = rewind;
  this.seek = seek;

  //method close
  function close() {
    playbackState.error({name: "CancellationException", message: "Playback cancelled"})
    return ready
      .catch(function() {})
      .then(function() {
        if (activeSpeech) {
          activeSpeech.stop()
          activeSpeech = null
        }
        source.close();
      })
  }

  //method play
  async function play() {
    if (activeSpeech) return activeSpeech.play();
    await ready
    await wait(playbackState, "resumed")
    currentIndex = await source.getCurrentIndex()
    await wait(playbackState, "resumed")
    return readCurrent()
  }

  async function readCurrent(rewinded) {
    console.log("[Doc] readCurrent index=" + currentIndex + " activeSpeech=" + !!activeSpeech)
    const texts = await source.getTexts(currentIndex).catch(err => null)
    await wait(playbackState, "resumed")
    if (texts) {
      if (texts.length) {
        foundText = true;
        return read(texts, rewinded);
      }
      else {
        currentIndex++;
        return readCurrent();
      }
    }
    else {
      console.log("[Doc] readCurrent → no more texts → onEnd")
      if (!foundText) throw new Error(JSON.stringify({code: "error_no_text"}))
      if (onEnd) onEnd()
    }
  }

  async function read(texts, rewinded) {
    texts = texts.map(preprocess)
    if (info.detectedLang == null) {
      const lang = await detectLanguage(texts)
      await wait(playbackState, "resumed")
      info.detectedLang = lang || "";
    }
    const { readMode } = await getSettings(["readMode"])
    if (activeSpeech) return;
    const isBilingual = (readMode || "english") === "english"
    if (isBilingual) {
      return readBilingualTexts(texts, 0, rewinded)
    }
    bilingualChunks = null
    activeSpeech = await getSpeech(texts, readMode);
    await wait(playbackState, "resumed")
    activeSpeech.onEnd = function(err) {
      if (err) {
        if (onEnd) onEnd(err);
      } else {
        activeSpeech = null;
        currentIndex++;
        readCurrent()
          .catch(function(err) { if (onEnd) onEnd(err) })
      }
    };
    if (rewinded) await activeSpeech.gotoEnd();
    return activeSpeech.play();
  }

  function patchBilingualGetInfo(speech, fullTexts, index) {
    const orig = speech.getInfo
    speech.getInfo = function() {
      const info = orig()
      return { ...info, texts: fullTexts, position: { index } }
    }
  }

  // Entry point: split paragraphs into sentence-level chunks, then process each as VN→EN
  async function readBilingualTexts(texts, textIndex, rewinded) {
    const chunks = texts.slice(textIndex).filter(Boolean).flatMap(splitIntoSentenceChunks)
    bilingualChunks = chunks
    console.log("[Bilingual] chunks word counts:", chunks.map(function(c) { return c.split(/\s+/).length }))
    return readBilingualChunks(chunks, 0, rewinded)
  }

  // Split text into sentences (1 sentence = 1 chunk), hard cap at MAX_WORDS per chunk
  function splitIntoSentenceChunks(text) {
    const MAX_WORDS = 200
    // Split on ASCII and full-width sentence-ending punctuation followed by whitespace
    const sentences = text.split(/(?<=[.!?。！？])\s+/).map(function(s) { return s.trim() }).filter(Boolean)
    const result = []
    for (var i = 0; i < sentences.length; i++) {
      var words = sentences[i].split(/\s+/)
      if (words.length <= MAX_WORDS) {
        result.push(sentences[i])
      } else {
        // Hard cap: slice into MAX_WORDS word blocks
        for (var j = 0; j < words.length; j += MAX_WORDS) {
          result.push(words.slice(j, j + MAX_WORDS).join(' '))
        }
      }
    }
    return result.length > 0 ? result : [text]
  }

  // Process flat chunk array: for each chunk play VN → EN, with 1-chunk look-ahead
  async function readBilingualChunks(chunks, chunkIndex, rewinded, precomputedEnSpeechPromise) {
    console.log("[Bilingual] readBilingualChunks chunkIndex=" + chunkIndex + "/" + chunks.length + " words=" + (chunks[chunkIndex] ? chunks[chunkIndex].split(/\s+/).length : 0) + " activeSpeech=" + !!activeSpeech)
    while (chunkIndex < chunks.length && !chunks[chunkIndex]) chunkIndex++
    if (chunkIndex >= chunks.length) {
      console.log("[Bilingual] all chunks done → next page")
      currentIndex++
      return readCurrent()
    }
    await wait(playbackState, "resumed")
    if (activeSpeech) { console.log("[Bilingual] activeSpeech exists → skip"); return }
    const chunk = [chunks[chunkIndex]]
    activeSpeech = await getSpeech(chunk, "original")
    patchBilingualGetInfo(activeSpeech, chunks, chunkIndex)
    await wait(playbackState, "resumed")

    // Use pre-computed EN promise if passed in, otherwise fire new prefetch
    const enSpeechPromise = precomputedEnSpeechPromise || translateTexts(chunk)
      .then(function(translatedTexts) { return getSpeech(translatedTexts, "english") })
      .catch(function(err) {
        console.error("[Bilingual] EN prefetch error:", err)
        return null
      })

    // Prefetch NEXT chunk's EN in background while current VN plays (1-chunk look-ahead)
    let nextChunkIndex = chunkIndex + 1
    while (nextChunkIndex < chunks.length && !chunks[nextChunkIndex]) nextChunkIndex++
    const nextEnSpeechPromise = nextChunkIndex < chunks.length
      ? translateTexts([chunks[nextChunkIndex]])
          .then(function(translatedTexts) { return getSpeech(translatedTexts, "english") })
          .catch(function(err) {
            console.error("[Bilingual] EN next-prefetch error:", err)
            return null
          })
      : null

    activeSpeech.onEnd = function(err) {
      console.log("[Bilingual] Gốc onEnd err=" + (err ? err.message : null))
      if (err) {
        if (onEnd) onEnd(err)
      } else {
        activeSpeech = null
        enSpeechPromise
          .then(async function(enSpeech) {
            if (!enSpeech) throw new Error("EN prefetch failed")
            if (activeSpeech) { console.log("[Bilingual] EN: activeSpeech race → stop EN"); enSpeech.stop(); return }
            activeSpeech = enSpeech
            patchBilingualGetInfo(activeSpeech, chunks, chunkIndex)
            await wait(playbackState, "resumed")
            activeSpeech.onEnd = function(err) {
              console.log("[Bilingual] EN onEnd err=" + (err ? err.message : null))
              if (err) {
                if (onEnd) onEnd(err)
              } else {
                activeSpeech = null
                readBilingualChunks(chunks, chunkIndex + 1, false, nextEnSpeechPromise)
                  .catch(function(err) { if (onEnd) onEnd(err) })
              }
            }
            console.log("[Bilingual] EN play")
            return activeSpeech.play()
          })
          .catch(function(err) {
            console.error("[Bilingual] EN error, skipping:", err)
            activeSpeech = null
            readBilingualChunks(chunks, chunkIndex + 1, false, nextEnSpeechPromise)
              .catch(function(err2) { if (onEnd) onEnd(err2) })
          })
      }
    }
    console.log("[Bilingual] Gốc play chunkIndex=" + chunkIndex)
    if (rewinded && chunkIndex === 0) await activeSpeech.gotoEnd()
    return activeSpeech.play()
  }

  function preprocess(text) {
    text = truncateRepeatedChars(text, 3)
    return text.replace(/https?:\/\/\S+/g, "HTTP URL.")
  }

  async function translateTexts(texts) {
    return Promise.all(texts.map(async function(text) {
      try {
        const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=" + encodeURIComponent(text.slice(0, 500))
        const data = await ajaxGet({url, responseType: "json"})
        if (data && data[0]) {
          const translated = data[0].filter(Boolean).map(function(item) { return item[0] }).filter(Boolean).join("").trim()
          if (translated) return translated
        }
      } catch(err) {
        console.error("Translation error:", err)
      }
      return text
    }))
  }

  function detectLanguage(texts) {
    var minChars = 240;
    var maxPages = 10;
    var output = combineTexts("", texts);
    if (output.length < minChars) {
      return accumulateMore(output, currentIndex+1)
        .then(detectLanguageOf)
        .then(extraAction(function() {
          //for sources that couldn't flip page silently, flip back to the current page
          return source.getTexts(currentIndex, true);
        }))
    }
    else {
      return detectLanguageOf(output);
    }

    function combineTexts(output, texts) {
      for (var i=0; i<texts.length && output.length<minChars; i++) output += (texts[i] + " ");
      return output;
    }
    function accumulateMore(output, index) {
      return source.getTexts(index, true)
        .then(function(texts) {
          if (!texts) return output;
          output = combineTexts(output, texts);
          return output.length<minChars && index-currentIndex<maxPages ? accumulateMore(output, index+1) : output;
        })
    }
  }

  function detectLanguageOf(text) {
    if (text.length < 100) {
      //too little text, use cloud detection for improved accuracy
      return serverDetectLanguage(text)
        .then(function(result) {
          return result || browserDetectLanguage(text)
        })
        .then(function(lang) {
          //exclude commonly misdetected languages
          return ["cy", "eo"].includes(lang) ? null : lang
        })
    }
    return browserDetectLanguage(text)
      .then(function(result) {
        return result || serverDetectLanguage(text);
      })
  }

  function browserDetectLanguage(text) {
    if (!brapi.i18n.detectLanguage) return Promise.resolve(null);
    return new Promise(function(fulfill) {
      brapi.i18n.detectLanguage(text, fulfill);
    })
    .then(function(result) {
      if (result) {
          var list = result.languages.filter(function(item) {return item.language != "und"});
          list.sort(function(a,b) {return b.percentage-a.percentage});
          return list[0] && list[0].language;
      }
      else {
        return null;
      }
    })
  }

  async function serverDetectLanguage(text) {
    try {
      const service = await rxjs.firstValueFrom(fasttextObservable)
      if (!service) throw new Error("FastText service unavailable")
      const [prediction] = await service.sendRequest("detectLanguage", {text})
      return prediction?.language
    }
    catch (err) {
      console.error(err)

      return ajaxPost(config.serviceUrl + "/read-aloud/detect-language", {text: text}, "json")
        .then(JSON.parse)
        .then(function(res) {
          var result = Array.isArray(res) ? res[0] : res
          if (result && result.language && result.language != "und") return result.language
          else return null
        })
        .catch(function(err) {
          console.error(err)
          return null
        })
    }
  }

  async function getSpeech(texts, readMode) {
    const settings = await getSettings()
    const origin = info.url ? (() => { try { return new URL(info.url).origin } catch(e) { return null } })() : null
    const rateKey = (origin && origin !== "null") ? "rate:" + origin : "rate" + (settings.voiceName || "")
    settings.rate = await getSetting(rateKey) || await getSetting("rate" + (settings.voiceName || ""))
    const isEnglishMode = readMode === "english"
    var lang = (!info.detectedLang || info.lang && info.lang.startsWith(info.detectedLang)) ? info.lang : info.detectedLang;
    console.log("Declared", info.lang, "- Detected", info.detectedLang, "- Chosen", lang, "- ReadMode", readMode)
    var options = {
      rate: isEnglishMode ? (settings.rateEN || defaults.rateEN) : 2.5,
      pitch: settings.pitch || defaults.pitch,
      volume: settings.volume || defaults.volume,
      lang: isEnglishMode ? "en-US" : (config.langMap[lang] || lang || 'en-US'),
    }
    const voice = await getSpeechVoice(isEnglishMode ? null : settings.voiceName, options.lang)
    if (!voice) throw new Error(JSON.stringify({code: "error_no_voice", lang: options.lang}));
    options.voice = voice;
    return new Speech(texts, options);
  }

  //method stop
  function stop() {
    return ready
      .then(function() {
        if (activeSpeech) {
          activeSpeech.stop()
          activeSpeech = null
        }
      })
  }

  //method pause
  function pause() {
    return ready
      .then(function() {
        if (activeSpeech) return activeSpeech.pause();
      })
  }

  //method getState
  function getState() {
    if (activeSpeech) return activeSpeech.getState();
    else return "LOADING"
  }

  //method getActiveSpeech
  function getActiveSpeech() {
    return Promise.resolve(activeSpeech);
  }

  //method forward
  function forward() {
    if (activeSpeech) {
      if (activeSpeech.canForward()) activeSpeech.forward()
      else forwardPage()
    }
    else return Promise.reject(new Error("Can't forward, not active"));
  }

  function forwardPage() {
    return stop().then(function() {currentIndex++; readCurrent()});
  }

  //method rewind
  function rewind() {
    if (activeSpeech) {
      if (activeSpeech.canRewind()) activeSpeech.rewind()
      else rewindPage()
    }
    else return Promise.reject(new Error("Can't rewind, not active"));
  }

  function rewindPage() {
    return stop().then(function() {currentIndex--; readCurrent(true)});
  }

  function seek(n) {
    if (bilingualChunks) {
      if (activeSpeech) {
        activeSpeech.stop()
        activeSpeech = null
      }
      return readBilingualChunks(bilingualChunks, n, false)
        .catch(function(err) { if (onEnd) onEnd(err) })
    }
    if (activeSpeech) return activeSpeech.seek(n);
    else return Promise.reject(new Error("Can't seek, not active"));
  }
}
