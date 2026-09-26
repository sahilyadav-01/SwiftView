const defaultDevices = [];
const $ = (selector) => document.querySelector(selector);
const form = $('#connectForm');
const remoteId = $('#remoteId');
const modal = $('#modal');
const toast = $('#toast');
let history = JSON.parse(localStorage.getItem('swiftview-history') || 'null') || defaultDevices;
let activity = JSON.parse(localStorage.getItem('swiftview-activity') || '[]');
let socket, peer, localStream, role, connectionTimeout;
let sessionStartedAt = null;
let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
const ownDigits = localStorage.getItem('swiftview-id') || String(Math.floor(100000000 + Math.random() * 900000000));
localStorage.setItem('swiftview-id', ownDigits);

function digits(value) { return value.replace(/\D/g, '').slice(0, 9); }
function formatId(value) { return digits(value).replace(/(\d{3})(?=\d)/g, '$1 '); }
$('#ownId').textContent = formatId(ownDigits);

function showToast(message) {
  toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function recordActivity(kind, peerId, duration = 0) {
  activity.unshift({ kind, peerId, duration, at: new Date().toISOString() });
  activity = activity.slice(0, 30);
  localStorage.setItem('swiftview-activity', JSON.stringify(activity));
}

function openDrawer(view) {
  const drawer = $('#drawer');
  const content = $('#drawerContent');
  $('#drawerEyebrow').textContent = 'SWIFTVIEW';
  if (view === 'devices') {
    $('#drawerTitle').textContent = 'My devices';
    const recent = history.length ? history.map((item) => `<div class="drawer-device"><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.id)} · ${escapeHtml(item.os)}</small></div><button class="row-connect" data-drawer-connect="${escapeHtml(item.id)}">Connect</button></div>`).join('') : '<div class="drawer-empty">Connected devices will appear here.</div>';
    content.innerHTML = `<section class="drawer-section"><h3>This device</h3><div class="drawer-device"><div><strong>${escapeHtml(formatId(ownDigits))}</strong><small>${escapeHtml($('#platformName').textContent)} · Ready</small></div><span class="status"><i></i> Online</span></div></section><section class="drawer-section"><h3>Recent devices</h3>${recent}</section>`;
  } else if (view === 'activity') {
    $('#drawerTitle').textContent = 'Session activity';
    content.innerHTML = activity.length ? `<section class="drawer-section">${activity.map((item) => `<div class="drawer-row"><span>${escapeHtml(item.kind)}<br><small>${new Date(item.at).toLocaleString()}</small></span><strong>${escapeHtml(item.peerId || 'Unknown peer')}${item.duration ? `<br><small>${item.duration}s</small>` : ''}</strong></div>`).join('')}</section>` : '<div class="drawer-empty">No completed sessions yet.</div>';
  } else if (view === 'help') {
    $('#drawerTitle').textContent = 'Help & support';
    content.innerHTML = '<section class="drawer-section"><h3>Share this computer</h3><div class="drawer-row"><span>1</span><strong>Click Share this screen</strong></div><div class="drawer-row"><span>2</span><strong>Select a display or window</strong></div><div class="drawer-row"><span>3</span><strong>Send your 9-digit ID</strong></div><div class="drawer-row"><span>4</span><strong>Approve the incoming viewer</strong></div></section><section class="drawer-section"><h3>Connect to another computer</h3><p class="danger-note">Both devices must use the same HTTPS SwiftView address. The remote host must already be sharing and must approve your request.</p></section>';
  } else {
    $('#drawerTitle').textContent = 'Workspace';
    content.innerHTML = `<section class="drawer-section"><h3>Profile</h3><div class="drawer-row"><span>Name</span><strong>Sahil Yadav</strong></div><div class="drawer-row"><span>Workspace</span><strong>Personal</strong></div><div class="drawer-row"><span>Device ID</span><strong>${escapeHtml(formatId(ownDigits))}</strong></div></section><section class="drawer-section"><h3>Privacy</h3><p class="danger-note">Screen sharing always requires browser permission and every viewer must be approved explicitly.</p></section>`;
  }
  drawer.hidden = false;
}

function renderHistory() {
  const list = $('#deviceList');
  $('#deviceCount').textContent = history.length;
  if (!history.length) { list.innerHTML = '<div class="empty">No connections yet. Your recent devices will appear here.</div>'; return; }
  list.innerHTML = history.map((device) => `<div class="device-row">
    <span class="device-icon">${device.os.includes('macOS') ? '◇' : '▣'}</span>
    <span class="device-info"><strong>${device.name}</strong><small>${device.online ? '<i></i>' : ''}${device.id} · ${device.os}</small></span>
    <span class="last-seen">${device.seen}</span><button class="row-connect" data-id="${device.id}">Connect</button>
  </div>`).join('');
}

function closeModal() {
  clearTimeout(connectionTimeout); modal.hidden = true; $('#progressBar').style.width = '8%';
  $('#connectionStatus').textContent = 'Locating remote device…';
}

function openSignal() {
  return new Promise((resolve, reject) => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/signal`);
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Signaling unavailable')), { once: true });
    socket.addEventListener('message', onSignalMessage);
  });
}

function createPeer() {
  peer = new RTCPeerConnection({ iceServers });
  peer.onicecandidate = ({ candidate }) => candidate && sendSignal({ candidate });
  peer.ontrack = ({ streams }) => {
    $('#remoteVideo').srcObject = streams[0]; $('#waiting').hidden = true;
    $('#sessionLabel').textContent = 'Encrypted peer-to-peer session';
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'connected') {
      closeModal(); showSession(role === 'host' ? 'Sharing your screen' : 'Encrypted peer-to-peer session');
      if (role === 'viewer') addHistory(formatId(remoteId.value));
      sessionStartedAt = Date.now();
    } else if (['failed', 'disconnected'].includes(peer.connectionState)) endSession('Peer disconnected');
  };
  return peer;
}

function addHistory(id) {
  history = [{ name: 'Remote device', id, os: 'SwiftView peer', seen: 'Just now', online: true }, ...history.filter((item) => item.id !== id)].slice(0, 6);
  localStorage.setItem('swiftview-history', JSON.stringify(history)); renderHistory();
}

function sendSignal(data) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'signal', data }));
}

async function onSignalMessage(event) {
  const message = JSON.parse(event.data);
  if (message.type === 'error') { const detail = message.message; endSession(); showToast(detail); return; }
  if (message.type === 'peer-request' && role === 'host') { $('#incomingModal').hidden = false; return; }
  if (message.type === 'peer-joined' && role === 'host') {
    $('#incomingModal').hidden = true;
    $('#waitingTitle').textContent = 'Viewer found'; $('#waitingText').textContent = 'Establishing encrypted connection…';
    const pc = createPeer(); localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer); sendSignal({ description: pc.localDescription });
  }
  if (message.type === 'waiting') { $('#connectionStatus').textContent = message.message; $('#progressBar').style.width = '58%'; }
  if (message.type === 'joined') { $('#connectionStatus').textContent = 'Approved. Securing video channel…'; $('#progressBar').style.width = '82%'; }
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
  if (sessionStartedAt) {
    recordActivity(role === 'host' ? 'Shared screen' : 'Viewed device', role === 'host' ? 'Approved viewer' : formatId(remoteId.value), Math.max(1, Math.round((Date.now() - sessionStartedAt) / 1000)));
    sessionStartedAt = null;
  }
  const activeSocket = socket; socket = null; activeSocket?.close(); peer?.close(); peer = null;
  localStream?.getTracks().forEach((track) => track.stop()); localStream = null;
  $('#remoteVideo').srcObject = null; $('#session').hidden = true; $('#waiting').hidden = false; $('#incomingModal').hidden = true;
  $('#waitingTitle').textContent = 'Ready to connect'; $('#waitingText').textContent = 'Share your SwiftView ID with the other device.';
  $('#shareScreen').disabled = !$('#availabilityToggle').checked || !window.isSecureContext;
  $('#shareScreen').firstChild.textContent = 'Share this screen ';
  closeModal(); if (message) showToast(message);
}

async function connect(id) {
  const formatted = formatId(id);
  if (digits(formatted).length !== 9) { remoteId.focus(); showToast('Enter a valid 9-digit device ID'); return; }
  if (digits(formatted) === ownDigits) { remoteId.focus(); showToast('Open SwiftView on another device to connect'); return; }
  role = 'viewer'; remoteId.value = formatted; $('#targetId').textContent = formatted; modal.hidden = false;
  $('#connectionStatus').textContent = 'Locating remote device…'; $('#progressBar').style.width = '35%';
  try {
    await openSignal(); socket.send(JSON.stringify({ type: 'join', code: digits(formatted) }));
    connectionTimeout = setTimeout(() => endSession('Connection timed out. Check the ID and try again.'), 20000);
  }
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
document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item === button));
  if (button.dataset.view !== 'remote') openDrawer(button.dataset.view); else $('#drawer').hidden = true;
}));
$('#notificationsButton').addEventListener('click', () => { $('.dot').hidden = true; showToast('You’re all caught up'); });
$('#helpButton').addEventListener('click', () => openDrawer('help'));
$('#profileButton').addEventListener('click', () => openDrawer('profile'));
$('#drawerClose').addEventListener('click', () => {
  $('#drawer').hidden = true;
  document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === 'remote'));
});
$('#drawer').addEventListener('click', (event) => { if (event.target === $('#drawer')) $('#drawerClose').click(); });
$('#drawerContent').addEventListener('click', (event) => {
  const button = event.target.closest('[data-drawer-connect]');
  if (button) { $('#drawer').hidden = true; connect(button.dataset.drawerConnect); }
});
$('#acceptViewer').addEventListener('click', () => { $('#incomingModal').hidden = true; socket?.send(JSON.stringify({ type: 'approve' })); showToast('Viewer approved'); });
$('#rejectViewer').addEventListener('click', () => { $('#incomingModal').hidden = true; socket?.send(JSON.stringify({ type: 'reject' })); showToast('Connection declined'); });
$('#platformName').textContent = navigator.userAgentData?.platform || navigator.platform || 'Web browser';
$('#availabilityToggle').addEventListener('change', (event) => {
  const enabled = event.target.checked; $('#shareScreen').disabled = !enabled || !window.isSecureContext;
  $('#availabilityTitle').textContent = !window.isSecureContext ? 'HTTPS required to share' : enabled ? 'Ready to share' : 'Screen sharing paused';
  $('#deviceStatus').classList.toggle('offline', !enabled); $('#deviceStatus').innerHTML = `<i></i> ${enabled ? 'Ready' : 'Paused'}`;
  if (!enabled && localStream) endSession('Screen sharing paused');
});
$('#shareScreen').addEventListener('click', async () => {
  if (!window.isSecureContext) return showToast('Screen sharing requires HTTPS. Use localhost or deploy SwiftView with TLS.');
  if (!navigator.mediaDevices?.getDisplayMedia) return showToast('This browser does not provide screen sharing');
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 } }, audio: true });
    role = 'host'; await openSignal(); socket.send(JSON.stringify({ type: 'host', code: ownDigits }));
    $('#shareScreen').disabled = true; $('#shareScreen').firstChild.textContent = 'Sharing screen ';
    $('#remoteVideo').srcObject = localStream; $('#waiting').hidden = true; showSession('Waiting for viewer');
    localStream.getVideoTracks()[0].addEventListener('ended', () => endSession('Screen sharing stopped'));
  } catch (error) { endSession(); if (error.name !== 'NotAllowedError') showToast('Could not start screen sharing'); }
});
$('#endSession').addEventListener('click', () => endSession('Session ended'));
$('#fullscreenButton').addEventListener('click', () => $('#session').requestFullscreen?.());
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); remoteId.focus(); remoteId.select(); }
  if (event.key === 'Escape' && !modal.hidden) endSession();
});
if (localStorage.getItem('swiftview-theme') === 'light') document.body.classList.add('light');
renderHistory();
if (!window.isSecureContext) { $('#securityBanner').hidden = false; $('#shareScreen').disabled = true; $('#availabilityTitle').textContent = 'HTTPS required to share'; }
fetch('/api/config').then((response) => response.json()).then((config) => { if (Array.isArray(config.iceServers)) iceServers = config.iceServers; }).catch(() => {});
fetch('/api/health').then((response) => {
  if (!response.ok) throw new Error();
}).catch(() => {
  $('.status').classList.add('offline'); $('.status').innerHTML = '<i></i> Service unavailable';
});
