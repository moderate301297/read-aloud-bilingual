
brapi.runtime.onInstalled.addListener(function() {
  installContentScripts()
  installContextMenus()
})


/**
 * Keep-alive: prevent service worker from being terminated during playback.
 *
 * Strategy 1 — chrome.alarms fires every 20 s to wake the SW if Chrome killed it.
 * Strategy 2 — a long-lived port from the player tab blocks termination while open.
 */
if (brapi.alarms) {
  brapi.alarms.onAlarm.addListener(function(alarm) {
    if (alarm.name === 'keepAlive') {
      // Intentionally empty — firing the alarm keeps the SW alive
    }
  })
}

var keepAlivePort = null

brapi.runtime.onConnect.addListener(function(port) {
  if (port.name === 'keepAlive') {
    keepAlivePort = port
    port.onDisconnect.addListener(function() {
      keepAlivePort = null
    })
  }
})

function startKeepAlive() {
  if (brapi.alarms) {
    brapi.alarms.create('keepAlive', { periodInMinutes: 1/3 })
  }
}

function stopKeepAlive() {
  if (brapi.alarms) {
    brapi.alarms.clear('keepAlive')
  }
}


/**
 * IPC handlers
 */
var handlers = {
  playText: playText,
  playTab: playTab,
  reloadAndPlayTab: reloadAndPlayTab,
  stop: stop,
  pause: pause,
  resume: resume,
  getPlaybackState: getPlaybackState,
  forward: forward,
  rewind: rewind,
  seek: seek,
  reportIssue: reportIssue,
  authWavenet: authWavenet,
  managePiperVoices,
  manageSupertonicVoices,
  autoNextChapter: autoNextChapter,
  playerCheckIn: function() {},
}

registerMessageListener("serviceWorker", handlers)


/**
 * Installers
 */
async function installContentScripts() {
  const scripts = [
    {
      matches: ["https://docs.google.com/document/*"],
      id: "google-docs",
      js: ["js/page/google-doc.js"],
      runAt: "document_start",
      world: "MAIN"
    },
  ]
  const registeredIds = await brapi.scripting.getRegisteredContentScripts({ids: scripts.map(x => x.id)})
    .then(scripts => scripts.map(x => x.id))
    .catch(err => {
      console.error(err)
      return []
    })
  if (registeredIds.length) {
    console.info("Already registered content scripts", registeredIds)
  }
  const scriptsToRegister = scripts.filter(script => !registeredIds.includes(script.id))
  for (const script of scriptsToRegister) {
    await brapi.scripting.registerContentScripts([script])
      .then(() => console.info("Successfully registered content script", script.id))
      .catch(err => console.error("Failed to register content script", script.id, err))
  }
}

function installContextMenus() {
  if (brapi.contextMenus)
  brapi.contextMenus.create({
    id: "read-selection",
    title: brapi.i18n.getMessage("context_read_selection"),
    contexts: ["selection"]
  },
  function() {
    if (brapi.runtime.lastError) console.error(brapi.runtime.lastError)
    else console.info("Installed context menus")
  })
}


/**
 * Context menu handlers
 */
if (brapi.contextMenus)
brapi.contextMenus.onClicked.addListener(function(info, tab) {
  if (info.menuItemId == "read-selection")
    Promise.resolve()
      .then(function() {
        if (tab && tab.id != -1) return detectTabLanguage(tab.id)
        else return undefined
      })
      .then(function(lang) {
        return playText(info.selectionText, {lang: lang})
      })
      .catch(handleHeadlessError)
})


/**
 * Shortcut keys handlers
 */
if (brapi.commands)
brapi.commands.onCommand.addListener(function(command) {
  if (command == "play" || command == "pause") {
    getPlaybackState()
      .then(function(stateInfo) {
        switch (stateInfo.state) {
          case "PLAYING": return command == "pause" ? pause() : stop()
          case "PAUSED": return resume()
          case "STOPPED": return playTab()
        }
      })
      .catch(handleHeadlessError)
  }
  else if (command == "stop") {
    stop()
      .catch(handleHeadlessError)
  }
  else if (command == "forward") {
    forward()
      .catch(handleHeadlessError)
  }
  else if (command == "rewind") {
    rewind()
      .catch(handleHeadlessError)
  }
})


/**
 * Listener for external calls
 */
brapi.runtime.onMessageExternal.addListener(
  (request, sender) => {
    if (request.method == "play" && typeof request.text == "string") {
      playText(request.text)
        .catch(handleHeadlessError)
    }
    else if (request.method == "pause") {
      pause()
        .catch(handleHeadlessError)
    }
    else if (request.method == "stop") {
      stop()
        .catch(handleHeadlessError)
    }
    else if (request.method == "resume") {
      resume()
        .catch(handleHeadlessError)
    }
    else {
      handleHeadlessError(new Error("Bad method call"))
    }
  })



/**
 * METHODS
 */
var currentTask = {
  task: null,
  isActive() {
    return this.task && this.task.isActive
  },
  begin() {
    if (this.task) this.task.cancel()
    return this.task = {
      isActive: true,
      cancel() {
        this.isActive = false
      },
      end() {
        if (!this.isActive) throw new Error("Canceled")
        this.isActive = false
      }
    }
  },
  cancel() {
    if (this.task) {
      this.task.cancel()
      this.task = null
    }
  }
}

async function playText(text, opts) {
  const hasPlayer = await stop().then(res => res == true, err => false)
  if (!hasPlayer) await injectPlayer(await getActiveTab())
  startKeepAlive()
  await sendToPlayer({method: "playText", args: [text, opts]})
}

async function playTab(tabId) {
  const tab = tabId ? await getTab(tabId) : await getActiveTab()
  if (!tab) throw new Error(JSON.stringify({code: "error_page_unreadable"}))

  const task = currentTask.begin()
  try {
    const handler = contentHandlers.find(h => h.match(tab.url || "", tab.title))
    if (handler.validate) await handler.validate(tab)
    if (handler.getSourceUri) {
      await brapi.storage.local.set({"sourceUri": handler.getSourceUri(tab)})
    }
    else {
      const frameId = handler.getFrameId && await getAllFrames(tab.id).then(frames => handler.getFrameId(frames))
      if (!await contentScriptAlreadyInjected(tab, frameId)) await injectContentScript(tab, frameId, handler.extraScripts)
      await brapi.storage.local.set({"sourceUri": "contentscript:" + tab.id})
    }
  }
  finally {
    task.end()
  }

  const hasPlayer = await stop().then(res => res == true, err => false)
  if (!hasPlayer) await injectPlayer(tab)
  startKeepAlive()
  await sendToPlayer({method: "playTab"})
}

async function reloadAndPlayTab(tabId) {
  const tab = tabId ? await getTab(tabId) : await getActiveTab()

  const task = currentTask.begin()
  try {
    const tabLoadComplete = new Promise(fulfill => {
      function listener(changeTabId, changeInfo) {
        if (changeTabId == tab.id && changeInfo.status == "complete") {
          brapi.tabs.onUpdated.removeListener(listener)
          fulfill()
        }
      }
      brapi.tabs.onUpdated.addListener(listener)
    })
    await brapi.tabs.reload(tab.id)
    await tabLoadComplete
  }
  finally {
    task.end()
  }

  await playTab(tab.id)
}

function stop() {
  currentTask.cancel()
  stopKeepAlive()
  return sendToPlayer({method: "stop"})
}

function pause() {
  return sendToPlayer({method: "pause"})
}

function resume() {
  return sendToPlayer({method: "resume"})
}

async function getPlaybackState() {
  if (currentTask.isActive()) return {state: "LOADING"}
  try {
    return await sendToPlayer({method: "getPlaybackState"}) || {state: "STOPPED"}
  }
  catch (err) {
    return {state: "STOPPED"}
  }
}

function forward() {
  return sendToPlayer({method: "forward"})
}

function rewind() {
  return sendToPlayer({method: "rewind"})
}

function seek(n) {
  return sendToPlayer({method: "seek", args: [n]})
}



function handleHeadlessError(err) {
  console.error(err)
  //TODO: let user knows somehow
}

function reportIssue(url, comment) {
  var manifest = brapi.runtime.getManifest();
  return getSettings()
    .then(function(settings) {
      if (url) settings.url = url;
      settings.version = manifest.version;
      settings.userAgent = navigator.userAgent;
      return ajaxPost(config.serviceUrl + "/read-aloud/report-issue", {
        url: JSON.stringify(settings),
        comment: comment
      })
    })
}

function authWavenet() {
  createTab("https://cloud.google.com/text-to-speech/#put-text-to-speech-into-action", true)
    .then(function(tab) {
      addRequestListener();
      brapi.tabs.onRemoved.addListener(onTabRemoved);
      return showInstructions();

      function addRequestListener() {
        brapi.webRequest.onBeforeRequest.addListener(onRequest, {
          urls: ["https://cxl-services.appspot.com/proxy*"],
          tabId: tab.id
        })
      }
      function onTabRemoved(tabId) {
        if (tabId == tab.id) {
          brapi.tabs.onRemoved.removeListener(onTabRemoved);
          brapi.webRequest.onBeforeRequest.removeListener(onRequest);
        }
      }
      function onRequest(details) {
        var parser = new URL(details.url);
        var qs = parser.search ? parseQueryString(parser.search) : {};
        if (qs.token) {
          updateSettings({gcpToken: qs.token});
          showSuccess();
        }
      }
      function showInstructions() {
        return brapi.scripting.executeScript({
          target: {tabId: tab.id},
          func: function() {
            var elem = document.createElement('DIV')
            elem.id = 'ra-notice'
            elem.style.position = 'fixed'
            elem.style.top = '0'
            elem.style.left = '0'
            elem.style.right = '0'
            elem.style.backgroundColor = 'yellow'
            elem.style.padding = '20px'
            elem.style.fontSize = 'larger'
            elem.style.zIndex = 999000
            elem.style.textAlign = 'center'
            elem.innerHTML = 'Please click the blue SPEAK-IT button, then check the I-AM-NOT-A-ROBOT checkbox.'
            document.body.appendChild(elem)
          }
        })
      }
      function showSuccess() {
        return brapi.scripting.executeScript({
          target: {tabId: tab.id},
          func: function() {
            var elem = document.getElementById('ra-notice')
            elem.style.backgroundColor = '#0d0'
            elem.innerHTML = 'Successful, you can now use Google Wavenet voices. You may close this tab.'
          }
        })
      }
    })
}

async function openPdfViewer(tabId, pdfUrl) {
  const perms = {
    origins: ["http://*/", "https://*/"]
  }
  if (!await brapi.permissions.contains(perms)) {
    throw new Error(JSON.stringify({code: "error_add_permissions", perms: perms}))
  }
  await setTabUrl(tabId, brapi.runtime.getURL("pdf-viewer.html?url=" + encodeURIComponent(pdfUrl)))
  await new Promise(f => handlers.pdfViewerCheckIn = f)
}

async function managePiperVoices() {
  const result = await sendToPlayer({method: "managePiperVoices"}).catch(err => false)
  if (result != "OK") {
    if (result == "POPOUT") await sendToPlayer({method: "close"})
    await injectPlayer()
    await sendToPlayer({method: "managePiperVoices"})
  }
}

async function manageSupertonicVoices() {
  const result = await sendToPlayer({method: "manageSupertonicVoices"}).catch(err => false)
  if (result != "OK") {
    if (result == "POPOUT") await sendToPlayer({method: "close"})
    await injectPlayer()
    await sendToPlayer({method: "manageSupertonicVoices"})
  }
}



async function contentScriptAlreadyInjected(tab, frameId) {
  const items = await brapi.scripting.executeScript({
    target: {
      tabId: tab.id,
      frameIds: frameId ? [frameId] : undefined,
    },
    func: function() {
      return typeof brapi != "undefined"
    }
  })
  return items[0].result == true
}

async function injectContentScript(tab, frameId, extraScripts) {
  await brapi.scripting.executeScript({
    target: {
      tabId: tab.id,
      frameIds: frameId ? [frameId] : undefined,
    },
    files: [
      "js/rxjs.umd.min.js",
      "js/jquery-3.7.1.min.js",
      "js/defaults.js",
      "js/messaging.js",
      "js/content.js",
    ]
  })
  const files = extraScripts || await brapi.tabs.sendMessage(tab.id, {dest: "contentScript", method: "getRequireJs"})
  await brapi.scripting.executeScript({
    target: {
      tabId: tab.id,
      frameIds: frameId ? [frameId] : undefined,
    },
    files: files
  })
  console.info("Content handler", files)
}

// On Android, the player tab is a background tab that Chrome can freeze.
// Embedded player (iframe in the active content tab) avoids this by running
// in the foreground context, which maintains Android audio focus automatically.
const isAndroid = /Android/i.test(navigator.userAgent)

async function injectPlayer(tab) {
  const settings = await getSettings(["useEmbeddedPlayer", "piperVoices", "supertonicVoices"])
  const promise = new Promise(f => handlers.playerCheckIn = f)
  const preferEmbedded = settings.useEmbeddedPlayer || isAndroid
  if (tab && preferEmbedded
    //don't use embedded player if there are Piper or Supertonic voices installed
    && (settings.piperVoices || []).length == 0
    && (settings.supertonicVoices || []).length == 0
  ) {
    try {
      if (tab.incognito) {
        //https://developer.chrome.com/docs/extensions/mv3/manifest/incognito/
        throw new Error("Incognito tab")
      }
      await brapi.scripting.executeScript({
        target: {tabId: tab.id},
        func: createPlayerFrame
      })
    }
    catch (err) {
      console.warn("Cannot embed player", err)
      await createPlayerTab()
    }
  }
  else {
    await createPlayerTab()
  }
  // Timeout fallback: if playerCheckIn never arrives (e.g. SW restarting when
  // the new tab loads), don't hang forever — the player tab is likely still
  // alive and will respond to sendToPlayer messages directly.
  await Promise.race([
    promise,
    new Promise(resolve => setTimeout(resolve, 10000))
  ])
}

function createPlayerFrame() {
  const brapi = (typeof chrome != 'undefined') ? chrome : (typeof browser != 'undefined' ? browser : {})
  const frame = document.createElement("iframe")
  frame.src = brapi.runtime.getURL("player.html")
  frame.style.position = "absolute"
  frame.style.height = "0"
  frame.style.borderWidth = "0"
  document.body.appendChild(frame)
}

async function createPlayerTab() {
  const tab = await brapi.tabs.create({
    url: brapi.runtime.getURL("player.html?autoclose"),
    index: 0,
    active: false,
  })
  await brapi.tabs.update(tab.id, {pinned: true})
  function onPlayerTabRemoved(tabId) {
    if (tabId === tab.id) {
      brapi.tabs.onRemoved.removeListener(onPlayerTabRemoved)
      currentTask.cancel()
    }
  }
  brapi.tabs.onRemoved.addListener(onPlayerTabRemoved)
}



async function sendToPlayer(message) {
  message.dest = "player"
  const result = await Promise.race([
    brapi.runtime.sendMessage(message),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Player timeout")), 3000))
  ])
  if (result && result.error) throw result.error
  else return result
}


// Auto-next chapter delegated from embedded player (Android/Kiwi).
// The embedded player iframe is destroyed when its parent tab navigates,
// so we handle navigation + player re-creation here in the service worker.
async function autoNextChapter(tabId, nextUrl) {
  await swNavigateTabAndInject(tabId, nextUrl)
  await playTab(tabId)
}

async function swNavigateTabAndInject(tabId, url) {
  await new Promise((resolve, reject) => {
    let warned = false

    // On Android/Kiwi, Kiwi can defer background-tab navigation until the tab
    // is activated by the user (same as Chrome Memory Saver on desktop).
    // Give a generous 90 s so the user just needs to tap the tab once.
    const timeout = setTimeout(() => {
      brapi.tabs.onUpdated.removeListener(onUpdated)
      reject(new Error("Tab navigation timed out"))
    }, 90000)

    // After 5 s without a real 'complete', check if the tab is discarded and
    // inject a toast into the active tab so the user knows to tap the novel tab.
    const warnTimer = setTimeout(async () => {
      try {
        const tab = await brapi.tabs.get(tabId)
        if (tab.discarded && !warned) {
          warned = true
          const [activeTab] = await brapi.tabs.query({active: true, currentWindow: true})
          if (activeTab) {
            brapi.scripting.executeScript({
              target: {tabId: activeTab.id},
              func: function(msg) {
                var el = document.createElement('div')
                el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:12px 22px;border-radius:8px;z-index:2147483647;font-size:14px;pointer-events:none'
                el.textContent = msg
                document.body.appendChild(el)
                setTimeout(function() { el.remove() }, 8000)
              },
              args: ['Nhấp vào tab truyện để tiếp tục chương mới']
            }).catch(function() {})
          }
        }
      } catch (_) {}
    }, 5000)

    function onUpdated(id, info, tab) {
      if (id !== tabId || info.status !== 'complete') return
      if (tab.discarded) return
      brapi.tabs.onUpdated.removeListener(onUpdated)
      clearTimeout(timeout)
      clearTimeout(warnTimer)
      setTimeout(resolve, 800)
    }
    brapi.tabs.onUpdated.addListener(onUpdated)
    brapi.tabs.update(tabId, {url}).catch(err => {
      brapi.tabs.onUpdated.removeListener(onUpdated)
      clearTimeout(timeout)
      clearTimeout(warnTimer)
      reject(err)
    })
  })

  const target = {tabId}
  await brapi.scripting.executeScript({target, files: [
    "js/rxjs.umd.min.js",
    "js/jquery-3.7.1.min.js",
    "js/defaults.js",
    "js/messaging.js",
    "js/content.js",
  ]})

  // On Android, content scripts may take longer to set up their message listener.
  // Retry generously before giving up.
  let files = null
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      files = await brapi.tabs.sendMessage(tabId, {dest: "contentScript", method: "getRequireJs"})
      break
    } catch (err) {
      if (attempt < 7) await new Promise(r => setTimeout(r, 800))
      else throw err
    }
  }
  if (files && files.length) {
    await brapi.scripting.executeScript({target, files})
  }
}
