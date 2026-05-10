
(function() {
  registerMessageListener("offscreen", {
    play: play,
    pause: pause,
    resume: resume,
    stop: stopSession,
  })

  sendToPlayer({method: "offscreenCheckIn"})
    .catch(console.error)


  // Session-level silence track: runs continuously while any sentence is active,
  // including gaps between sentences where silenceTrack inside playAudioHere has
  // already stopped. This keeps the Android audio focus alive so the OS does not
  // suspend Kiwi Browser mid-session.
  const sessionSilence = new Audio(brapi.runtime.getURL("sound/silence.mp3"))
  sessionSilence.loop = true

  const current$ = new rxjs.BehaviorSubject(null)

  current$.subscribe(function(current) {
    if (current) {
      sessionSilence.play().catch(console.error)
    } else {
      sessionSilence.pause()
      sessionSilence.currentTime = 0
    }
  })

  current$.pipe(
    rxjs.switchMap(current => {
      if (current) {
        return playAudioHere(Promise.resolve(current.url), current.options, current.playbackState$).pipe(
          rxjs.catchError(err => rxjs.of({type: "error", error: errorToJson(err)})),
          rxjs.tap(event => {
            sendToPlayer({method: "offscreenPlaybackEvent", args: [event]})
              .catch(console.error)
          })
        )
      } else {
        return rxjs.EMPTY
      }
    })
  ).subscribe()



  function play(url, options) {
    current$.next({
      url,
      options,
      playbackState$: new rxjs.BehaviorSubject("resumed")
    })
    return true
  }

  function pause() {
    current$.value.playbackState$.next("paused")
    return true
  }

  function resume() {
    current$.value.playbackState$.next("resumed")
    return true
  }

  function stopSession() {
    current$.next(null)
    return true
  }


  async function sendToPlayer(message) {
    message.dest = "player"
    const result = await brapi.runtime.sendMessage(message)
    if (result && result.error) throw result.error
    else return result
  }
})();
