
const isEmbedded = top != self
var queryString = new URLSearchParams(location.search)
var activeDoc;
var playbackError = null;
var lastUrlPromise = Promise.resolve(null)


const piperSubject = new rxjs.Subject()
const piperObservable = rxjs.throwError(() => new Error("Piper TTS is not available in this version"))
  .pipe(rxjs.shareReplay({bufferSize: 1, refCount: false}))
const piperCallbacks = new rxjs.Subject()
const piperDispatcher = makeDispatcher("piper-host", {
  advertiseVoices({voices}, sender) {
    updateSettings({piperVoices: voices})
    piperSubject.next(sender)
  },
  onStart: args => piperCallbacks.next({type: "start", ...args}),
  onSentence: args => piperCallbacks.next({type: "sentence", ...args}),
  onParagraph: args => piperCallbacks.next({type: "paragraph", ...args}),
  onEnd: args => piperCallbacks.next({type: "end", ...args}),
  onError: args => piperCallbacks.next({type: "error", ...args}),
  audioPlay: args => audioPlayer.play(args.src, args.rate, args.volume),
  audioPause: () => audioPlayer.pause(),
  audioResume: () => audioPlayer.resume(),
})


const supertonicSubject = new rxjs.Subject()
const supertonic$ = rxjs.throwError(() => new Error("Supertonic TTS is not available in this version"))
  .pipe(rxjs.shareReplay({bufferSize: 1, refCount: false}))
const supertonicCallbacks = new rxjs.Subject()
const supertonicDispatcher = makeDispatcher("supertonic-host", {
  advertiseVoices({voices}, sender) {
    updateSettings({supertonicVoices: voices})
    supertonicSubject.next(sender)
  },
  onStart: args => supertonicCallbacks.next({type: "start", ...args}),
  onSentence: args => supertonicCallbacks.next({type: "sentence", ...args}),
  onParagraph: args => supertonicCallbacks.next({type: "paragraph", ...args}),
  onEnd: args => supertonicCallbacks.next({type: "end", ...args}),
  onError: args => supertonicCallbacks.next({type: "error", ...args}),
  audioPlay: args => audioPlayer.play(args.src, args.rate, args.volume),
  audioPause: () => audioPlayer.pause(),
  audioResume: () => audioPlayer.resume(),
})


const audioPlayer = immediate(() => {
  let current
  return {
    play(src, rate, volume) {
      if (current) current.playback.unsubscribe()
      const isBlob = src instanceof Blob
      const url = isBlob ? URL.createObjectURL(src) : src
      const playbackState$ = new rxjs.BehaviorSubject("resumed")
      return new Promise((fulfill, reject) => {
        current = {
          playbackState$,
          playback: playAudio(Promise.resolve(url), {rate, volume}, playbackState$).subscribe({
            complete: fulfill,
            error: reject
          })
        }
        if (isBlob) current.playback.add(() => URL.revokeObjectURL(url))
      })
    },
    pause() {
      if (current) current.playbackState$.next("paused")
    },
    resume() {
      if (current) current.playbackState$.next("resumed")
    }
  }
})


const fasttextSubject = new rxjs.Subject()
const fasttextObservable = rxjs.of(null)
  .pipe(rxjs.shareReplay({bufferSize: 1, refCount: false}))
const fasttextDispatcher = makeDispatcher("fasttext-host", {
  onServiceReady(args, sender) {
    fasttextSubject.next(sender)
  }
})


window.addEventListener("message", event => {
  const send = message => event.source.postMessage(message, {targetOrigin: event.origin})

  piperDispatcher.dispatch(event.data, {
    sendRequest(method, args) {
      const id = String(Math.random())
      send({from: "piper-host", to: "piper-service", type: "request", id, method, args})
      return piperDispatcher.waitForResponse(id)
    }
  }, send)

  supertonicDispatcher.dispatch(event.data, {
    sendRequest(method, args) {
      const id = String(Math.random())
      send({from: "supertonic-host", to: "supertonic-service", type: "request", id, method, args})
      return supertonicDispatcher.waitForResponse(id)
    }
  }, send)

  fasttextDispatcher.dispatch(event.data, {
    sendRequest(method, args) {
      const id = String(Math.random())
      send({from: "fasttext-host", to: "fasttext-service", type: "request", id, method, args})
      return fasttextDispatcher.waitForResponse(id)
    }
  }, send)
})


const idleSubject = new rxjs.BehaviorSubject(true)

// Keep service worker alive via a long-lived port while playback is active.
// The port prevents Chrome from terminating the MV3 service worker mid-playback.
;(function setupPortKeepalive() {
  let port = null
  idleSubject.subscribe(function(isIdle) {
    if (!isIdle && !port) {
      try {
        port = brapi.runtime.connect({name: 'keepAlive'})
        port.onDisconnect.addListener(function() { port = null })
      } catch (e) {
        console.warn('keepAlive port failed', e)
      }
    } else if (isIdle && port) {
      try { port.disconnect() } catch (_) {}
      port = null
    }
  })
})()

if (queryString.has("autoclose")) {
  rxjs.combineLatest(
    idleSubject,
    piperSubject.pipe(rxjs.startWith(null)),
    supertonicSubject.pipe(rxjs.startWith(null))
  ).pipe(
    rxjs.switchMap(([isIdle, piper, supertonic]) =>
      rxjs.iif(
        () => isIdle,
        rxjs.timer(queryString.get("autoclose") == "long" || piper || supertonic ? 15*60*1000 : 5*60*1000),
        rxjs.EMPTY
      )
    )
  ).subscribe(closePlayer)
}


var messageHandlers = {
  playText: playText,
  playTab: playTab,
  stop: stop,
  pause: pause,
  resume: resume,
  getPlaybackState: getPlaybackState,
  forward: forward,
  rewind: rewind,
  seek: seek,
  close: closePlayer,
  shouldPlaySilence: shouldPlaySilence.bind({}),
  startPairing: () => phoneTtsEngine.startPairing(),
  isPaired: () => phoneTtsEngine.isPaired(),
  managePiperVoices,
  manageSupertonicVoices,
  getLastUrl: () => lastUrlPromise,
}

registerMessageListener("player", messageHandlers)

if (queryString.has("opener")) {
  brapi.runtime.sendMessage({dest: queryString.get("opener"), method: "playerCheckIn"})
    .catch(console.error)
} else {
  // Hold a keep-alive port during startup so the SW doesn't terminate before
  // checkInWithSW completes. setupPortKeepalive() takes over once idle→active.
  ;(async function checkInWithSW() {
    let startupPort = null
    try {
      startupPort = brapi.runtime.connect({name: 'keepAlive'})
    } catch (_) {}
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await bgPageInvoke("playerCheckIn")
          return
        } catch (err) {
          if (attempt < 4) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
        }
      }
      console.warn("playerCheckIn: failed to reach service worker after 5 attempts")
    } finally {
      // Release startup port; setupPortKeepalive manages keep-alive from here
      if (startupPort) try { startupPort.disconnect() } catch (_) {}
    }
  })()
}

document.addEventListener("DOMContentLoaded", initialize)



async function initialize() {
  setI18nText()
  setupMediaSession()
  setupVisibilityResume()

  $("#hidethistab-link")
    .toggle(canUseEmbeddedPlayer() && !(await getSettings()).useEmbeddedPlayer)
    .click(function() {
      $("#dialog-backdrop, #hidethistab-dialog").show()
    })

  $("#hidethistab-dialog .btn, #hidethistab-dialog .close")
    .click(function(event) {
      $("#dialog-backdrop, #hidethistab-dialog").hide()
      if ($(event.target).is(".btn-ok")) {
        updateSettings({useEmbeddedPlayer: true})
          .then(() => window.close())
          .catch(console.error)
      }
    })
}

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.setActionHandler('play', function() { resume() })
  navigator.mediaSession.setActionHandler('pause', function() { pause() })
  navigator.mediaSession.setActionHandler('stop', function() { stop() })
  navigator.mediaSession.setActionHandler('previoustrack', function() { rewind() })
  navigator.mediaSession.setActionHandler('nexttrack', function() { forward() })
  // MediaMetadata artwork requires http/https/data/blob scheme, not chrome-extension://
  fetch(brapi.runtime.getURL('img/icon.png'))
    .then(function(r) { return r.blob() })
    .then(function(blob) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Read Aloud',
        artist: 'Read Aloud',
        artwork: [{src: URL.createObjectURL(blob), sizes: '128x128', type: 'image/png'}]
      })
    })
    .catch(function() {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Read Aloud',
        artist: 'Read Aloud',
      })
    })
}

function setMediaSessionState(state) {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.playbackState = state
}

function setupVisibilityResume() {
  document.addEventListener("visibilitychange", function() {
    if (!document.hidden) {
      // Screen turned back on — resume audio if it was playing before screen off
      getPlaybackState().then(function(state) {
        if (state.state === "PLAYING") resume()
      }).catch(console.error)
    }
  })
}

function playText(text, opts) {
  opts = opts || {}
  playbackError = null
  if (!activeDoc) {
    openDoc(new SimpleSource(text.split(/(?:\r?\n){2,}/), {lang: opts.lang}), function(err) {
      if (err) playbackError = err
    })
  }
  const doc = activeDoc
  return activeDoc.play()
    .catch(function(err) {
      if (doc == activeDoc) {
        handleError(err);
        closeDoc();
      }
      throw err;
    })
}

function playTab() {
  console.log("[Player] playTab() activeDoc=" + !!activeDoc)
  playbackError = null
  if (!activeDoc) {
    openDoc(new TabSource(), function(err) {
      if (err) playbackError = err
    })
  }
  const doc = activeDoc
  return activeDoc.play()
    .catch(function(err) {
      if (doc == activeDoc) {
        handleError(err);
        closeDoc();
      }
      throw err;
    })
}

function stop() {
  console.log("[Player] stop() activeDoc=" + !!activeDoc)
  if (activeDoc) {
    activeDoc.stop();
    closeDoc();
  }
  return true;
}

function pause() {
  console.log("[Player] pause() activeDoc=" + !!activeDoc)
  setMediaSessionState("paused")
  if (activeDoc) return activeDoc.pause();
  else return Promise.resolve();
}

function resume() {
  console.log("[Player] resume() activeDoc=" + !!activeDoc)
  setMediaSessionState("playing")
  if (activeDoc) return activeDoc.play()
  else return Promise.resolve()
}

function getPlaybackState() {
  if (activeDoc) {
    return Promise.all([activeDoc.getState(), activeDoc.getActiveSpeech()])
      .then(function(results) {
        return {
          state: results[0],
          speechInfo: results[1] && results[1].getInfo(),
          playbackError: errorToJson(playbackError),
        }
      })
      .finally(() => {
        playbackError = null
      })
  }
  else {
    return Promise.resolve({
      state: "STOPPED",
      playbackError: errorToJson(playbackError),
    })
  }
}

// Plays silence in the player tab (real DOM page) for the entire reading session.
// This establishes Android audio focus so Kiwi Browser is not suspended when the
// screen is off or another app is in the foreground.
// If autoplay is blocked (player tab never had focus), falls back to the existing
// requestAudioPlaybackPermission flow which briefly focuses the tab to unlock audio.
const playerTabSilence = (function() {
  const audio = new Audio(brapi.runtime.getURL("sound/silence.mp3"))
  audio.loop = true
  async function start() {
    try {
      await audio.play()
    } catch(e) {
      if (e.name === 'NotAllowedError') {
        await requestAudioPlaybackPermission()
        audio.play().catch(console.error)
      } else {
        console.error('playerTabSilence:', e)
      }
    }
  }
  return {
    start,
    stop() { audio.pause(); audio.currentTime = 0 },
  }
})()

function openDoc(source, onEnd) {
  const doc = activeDoc = new Doc(source, function(err) {
    handleError(err);
    if (activeDoc === doc) closeDoc();
    if (typeof onEnd == "function") onEnd(err);
  })
  idleSubject.next(false)
  lastUrlPromise = Promise.resolve(source.getUri())
  setMediaSessionState("playing")
  playerTabSilence.start()
}

function closeDoc() {
  if (activeDoc) {
    activeDoc.close();
    activeDoc = null;
    idleSubject.next(true)
    setMediaSessionState("none")
    playerTabSilence.stop()
    if (brapi.offscreen) {
      sendToOffscreen({method: "stop"}).catch(console.error)
    }
  }
}

function forward() {
  if (activeDoc) return activeDoc.forward();
  else return Promise.reject(new Error("Can't forward, not active"));
}

function rewind() {
  if (activeDoc) return activeDoc.rewind();
  else return Promise.reject(new Error("Can't rewind, not active"));
}

function seek(n) {
  if (activeDoc) return activeDoc.seek(n);
  else return Promise.reject(new Error("Can't seek, not active"));
}

function closePlayer() {
  if (top == self) window.close()
  else location.href = "about:blank"
}

function handleError(err) {
  if (err) {
    var code = /^{/.test(err.message) ? JSON.parse(err.message).code : err.message;
    if (code == "error_payment_required") clearSettings(["voiceName"]);
    reportError(err);
  }
}

function reportError(err) {
  if (err && err.stack) {
    var details = err.stack;
    if (!details.startsWith(err.name)) details = err.name + ": " + err.message + "\n" + details;
    console.error(details)
    lastUrlPromise
      .then(url => bgPageInvoke("reportIssue", [url, details]))
      .catch(console.error)
  }
}

function playAudio(urlPromise, options, playbackState$) {
  if (brapi.offscreen) {
    return playAudioOffscreen(urlPromise, options, playbackState$)
  }
  else {
    return playAudioHere(requestAudioPlaybackPermission().then(() => urlPromise), options, playbackState$).pipe(
      rxjs.catchError(err => {
        if (err.message === 'NotAllowedError') {
          requestAudioPlaybackPermission = makeAudioPlaybackPermissionRequest()
          return playAudioHere(requestAudioPlaybackPermission().then(() => urlPromise), options, playbackState$)
        }
        return rxjs.throwError(() => err)
      })
    )
  }
}

function makeAudioPlaybackPermissionRequest() {
  return lazy(async function() {
    const thisTab = await brapi.tabs.getCurrent()
    const prevTab = await brapi.tabs.query({windowId: thisTab.windowId, active: true}).then(tabs => tabs[0])
    await brapi.tabs.update(thisTab.id, {active: true})
    $("#dialog-backdrop, #audio-playback-permission-dialog").show()
    await new Audio(brapi.runtime.getURL("sound/silence.mp3")).play()
    $("#dialog-backdrop, #audio-playback-permission-dialog").hide()
    await brapi.tabs.update(prevTab.id, {active: true})
  })
}

var requestAudioPlaybackPermission = makeAudioPlaybackPermissionRequest()

async function createOffscreen() {
  const readyPromise = new Promise(f => messageHandlers.offscreenCheckIn = f)
  brapi.offscreen.createDocument({
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Read Aloud would like to play audio in the background",
    url: brapi.runtime.getURL("offscreen.html")
  })
  await readyPromise
}

function playAudioOffscreen(urlPromise, options, playbackState$) {
  return rxjs.from(urlPromise).pipe(
    rxjs.exhaustMap(url =>
      playbackState$.pipe(
        rxjs.distinctUntilChanged(),
        rxjs.skipWhile(state => state != "resumed"),
        rxjs.scan((playback$, state) => {
          if (state == "resumed") {
            return rxjs.defer(async () => {
              if (!playback$) {
                const result = await sendToOffscreen({method: "play", args: [url, options]})
                if (result != true) throw "Offscreen doc not present"
              } else {
                const result = await sendToOffscreen({method: "resume"})
                if (result != true) throw "Offscreen doc gone"
              }
            }).pipe(
              rxjs.catchError(err => {
                console.debug(err)
                return rxjs.defer(createOffscreen).pipe(
                  rxjs.exhaustMap(async () => {
                    const result = await sendToOffscreen({method: "play", args: [url, options]})
                    if (result != true) throw new Error("Offscreen doc inaccessible")
                  })
                )
              }),
              rxjs.exhaustMap(() =>
                rxjs.NEVER.pipe(
                  rxjs.finalize(() => {
                    sendToOffscreen({method: "pause"})
                      .catch(console.error)
                  })
                )
              )
            )
          } else {
            return rxjs.EMPTY
          }
        }, null),
        rxjs.switchAll()
      )
    ),
    rxjs.mergeWith(
      new rxjs.Observable(observer => {
        messageHandlers.offscreenPlaybackEvent = function(event) {
          if (event.type == "error") observer.error(event.error)
          else observer.next(event)
        }
      })
    ),
    rxjs.takeWhile(event => event.type != "end", true)
  )
}

async function sendToOffscreen(message) {
  message.dest = "offscreen"
  const result = await brapi.runtime.sendMessage(message)
    .catch(err => {
      if (/^(A listener indicated|Could not establish)/.test(err.message)) throw new Error(err.message + " " + message.method)
      throw err
    })
  if (result && result.error) throw result.error
  else return result
}

async function shouldPlaySilence(providerId) {
  const should = await getPlaybackState().then(x => x.state == "PLAYING")
  const now = Date.now()
  if (providerId == this.providerId) {
    this.nextExpectedCheckIn = now + (now - this.lastCheckIn)
    this.lastCheckIn = now
    return should
  }
  else {
    if (now < this.nextExpectedCheckIn) {
      return false
    }
    else {
      this.providerId = providerId
      this.lastCheckIn = now
      return should
    }
  }
}

function managePiperVoices() {
  if (isEmbedded) {
    return "POPOUT"
  }
  else {
    rxjs.firstValueFrom(piperObservable)
      .catch(console.error)
    brapi.tabs.getCurrent()
      .then(tab => Promise.all([
        brapi.windows.update(tab.windowId, {focused: true}),
        brapi.tabs.update(tab.id, {active: true})
      ]))
      .catch(console.error)
    return "OK"
  }
}

function createPiperFrame() {
}

function raisePiperFrame() {
  const maxZ = $('iframe').get().reduce((max, f) => Math.max(max, Number(f.style.zIndex) || 0), 0)
  $('#piper-frame').css('z-index', maxZ + 1)
}

function manageSupertonicVoices() {
  if (isEmbedded) {
    return "POPOUT"
  } else {
    rxjs.firstValueFrom(supertonic$)
      .catch(console.error)
    brapi.tabs.getCurrent()
      .then(tab => Promise.all([
        brapi.windows.update(tab.windowId, {focused: true}),
        brapi.tabs.update(tab.id, {active: true})
      ]))
      .catch(console.error)
    return "OK"
  }
}

function createSupertonicFrame() {
}

function raiseSupertonicFrame() {
  const maxZ = $('iframe').get().reduce((max, f) => Math.max(max, Number(f.style.zIndex) || 0), 0)
  $('#supertonic-frame').css('z-index', maxZ + 1)
}

function createFasttextFrame() {
}
