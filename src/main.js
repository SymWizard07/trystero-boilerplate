import { getRelaySockets, joinRoom, selfId } from '@trystero-p2p/mqtt'
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
  peerList: document.querySelector('#peer-list'),
  lastMessage: document.querySelector('#last-message'),
  pingButton: document.querySelector('#ping-button'),
  log: document.querySelector('#log'),
}

let room
let sendPing
let connectedPeers = new Set()
let activeRoomName = ''
const hasRequiredCrypto = Boolean(window.crypto?.subtle)
const socketStateLabels = ['Connecting', 'Open', 'Closing', 'Closed']

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
  noteMessage(`Ping sent from ${shortId(selfId)}`)
})

joinNamedRoom(initialRoom)
setInterval(updateRelayStatus, 1000)

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
  updateRoomUrl(normalizedRoomName)

  if (!hasRequiredCrypto) {
    updateConnectionUi('Needs HTTPS or localhost')
    addLog('Trystero needs crypto.subtle, which browsers only expose on localhost or HTTPS.')
    return
  }

  updateConnectionUi('Joining room...')
  addLog(`Joining room "${normalizedRoomName}" as ${shortId(selfId)}.`)

  room = joinRoom({ appId }, normalizedRoomName)
  updateRelayStatus()
  const pingAction = room.makeAction('ping')
  sendPing = pingAction.send

  room.onPeerJoin = (peerId) => {
    connectedPeers.add(peerId)
    updateConnectionUi('Connected')
    addLog(`Peer joined: ${shortId(peerId)}.`)
  }

  room.onPeerLeave = (peerId) => {
    connectedPeers.delete(peerId)
    updateConnectionUi(connectedPeers.size ? 'Connected' : 'Waiting for another peer')
    addLog(`Peer left: ${shortId(peerId)}.`)
  }

  pingAction.onMessage = (message, { peerId }) => {
    const sentAt = message?.sentAt ? new Date(message.sentAt).toLocaleTimeString() : 'unknown time'
    noteMessage(`Ping received from ${shortId(peerId)} at ${sentAt}`)
  }

  updateConnectionUi('Waiting for another peer')
}

function updateRelayStatus() {
  const relaySockets = getRelaySockets()
  const relayEntries = Object.entries(relaySockets)

  if (relayEntries.length === 0) {
    elements.relayStatus.textContent = 'No relay sockets yet'
    return
  }

  elements.relayStatus.textContent = relayEntries
    .map(([url, socket]) => {
      const state = socketStateLabels[socket.readyState] || `State ${socket.readyState}`
      return `${new URL(url).host}: ${state}`
    })
    .join(', ')
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
  item.textContent = `[${new Date().toLocaleTimeString()}] ${message}`
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
