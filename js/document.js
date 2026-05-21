
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
  var sourceTabId = null;

  this.ready = brapi.storage.local.get(["sourceUri"])
    .then(({sourceUri: uri}) => {
      if (uri.startsWith("contentscript:")) {
        sourceTabId = Number(uri.substr(14))
        sendToSource = sendToContentScript.bind(null, sourceTabId)
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
  this.getTexts = async function(index, quietly) {
    waiting = true;
    try {
      const texts = await sendToSource({method: "getTexts", args: [index, quietly]})
      if (texts !== null || index === 0 || !sourceTabId) return texts

      // End of chapter — check for auto-next
      const {autoNextChapter} = await brapi.storage.local.get(["autoNextChapter"])
      if (!autoNextChapter) return null

      const nextUrl = await sendToSource({method: "getNextPageUrl"}).catch(() => null)
      if (!nextUrl) return null

      // Wait for screen to be visible before navigating — prevents rapid chapter-skipping
      // when the OS interrupts TTS while the screen is off on mobile
      if (document.hidden) {
        await new Promise(function(resolve) {
          function onVisible() {
            if (!document.hidden) {
              document.removeEventListener("visibilitychange", onVisible)
              resolve()
            }
          }
          document.addEventListener("visibilitychange", onVisible)
        })
      }

      await navigateTabAndInject(sourceTabId, nextUrl)
      return sendToSource({method: "getTexts", args: [0, quietly]})
    } finally {
      waiting = false
    }
  }
  this.close = function() {
    return Promise.resolve();
  }
  this.getUri = function() {
    return this.ready
      .then(function(info) {return info.url})
  }

  async function navigateTabAndInject(tabId, url) {
    await brapi.tabs.update(tabId, {url})
    // Wait for the tab to finish loading
    await new Promise(resolve => {
      function onUpdated(id, info) {
        if (id === tabId && info.status === 'complete') {
          brapi.tabs.onUpdated.removeListener(onUpdated)
          setTimeout(resolve, 400)
        }
      }
      brapi.tabs.onUpdated.addListener(onUpdated)
    })
    // Re-inject base content scripts
    const target = {tabId}
    await brapi.scripting.executeScript({target, files: [
      "js/rxjs.umd.min.js",
      "js/jquery-3.7.1.min.js",
      "js/defaults.js",
      "js/messaging.js",
      "js/content.js",
    ]})
    // Inject site-specific handler
    const files = await brapi.tabs.sendMessage(tabId, {dest: "contentScript", method: "getRequireJs"})
    if (files && files.length) {
      await brapi.scripting.executeScript({target, files})
    }
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
  var bilingualDisplayTexts = null;
  var bilingualChunkParaIndex = null;
  var currentBilingualChunkIndex = null;
  var translationCache = new Map()
  const TRANSLATION_PREFETCH_WINDOW = 8
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
    return readOriginalChunks(texts, 0, rewinded)
  }

  function patchBilingualGetInfo(speech, displayTexts, displayIndex, chunkText) {
    const orig = speech.getInfo
    speech.getInfo = function() {
      const info = orig()
      const paraText = displayTexts[displayIndex] || ''
      const startIndex = chunkText ? paraText.indexOf(chunkText) : -1
      const word = startIndex >= 0 ? { startIndex, endIndex: startIndex + chunkText.length } : null
      return { ...info, texts: displayTexts, position: { index: displayIndex, word, chunkText, chunkKey: displayIndex + '_' + startIndex } }
    }
  }

  function prefetchTranslations(chunks, fromIndex) {
    for (var i = fromIndex; i < Math.min(fromIndex + TRANSLATION_PREFETCH_WINDOW, chunks.length); i++) {
      if (!translationCache.has(i) && chunks[i]) {
        translationCache.set(i, translateTexts([chunks[i]]).catch(function() { return [chunks[i]] }))
      }
    }
  }

  function getCachedTranslation(chunks, index) {
    if (!translationCache.has(index) && chunks[index]) {
      translationCache.set(index, translateTexts([chunks[index]]).catch(function() { return [chunks[index]] }))
    }
    return translationCache.get(index) || Promise.resolve([chunks[index] || ''])
  }

  // Entry point: split paragraphs into sentence-level chunks, then process each as VN→EN
  async function readBilingualTexts(texts, textIndex, rewinded) {
    const chunks = []
    const chunkParaIndex = []
    texts.slice(textIndex).filter(Boolean).forEach(function(text, i) {
      splitIntoSentenceChunks(text).filter(function(c) { return c && !/^[\s.\n]+$/.test(c) }).forEach(function(chunk) {
        chunks.push(chunk)
        chunkParaIndex.push(textIndex + i)
      })
    })
    bilingualChunks = chunks
    bilingualDisplayTexts = texts
    bilingualChunkParaIndex = chunkParaIndex
    translationCache.clear()
    prefetchTranslations(chunks, 0)
    console.log("[Bilingual] chunks word counts:", chunks.map(function(c) { return c.split(/\s+/).length }))
    return readBilingualChunks(texts, chunkParaIndex, chunks, 0, rewinded)
  }

  // Original mode: read each paragraph as a single TTS utterance
  async function readOriginalChunks(texts, textIndex, rewinded) {
    bilingualChunks = null
    bilingualDisplayTexts = null
    bilingualChunkParaIndex = null
    currentBilingualChunkIndex = null
    translationCache.clear()
    return readOriginalParagraph(texts, textIndex, rewinded)
  }

  async function readOriginalParagraph(displayTexts, paraIndex, rewinded) {
    while (paraIndex < displayTexts.length && !displayTexts[paraIndex]) paraIndex++
    if (paraIndex >= displayTexts.length) {
      currentIndex++
      return readCurrent()
    }
    await wait(playbackState, "resumed")
    if (activeSpeech) return
    activeSpeech = await getSpeech([displayTexts[paraIndex]], "original")
    patchBilingualGetInfo(activeSpeech, displayTexts, paraIndex, null)
    await wait(playbackState, "resumed")
    activeSpeech.onEnd = function(err) {
      if (err) {
        if (onEnd) onEnd(err)
      } else {
        activeSpeech = null
        readOriginalParagraph(displayTexts, paraIndex + 1, false)
          .catch(function(err) { if (onEnd) onEnd(err) })
      }
    }
    if (rewinded && paraIndex === 0) await activeSpeech.gotoEnd()
    return activeSpeech.play()
  }

  // 1 clause = 1 chunk, split on sentence-ending and comma punctuation
  function splitIntoSentenceChunks(text) {
    const sentences = text.split(/(?<=[.!?。！？,，])\s+/).map(function(s) { return s.trim() }).filter(Boolean)
    return sentences.length > 0 ? sentences : [text]
  }

  // Process flat chunk array: for each chunk play VN → EN, with 1-chunk look-ahead
  async function readBilingualChunks(displayTexts, chunkParaIndex, chunks, chunkIndex, rewinded, precomputedEnSpeechPromise) {
    console.log("[Bilingual] readBilingualChunks chunkIndex=" + chunkIndex + "/" + chunks.length + " words=" + (chunks[chunkIndex] ? chunks[chunkIndex].split(/\s+/).length : 0) + " activeSpeech=" + !!activeSpeech)
    while (chunkIndex < chunks.length && !chunks[chunkIndex]) chunkIndex++
    if (chunkIndex >= chunks.length) {
      console.log("[Bilingual] all chunks done → next page")
      currentBilingualChunkIndex = null
      currentIndex++
      return readCurrent()
    }
    currentBilingualChunkIndex = chunkIndex
    await wait(playbackState, "resumed")
    if (activeSpeech) { console.log("[Bilingual] activeSpeech exists → skip"); return }
    const chunk = [chunks[chunkIndex]]
    activeSpeech = await getSpeech(chunk, "original")
    patchBilingualGetInfo(activeSpeech, displayTexts, chunkParaIndex[chunkIndex], chunks[chunkIndex])
    await wait(playbackState, "resumed")

    // Use pre-computed EN promise if passed in, otherwise draw from translation cache
    const enSpeechPromise = precomputedEnSpeechPromise ||
      getCachedTranslation(chunks, chunkIndex)
        .then(function(translatedTexts) { return getSpeech(translatedTexts, "english") })
        .catch(function(err) {
          console.error("[Bilingual] EN prefetch error:", err)
          return null
        })

    // Advance prefetch window and build next chunk's EN speech promise from cache
    prefetchTranslations(chunks, chunkIndex + 1)
    let nextChunkIndex = chunkIndex + 1
    while (nextChunkIndex < chunks.length && !chunks[nextChunkIndex]) nextChunkIndex++
    const nextEnSpeechPromise = nextChunkIndex < chunks.length
      ? getCachedTranslation(chunks, nextChunkIndex)
          .then(function(translatedTexts) { return getSpeech(translatedTexts, "english") })
          .catch(function(err) {
            console.error("[Bilingual] EN next-prefetch error:", err)
            return null
          })
      : null

    activeSpeech.onEnd = function(err) {
      console.log("[Bilingual] VN onEnd err=" + (err ? err.message : null))
      if (err) {
        if (onEnd) onEnd(err)
      } else {
        activeSpeech = null
        enSpeechPromise
          .then(async function(enSpeech) {
            if (!enSpeech) throw new Error("EN prefetch failed")
            if (activeSpeech) { console.log("[Bilingual] EN: activeSpeech race → stop EN"); enSpeech.stop(); return }
            activeSpeech = enSpeech
            patchBilingualGetInfo(activeSpeech, displayTexts, chunkParaIndex[chunkIndex], chunks[chunkIndex])
            await wait(playbackState, "resumed")
            activeSpeech.onEnd = function(err) {
              console.log("[Bilingual] EN onEnd err=" + (err ? err.message : null))
              if (err) {
                if (onEnd) onEnd(err)
              } else {
                activeSpeech = null
                readBilingualChunks(displayTexts, chunkParaIndex, chunks, chunkIndex + 1, false, nextEnSpeechPromise)
                  .catch(function(err) { if (onEnd) onEnd(err) })
              }
            }
            console.log("[Bilingual] EN play")
            return activeSpeech.play()
          })
          .catch(function(err) {
            console.error("[Bilingual] EN error, skipping:", err)
            activeSpeech = null
            readBilingualChunks(displayTexts, chunkParaIndex, chunks, chunkIndex + 1, false, nextEnSpeechPromise)
              .catch(function(err2) { if (onEnd) onEnd(err2) })
          })
      }
    }
    console.log("[Bilingual] VN play chunkIndex=" + chunkIndex)
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
      else if (bilingualChunks && currentBilingualChunkIndex !== null) {
        activeSpeech.onEnd = null
        activeSpeech.stop()
        activeSpeech = null
        readBilingualChunks(bilingualDisplayTexts, bilingualChunkParaIndex, bilingualChunks, currentBilingualChunkIndex + 1, false)
          .catch(function(err) { if (onEnd) onEnd(err) })
      }
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
      else if (bilingualChunks && currentBilingualChunkIndex !== null && currentBilingualChunkIndex > 0) {
        activeSpeech.onEnd = null
        activeSpeech.stop()
        activeSpeech = null
        readBilingualChunks(bilingualDisplayTexts, bilingualChunkParaIndex, bilingualChunks, currentBilingualChunkIndex - 1, false)
          .catch(function(err) { if (onEnd) onEnd(err) })
      }
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
        activeSpeech.onEnd = null
        activeSpeech.stop()
        activeSpeech = null
      }
      // n is a paragraph index — find the first chunk belonging to that paragraph
      var chunkIndex = 0
      if (bilingualChunkParaIndex) {
        var found = bilingualChunkParaIndex.indexOf(n)
        if (found >= 0) chunkIndex = found
      }
      return readBilingualChunks(bilingualDisplayTexts, bilingualChunkParaIndex, bilingualChunks, chunkIndex, false)
        .catch(function(err) { if (onEnd) onEnd(err) })
    }
    if (activeSpeech) return activeSpeech.seek(n);
    else return Promise.reject(new Error("Can't seek, not active"));
  }
}
