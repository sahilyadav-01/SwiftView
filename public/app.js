const defaultDevices = [
  { name: 'Studio PC', id: '492 810 367', os: 'Windows 11', seen: '2 min ago', online: true },
  { name: 'MacBook Pro', id: '105 728 944', os: 'macOS 15', seen: 'Yesterday', online: false },
  { name: 'Office workstation', id: '631 409 225', os: 'Windows 11', seen: 'Sep 23', online: false }
];
const $ = (selector) => document.querySelector(selector);
const form = $('#connectForm');
const remoteId = $('#remoteId');
const modal = $('#modal');
const toast = $('#toast');
let history = JSON.parse(localStorage.getItem('swiftview-history') || 'null') || defaultDevices;
let socket, peer, localStream, role;
const ownDigits = localStorage.getItem('swiftview-id') || String(Math.floor(100000000 + Math.random() * 900000000));
localStorage.setItem('swiftview-id', ownDigits);

function digits(value) { return value.replace(/\D/g, '').slice(0, 9); }
function formatId(value) { return digits(value).replace(/(\d{3})(?=\d)/g, '$1 '); }
$('#ownId').textContent = formatId(ownDigits);

function showToast(message) {
  toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function renderHistory() {
  const list = $('#deviceList');
  if (!history.length) { list.innerHTML = '<div class="empty">No connections yet. Your recent devices will appear here.</div>'; return; }
  list.innerHTML = history.map((device) => `<div class="device-row">
    <span class="device-icon">${device.os.includes('macOS') ? '◇' : '▣'}</span>
    <span class="device-info"><strong>${device.name}</strong><small>${device.online ? '<i></i>' : ''}${device.id} · ${device.os}</small></span>
    <span class="last-seen">${device.seen}</span><button class="row-connect" data-id="${device.id}">Connect</button>
  </div>`).join('');
}

function closeModal() {
  modal.hidden = true; $('#progressBar').style.width = '8%';
  $('#connectionStatus').textContent = 'Locating remote device…';
}

function openSignal() {
  return new Promise((resolve, reject) => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/signal`);
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
    socket.addEventListener('message', onSignalMessage);
  });
}

function createPeer() {
  peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peer.onicecandidate = ({ candidate }) => candidate && sendSignal({ candidate });
  peer.ontrack = ({ streams }) => {
    $('#remoteVideo').srcObject = streams[0]; $('#waiting').hidden = true;
    $('#sessionLabel').textContent = 'Encrypted peer-to-peer session';
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'connected') {
      closeModal(); showSession(role === 'host' ? 'Sharing your screen' : 'Encrypted peer-to-peer session');
    } else if (['failed', 'disconnected'].includes(peer.connectionState)) endSession('Peer disconnected');
  };
  return peer;
}

function sendSignal(data) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'signal', data }));
}

async function onSignalMessage(event) {
  const message = JSON.parse(event.data);
  if (message.type === 'error') { closeModal(); showToast(message.message); if (role === 'viewer') socket?.close(); return; }
  if (message.type === 'peer-joined' && role === 'host') {
    $('#waitingTitle').textContent = 'Viewer found'; $('#waitingText').textContent = 'Establishing encrypted connection…';
    const pc = createPeer(); localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer); sendSignal({ description: pc.localDescription });
  }
  if (message.type === 'joined') { $('#connectionStatus').textContent = 'Remote device found. Securing video channel…'; $('#progressBar').style.width = '82%'; }
  if (message.type === 'signal') {
    const { description, candidate } = message.data;
    try {
      if (description) {
        if (!peer) createPeer(); await peer.setRemoteDescription(description);
        if (description.type === 'offer') { const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); sendSignal({ description: peer.localDescription }); }
      } else if (candidate && peer) await peer.addIceCandidate(candidate);
    } catch { endSession('Secure connection negotiation failed'); }
  }
  if (message.type === 'peer-left') endSession(message.message);
}

function showSession(label) {
  $('#session').hidden = false; $('#sessionLabel').textContent = label;
  $('#sessionCode').textContent = `ID ${role === 'host' ? formatId(ownDigits) : formatId(remoteId.value)}`;
}

function endSession(message) {
  const activeSocket = socket; socket = null; activeSocket?.close(); peer?.close(); peer = null;
  localStream?.getTracks().forEach((track) => track.stop()); localStream = null;
  $('#remoteVideo').srcObject = null; $('#session').hidden = true; $('#waiting').hidden = false;
  $('#waitingTitle').textContent = 'Ready to connect'; $('#waitingText').textContent = 'Share your SwiftView ID with the other device.';
  closeModal(); if (message) showToast(message);
}

async function connect(id) {
  const formatted = formatId(id);
  if (digits(formatted).length !== 9) { remoteId.focus(); showToast('Enter a valid 9-digit device ID'); return; }
  role = 'viewer'; remoteId.value = formatted; $('#targetId').textContent = formatted; modal.hidden = false;
  $('#connectionStatus').textContent = 'Locating remote device…'; $('#progressBar').style.width = '35%';
  try { await openSignal(); socket.send(JSON.stringify({ type: 'join', code: digits(formatted) })); }
  catch { closeModal(); showToast('Could not reach the signaling service'); }
}

remoteId.addEventListener('input', (event) => { event.target.value = formatId(event.target.value); });
form.addEventListener('submit', (event) => { event.preventDefault(); connect(remoteId.value); });
$('#deviceList').addEventListener('click', (event) => { const button = event.target.closest('[data-id]'); if (button) connect(button.dataset.id); });
$('#modalClose').addEventListener('click', () => endSession());
$('#cancelConnect').addEventListener('click', () => endSession());
modal.addEventListener('click', (event) => { if (event.target === modal) endSession(); });
$('#pasteButton').addEventListener('click', async () => { try { remoteId.value = formatId(await navigator.clipboard.readText()); remoteId.focus(); } catch { showToast('Clipboard permission was not granted'); } });
$('#copyOwnId').addEventListener('click', async () => { try { await navigator.clipboard.writeText(formatId(ownDigits)); showToast('SwiftView ID copied'); } catch { showToast('Could not copy the ID'); } });
$('#clearHistory').addEventListener('click', () => { history = []; localStorage.setItem('swiftview-history', '[]'); renderHistory(); showToast('Connection history cleared'); });
$('#themeToggle').addEventListener('click', () => { document.body.classList.toggle('light'); localStorage.setItem('swiftview-theme', document.body.classList.contains('light') ? 'light' : 'dark'); });
$('#shareScreen').addEventListener('click', async () => {
  if (!navigator.mediaDevices?.getDisplayMedia) return showToast('Screen sharing is not supported by this browser');
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 } }, audio: true });
    role = 'host'; await openSignal(); socket.send(JSON.stringify({ type: 'host', code: ownDigits }));
    $('#remoteVideo').srcObject = localStream; $('#waiting').hidden = true; showSession('Waiting for viewer');
    localStream.getVideoTracks()[0].addEventListener('ended', () => endSession('Screen sharing stopped'));
  } catch (error) { if (error.name !== 'NotAllowedError') showToast('Could not start screen sharing'); }
});
$('#endSession').addEventListener('click', () => endSession('Session ended'));
$('#fullscreenButton').addEventListener('click', () => $('#session').requestFullscreen?.());
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); remoteId.focus(); remoteId.select(); }
  if (event.key === 'Escape' && !modal.hidden) endSession();
});
if (localStorage.getItem('swiftview-theme') === 'light') document.body.classList.add('light');
renderHistory();
