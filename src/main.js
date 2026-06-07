import mqtt from 'mqtt'
import { defaultRelayUrls, getRelaySockets, joinRoom, selfId } from '@trystero-p2p/mqtt'
import './styles.css'

const appId = 'github-pages-trystero-boilerplate'
const url = new URL(window.location.href)
const initialRoom = url.searchParams.get('room') || randomRoomName()

const elements = {
  form: document.querySelector('#room-form'),
  roomInput: document.querySelector('#room-name'),
  status: document.querySelector('#status'),
  selfId: document.querySelector('#self-id'),
  peerCount: document.querySelector('#peer-count'),
  relayStatus: document.querySelector('#relay-status'),
  elapsedTime: document.querySelector('#elapsed-time'),
  peerList: document.querySelector('#peer-list'),
  lastMessage: document.querySelector('#last-message'),
  pingButton: document.querySelector('#ping-button'),
  smokeButton: document.querySelector('#smoke-button'),
  appId: document.querySelector('#app-id'),
  activeRoom: document.querySelector('#active-room'),
  pageUrl: document.querySelector('#page-url'),
  secureContext: document.querySelector('#secure-context'),
  peerMap: document.querySelector('#peer-map'),
  relayDetails: document.querySelector('#relay-details'),
  log: document.querySelector('#log'),
}

let room
let sendPing
let connectedPeers = new Set()
let activeRoomName = ''
let joinStartedAt = 0
let smokeTest
const hasRequiredCrypto = Boolean(window.crypto?.subtle)
const socketStateLabels = ['Connecting', 'Open', 'Closing', 'Closed']
const socketListeners = new WeakSet()

elements.appId.textContent = appId
elements.pageUrl.textContent = window.location.href
elements.secureContext.textContent = window.isSecureContext ? 'Yes' : 'No'

elements.roomInput.value = initialRoom
elements.form.addEventListener('submit', (event) => {
  event.preventDefault()
  joinNamedRoom(elements.roomInput.value)
})
elements.pingButton.addEventListener('click', () => {
  if (!sendPing) {
    return
  }

  const message = {
    from: selfId,
    sentAt: new Date().toISOString(),
  }

  sendPing(message)
    .then(() => noteMessage(`Ping sent from ${shortId(selfId)}`))
    .catch((error) => {
      addLog(`Ping failed: ${formatError(error)}`)
      console.error('[trystero-demo] ping failed', error)
    })
})
elements.smokeButton.addEventListener('click', () => {
  sendSmokeTest()
})

joinNamedRoom(initialRoom)
setInterval(updateDiagnostics, 1000)

function joinNamedRoom(roomName) {
  const normalizedRoomName = roomName.trim()

  if (!normalizedRoomName) {
    addLog('Enter a room name before joining.')
    return
  }

  if (room) {
    room.leave()
  }

  activeRoomName = normalizedRoomName
  connectedPeers = new Set()
  joinStartedAt = Date.now()
  resetSmokeTest()
  updateRoomUrl(normalizedRoomName)
  elements.activeRoom.textContent = activeRoomName
  elements.pageUrl.textContent = window.location.href

  if (!hasRequiredCrypto) {
    updateConnectionUi('Needs HTTPS or localhost')
    addLog('Trystero needs crypto.subtle, which browsers only expose on localhost or HTTPS.')
    return
  }

  updateConnectionUi('Joining room...')
  addLog(`Joining room "${normalizedRoomName}" as ${shortId(selfId)}.`)
  console.info('[trystero-demo] joining room', {
    appId,
    roomName: normalizedRoomName,
    selfId,
    url: window.location.href,
  })

  room = joinRoom({ appId }, normalizedRoomName, {
    onJoinError: ({ peerId, error }) => {
      addLog(`Join error for ${shortId(peerId)}: ${formatError(error)}`)
      console.error('[trystero-demo] join error', { peerId, error })
    },
  })

  setupSmokeTest(normalizedRoomName)
  updateDiagnostics()
  const pingAction = room.makeAction('ping')
  sendPing = pingAction.send

  room.onPeerJoin = (peerId) => {
    connectedPeers.add(peerId)
    updateConnectionUi('Connected')
    addLog(`Peer joined: ${shortId(peerId)} after ${elapsedJoinSeconds()}s.`)
    console.info('[trystero-demo] peer joined', { peerId, peers: Object.keys(room.getPeers()) })
  }

  room.onPeerLeave = (peerId) => {
    connectedPeers.delete(peerId)
    updateConnectionUi(connectedPeers.size ? 'Connected' : 'Waiting for another peer')
    addLog(`Peer left: ${shortId(peerId)}.`)
    console.info('[trystero-demo] peer left', { peerId, peers: Object.keys(room.getPeers()) })
  }

  pingAction.onMessage = (message, { peerId }) => {
    const sentAt = message?.sentAt ? new Date(message.sentAt).toLocaleTimeString() : 'unknown time'
    noteMessage(`Ping received from ${shortId(peerId)} at ${sentAt}`)
  }

  updateConnectionUi('Waiting for another peer')
}

function updateDiagnostics() {
  updateRelayStatus()
  updatePeerMap()
  updateElapsedTime()
}

function updateRelayStatus() {
  const relaySockets = getRelaySockets()
  const relayEntries = Object.entries(relaySockets)

  if (relayEntries.length === 0) {
    elements.relayStatus.textContent = 'No relay sockets yet'
    elements.relayDetails.textContent = 'No relay sockets yet'
    return
  }

  relayEntries.forEach(([relayUrl, socket]) => attachSocketDiagnostics(relayUrl, socket))

  elements.relayStatus.textContent = relayEntries
    .map(([url, socket]) => {
      const state = socketStateLabels[socket.readyState] || `State ${socket.readyState}`
      return `${new URL(url).host}: ${state}`
    })
    .join(', ')

  elements.relayDetails.textContent = relayEntries
    .map(([url, socket]) => {
      const state = socketStateLabels[socket.readyState] || `State ${socket.readyState}`
      return `${url} (${state})`
    })
    .join('\n')
}

function setupSmokeTest(roomName) {
  const topic = smokeTopic(roomName)
  const clients = defaultRelayUrls.map((relayUrl) => {
    const client = mqtt.connect(relayUrl, {
      clientId: `trystero_boilerplate_smoke_${selfId}_${Math.random().toString(36).slice(2)}`,
      reconnectPeriod: 5000,
    })

    client.on('connect', () => {
      addLog(`Smoke test connected: ${new URL(relayUrl).host}.`)
      client.subscribe(topic, (error) => {
        if (error) {
          addLog(`Smoke subscribe failed on ${new URL(relayUrl).host}: ${formatError(error)}.`)
          return
        }

        addLog(`Smoke subscribed on ${new URL(relayUrl).host}.`)
      })
    })

    client.on('message', (messageTopic, buffer) => {
      if (messageTopic !== topic) {
        return
      }

      const payload = safeJsonParse(buffer.toString())
      if (payload?.from === selfId) {
        addLog(`Smoke loopback on ${new URL(relayUrl).host}.`)
        return
      }

      addLog(`Smoke received from ${shortId(payload?.from)} via ${new URL(relayUrl).host}.`)
      console.info('[trystero-demo] smoke received', { relayUrl, payload })
    })

    client.on('error', (error) => {
      addLog(`Smoke relay error on ${new URL(relayUrl).host}: ${formatError(error)}.`)
    })

    return { relayUrl, client }
  })

  smokeTest = { topic, clients }
}

function resetSmokeTest() {
  smokeTest?.clients.forEach(({ client }) => {
    client.end(true)
  })
  smokeTest = null
}

function sendSmokeTest() {
  if (!smokeTest) {
    addLog('Smoke test is not ready yet.')
    return
  }

  const payload = {
    appId,
    roomName: activeRoomName,
    from: selfId,
    sentAt: new Date().toISOString(),
  }

  smokeTest.clients.forEach(({ relayUrl, client }) => {
    if (!client.connected) {
      addLog(`Smoke publish skipped on ${new URL(relayUrl).host}: not connected.`)
      return
    }

    client.publish(smokeTest.topic, JSON.stringify(payload), (error) => {
      if (error) {
        addLog(`Smoke publish failed on ${new URL(relayUrl).host}: ${formatError(error)}.`)
        return
      }

      addLog(`Smoke published on ${new URL(relayUrl).host}.`)
    })
  })
}

function attachSocketDiagnostics(relayUrl, socket) {
  if (socketListeners.has(socket)) {
    return
  }

  socketListeners.add(socket)
  addLog(`Relay socket found: ${new URL(relayUrl).host} is ${socketState(socket)}.`)

  socket.addEventListener('open', () => {
    addLog(`Relay opened: ${new URL(relayUrl).host}.`)
    console.info('[trystero-demo] relay opened', { relayUrl })
  })
  socket.addEventListener('close', (event) => {
    addLog(`Relay closed: ${new URL(relayUrl).host} code ${event.code}.`)
    console.warn('[trystero-demo] relay closed', { relayUrl, code: event.code, reason: event.reason })
  })
  socket.addEventListener('error', (event) => {
    addLog(`Relay error: ${new URL(relayUrl).host}.`)
    console.error('[trystero-demo] relay error', { relayUrl, event })
  })
}

function updatePeerMap() {
  if (!room) {
    elements.peerMap.textContent = 'No room yet'
    return
  }

  const peerIds = Object.keys(room.getPeers())
  elements.peerMap.textContent = peerIds.length ? peerIds.join('\n') : 'No active WebRTC peers'
}

function updateElapsedTime() {
  elements.elapsedTime.textContent = joinStartedAt ? `${elapsedJoinSeconds()}s` : '0s'
}

function updateConnectionUi(status) {
  elements.status.textContent = status
  elements.selfId.textContent = selfId
  elements.peerCount.textContent = String(connectedPeers.size)
  elements.pingButton.disabled = connectedPeers.size === 0

  if (connectedPeers.size === 0) {
    elements.peerList.innerHTML = '<li>No peers connected yet.</li>'
    return
  }

  elements.peerList.replaceChildren(
    ...Array.from(connectedPeers, (peerId) => {
      const item = document.createElement('li')
      item.textContent = peerId
      return item
    }),
  )
}

function noteMessage(message) {
  elements.lastMessage.textContent = message
  addLog(message)
}

function addLog(message) {
  const item = document.createElement('li')
  item.textContent = `[${new Date().toLocaleTimeString()} +${elapsedJoinSeconds()}s] ${message}`
  elements.log.prepend(item)
}

function updateRoomUrl(roomName) {
  const nextUrl = new URL(window.location.href)
  nextUrl.searchParams.set('room', roomName)
  window.history.replaceState({}, '', nextUrl)
}

function randomRoomName() {
  return `room-${Math.random().toString(36).slice(2, 8)}`
}

function shortId(peerId) {
  return peerId ? `${peerId.slice(0, 8)}...` : 'unknown peer'
}

function elapsedJoinSeconds() {
  return joinStartedAt ? Math.round((Date.now() - joinStartedAt) / 1000) : 0
}

function socketState(socket) {
  return socketStateLabels[socket.readyState] || `State ${socket.readyState}`
}

function formatError(error) {
  if (!error) {
    return 'Unknown error'
  }

  return error.message || String(error)
}

function smokeTopic(roomName) {
  return `trystero-boilerplate-smoke/${appId}/${roomName}`
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
