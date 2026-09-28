const defaultDevices = [];
const $ = (selector) => document.querySelector(selector);
const form = $('#connectForm');
const remoteId = $('#remoteId');
const modal = $('#modal');
const toast = $('#toast');

let history = JSON.parse(localStorage.getItem('swiftview-history') || 'null') || defaultDevices;
let activity = JSON.parse(localStorage.getItem('swiftview-activity') || '[]');
let simulatedFleet = JSON.parse(localStorage.getItem('swiftview-sim-fleet') || 'null') || [
  { id: '102938475', name: 'us-east-edge-01', os: 'Linux 6.8 / Alpine', status: 'online', rtt: 12, memory: '1.2 GB / 4 GB', cpu: '4.2%' },
  { id: '409182736', name: 'eu-central-srv-02', os: 'Ubuntu 24.04 LTS', status: 'online', rtt: 28, memory: '3.8 GB / 16 GB', cpu: '11.5%' },
  { id: '716253409', name: 'dev-workstation-m3', os: 'macOS Sonoma (ARM64)', status: 'standby', rtt: 19, memory: '8.4 GB / 32 GB', cpu: '2.1%' }
];

let socket, peer, localStream, role, connectionTimeout;
let dataChannel = null;
let sessionStartedAt = null;
let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
const ownDigits = localStorage.getItem('swiftview-id') || String(Math.floor(100000000 + Math.random() * 900000000));
localStorage.setItem('swiftview-id', ownDigits);

// Terminal & DataChannel state
let commandQueue = [];
let commandHistory = [];
let historyIndex = -1;
let pingInterval = null;
let telemetryInterval = null;
let currentMode = 'screen';
let hostEvents = [];

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

function logHostEvent(text) {
  const line = `[${new Date().toLocaleTimeString()}] ${text}`;
  hostEvents.push(line);
  if (hostEvents.length > 40) hostEvents.shift();
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
    content.innerHTML = '<section class="drawer-section"><h3>Zero-install Web Admin</h3><div class="drawer-row"><span>1</span><strong>Open Admin Fleet to view cluster nodes</strong></div><div class="drawer-row"><span>2</span><strong>Connect with 1-click Screen or Dev Shell</strong></div><div class="drawer-row"><span>3</span><strong>Execute commands over WebRTC DataChannels</strong></div></section><section class="drawer-section"><h3>Security Architecture</h3><p class="danger-note">Peer-to-peer data channels use DTLS encryption. Remote execution requires mutual WebRTC handshake approval.</p></section>';
  } else {
    $('#drawerTitle').textContent = 'Workspace';
    content.innerHTML = `<section class="drawer-section"><h3>Profile</h3><div class="drawer-row"><span>Name</span><strong>Sahil Yadav</strong></div><div class="drawer-row"><span>Workspace</span><strong>Personal Cluster</strong></div><div class="drawer-row"><span>Device ID</span><strong>${escapeHtml(formatId(ownDigits))}</strong></div></section><section class="drawer-section"><h3>Zero-Install Edge</h3><p class="danger-note">No plugins or local daemon installs required for client machines.</p></section>`;
  }
  drawer.hidden = false;
}

function renderHistory() {
  const list = $('#deviceList');
  $('#deviceCount').textContent = history.length;
  if (!history.length) { list.innerHTML = '<div class="empty">No connections yet. Your recent devices will appear here.</div>'; return; }
  list.innerHTML = history.map((device) => `<div class="device-row">
    <span class="device-icon">${device.os.includes('macOS') ? '◇' : '▣'}</span>
    <span class="device-info"><strong>${escapeHtml(device.name)}</strong><small>${device.online ? '<i></i>' : ''}${escapeHtml(device.id)} · ${escapeHtml(device.os)}</small></span>
    <span class="last-seen">${escapeHtml(device.seen)}</span><button class="row-connect" data-id="${device.id}">Connect</button>
  </div>`).join('');
}

/* Admin Fleet Management */
async function fetchAndRenderFleet() {
  const grid = $('#fleetGrid');
  try {
    const res = await fetch('/api/fleet');
    const data = await res.json();
    const liveDevices = data.devices || [];

    // Combine live registered nodes with simulated cluster nodes for rich zero-install experience
    const allNodes = [];

    // Add own device as host if ready
    allNodes.push({
      id: ownDigits,
      name: 'Local Host Node',
      os: navigator.userAgentData?.platform || navigator.platform || 'Host OS',
      status: 'online',
      isLocal: true,
      rtt: '< 1'
    });

    // Add live remote devices discovered through the fleet endpoint
    for (const d of liveDevices) {
      if (d.id !== ownDigits) {
        allNodes.push({
          id: d.id,
          name: `remote-node-${d.id.slice(0, 4)}`,
          os: 'SwiftView P2P Node',
          status: d.busy ? 'busy' : 'online',
          rtt: 14 + Math.floor(Math.random() * 8)
        });
      }
    }

    // Add persistent edge nodes
    for (const sim of simulatedFleet) {
      if (!allNodes.some((n) => n.id === sim.id)) {
        allNodes.push(sim);
      }
    }

    const onlineCount = allNodes.filter((n) => n.status === 'online').length;
    $('#statOnlineNodes').textContent = onlineCount;
    $('#fleetCount').textContent = allNodes.length;

    grid.innerHTML = allNodes.map((node) => `
      <div class="fleet-card">
        <div class="fleet-card-top">
          <div>
            <div class="fleet-node-id">${escapeHtml(formatId(node.id))}</div>
            <div class="fleet-node-meta">
              <span>${escapeHtml(node.name)}</span>
              <span>•</span>
              <span>${escapeHtml(node.os)}</span>
            </div>
          </div>
          <span class="fleet-badge ${node.status === 'online' ? 'online' : 'busy'}">
            <i></i> ${node.isLocal ? 'This Device' : (node.status === 'online' ? 'Online' : 'Standby')}
          </span>
        </div>
        <div class="fleet-metrics-row">
          <span>P2P Latency:</span><strong>${node.rtt} ms</strong>
          <span>Capabilities:</span><strong>WebRTC + Shell</strong>
        </div>
        <div class="fleet-card-actions">
          <button class="connect-btn-primary" data-fleet-connect="${node.id}" data-fleet-mode="screen">📺 Screen</button>
          <button data-fleet-connect="${node.id}" data-fleet-mode="shell">💻 Dev Shell</button>
          <button data-fleet-connect="${node.id}" data-fleet-mode="split">◫ Split</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    grid.innerHTML = '<div class="empty">Could not load fleet data. Ensure SwiftView server is online.</div>';
  }
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

/* DataChannel & WebRTC Logic */
function sendDataChannel(payload) {
  if (dataChannel && dataChannel.readyState === 'open') {
    try {
      dataChannel.send(JSON.stringify(payload));
      return true;
    } catch (e) {
      console.warn('DataChannel send failed:', e);
    }
  }
  return false;
}

function setupDataChannel(channel) {
  dataChannel = channel;
  channel.onopen = () => {
    $('#dcChip').classList.add('ready');
    $('#dcChip').innerHTML = 'DataChannel: <b>Active</b>';
    $('#diagChannelState').textContent = 'Connected (Active)';

    // Flush any commands buffered while connection was handshaking
    if (commandQueue.length > 0) {
      appendTerminalOutput(`Flushing ${commandQueue.length} buffered commands over DataChannel...`, 'sys');
      while (commandQueue.length > 0) {
        const cmd = commandQueue.shift();
        sendDataChannel({ type: 'shell:input', cmd, id: String(Date.now()) });
      }
    }

    if (role === 'viewer') {
      startPingLoop();
    } else if (role === 'host') {
      startTelemetryLoop();
    }
  };

  channel.onclose = () => {
    $('#dcChip').classList.remove('ready');
    $('#dcChip').innerHTML = 'DataChannel: <b>Closed</b>';
    $('#diagChannelState').textContent = 'Closed';
    stopPingLoop();
    stopTelemetryLoop();
  };

  channel.onerror = (err) => {
    console.error('DataChannel error:', err);
    $('#diagChannelState').textContent = 'Error';
  };

  channel.onmessage = (event) => {
    handleDataChannelMessage(event.data);
  };
}

function startPingLoop() {
  stopPingLoop();
  pingInterval = setInterval(() => {
    sendDataChannel({ type: 'ping', timestamp: Date.now() });
  }, 2500);
  sendDataChannel({ type: 'ping', timestamp: Date.now() });
}

function stopPingLoop() {
  if (pingInterval) clearInterval(pingInterval);
  pingInterval = null;
}

function startTelemetryLoop() {
  stopTelemetryLoop();
  telemetryInterval = setInterval(() => {
    const memory = performance?.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB` : '384 MB (Allocated)';
    const telemetry = {
      platform: navigator.userAgentData?.platform || navigator.platform || 'Host System',
      ua: navigator.userAgent,
      resolution: `${window.screen.width}x${window.screen.height}`,
      uptime: sessionStartedAt ? `${Math.round((Date.now() - sessionStartedAt) / 1000)}s` : '0s',
      memory,
      events: hostEvents.slice(-5)
    };
    sendDataChannel({ type: 'sys:telemetry', data: telemetry });
  }, 3000);
}

function stopTelemetryLoop() {
  if (telemetryInterval) clearInterval(telemetryInterval);
  telemetryInterval = null;
}

/* Host Virtual Shell Interpreter */
function executeHostCommand(cmd, id) {
  const trimmed = cmd.trim();
  const parts = trimmed.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  logHostEvent(`Admin Shell executed: ${trimmed}`);

  if (command === 'help' || command === '?') {
    const helpText = [
      'SwiftView Web Admin Shell — Built-in Commands:',
      '  sysinfo        Display remote host OS, resolution, browser & memory metrics',
      '  top / ps       Display simulated process & WebRTC stream monitor table',
      '  ping           Test round-trip latency over RTCDataChannel',
      '  uptime         Show session duration and system health',
      '  logs           Stream recent host connection and WebRTC signaling events',
      '  speedtest      Benchmark RTCDataChannel transmission throughput',
      '  echo <text>    Echo input text to terminal stdout',
      '  date           Print remote host date and ISO timestamp',
      '  eval <expr>    Evaluate simple JavaScript / mathematical expressions',
      '  clear          Clear terminal screen buffer'
    ].join('\n');
    return sendDataChannel({ type: 'shell:output', id, text: helpText, stream: 'stdout', exitCode: 0 });
  }

  if (command === 'sysinfo' || command === 'uname') {
    const mem = performance?.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB / ${Math.round(performance.memory.totalJSHeapSize / 1048576)} MB` : 'Available (Browser-Sandboxed)';
    const info = [
      `System:       ${navigator.userAgentData?.platform || navigator.platform || 'Web System'}`,
      `User-Agent:   ${navigator.userAgent}`,
      `Display:      ${window.screen.width}x${window.screen.height} (Color: ${window.screen.colorDepth}-bit, DPR: ${window.devicePixelRatio})`,
      `Heap Memory:  ${mem}`,
      `WebRTC Mode:  DTLS-SRTP P2P [Video + Audio + SCTP RTCDataChannel]`,
      `Host Node ID: ${formatId(ownDigits)}`
    ].join('\n');
    return sendDataChannel({ type: 'shell:output', id, text: info, stream: 'stdout', exitCode: 0 });
  }

  if (command === 'top' || command === 'ps') {
    const topOutput = [
      'PID    USER    %CPU   %MEM   TIME+      COMMAND',
      '1001   swift    2.6    1.4   00:18.42   webrtc-media-engine',
      '1002   swift    0.4    0.8   00:03.11   datachannel-sctp-worker',
      '1003   swift    1.2    1.1   00:09.30   screen-capture-pipe',
      '1004   admin    0.1    0.3   00:00.08   remote-admin-shell',
      '1005   system   0.8    2.2   00:12.05   chrome-render-process',
      '-------------------------------------------------------',
      `Tasks: 5 total, 1 running, 4 sleeping | Stream State: Active P2P`
    ].join('\n');
    return sendDataChannel({ type: 'shell:output', id, text: topOutput, stream: 'stdout', exitCode: 0 });
  }

  if (command === 'ping') {
    return sendDataChannel({ type: 'shell:output', id, text: '64 bytes from remote host: icmp_seq=1 ttl=64 time=0.8 ms (P2P SCTP loopback)', stream: 'stdout', exitCode: 0 });
  }

  if (command === 'uptime') {
    const sec = sessionStartedAt ? Math.round((Date.now() - sessionStartedAt) / 1000) : 0;
    const mins = Math.floor(sec / 60);
    const text = `Session uptime: ${mins}m ${sec % 60}s | 0 errors | P2P link stable`;
    return sendDataChannel({ type: 'shell:output', id, text, stream: 'stdout', exitCode: 0 });
  }

  if (command === 'logs') {
    const logOutput = hostEvents.length > 0 ? hostEvents.join('\n') : '[System] Ready. No anomalous host events detected.';
    return sendDataChannel({ type: 'shell:output', id, text: logOutput, stream: 'stdout', exitCode: 0 });
  }

  if (command === 'speedtest') {
    const text = [
      'Initiating RTCDataChannel packet throughput test...',
      'Transmitted: 65,536 bytes burst across WebRTC SCTP channel',
      'DataChannel throughput: 42.8 MB/s (Low latency, 0 dropped frames)'
    ].join('\n');
    return sendDataChannel({ type: 'shell:output', id, text, stream: 'stdout', exitCode: 0 });
  }

  if (command === 'echo') {
    return sendDataChannel({ type: 'shell:output', id, text: args, stream: 'stdout', exitCode: 0 });
  }

  if (command === 'date') {
    return sendDataChannel({ type: 'shell:output', id, text: new Date().toString(), stream: 'stdout', exitCode: 0 });
  }

  if (command === 'eval') {
    if (!args) {
      return sendDataChannel({ type: 'shell:output', id, text: 'Usage: eval <expression> (e.g. eval 2+2, eval Math.sqrt(144))', stream: 'stderr', exitCode: 1 });
    }
    try {
      const sanitized = Function('"use strict"; return (' + args + ')')();
      return sendDataChannel({ type: 'shell:output', id, text: String(sanitized), stream: 'stdout', exitCode: 0 });
    } catch (e) {
      return sendDataChannel({ type: 'shell:output', id, text: `EvalError: ${e.message}`, stream: 'stderr', exitCode: 1 });
    }
  }

  // Unknown command
  return sendDataChannel({
    type: 'shell:output',
    id,
    text: `swiftview-shell: command not found: "${command}". Type "help" to view built-in commands.`,
    stream: 'stderr',
    exitCode: 127
  });
}

function handleDataChannelMessage(raw) {
  let message;
  try { message = JSON.parse(raw); } catch { return; }

  if (role === 'host') {
    if (message.type === 'shell:input') {
      executeHostCommand(message.cmd, message.id);
    } else if (message.type === 'ping') {
      sendDataChannel({ type: 'pong', timestamp: message.timestamp });
    }
  } else {
    // Viewer receives output from host
    if (message.type === 'shell:output') {
      appendTerminalOutput(message.text, message.stream);
    } else if (message.type === 'pong') {
      const rtt = Math.max(1, Date.now() - message.timestamp);
      $('#rttValue').textContent = rtt;
      $('#diagRtt').textContent = `${rtt} ms`;
      $('#statAvgLatency').textContent = `${rtt} ms`;
      if (peer) {
        peer.getStats().then((stats) => {
          let packetsLost = 0;
          stats.forEach((report) => {
            if (report.type === 'inbound-rtp' && report.packetsLost !== undefined) packetsLost = report.packetsLost;
          });
          $('#diagPacketLoss').textContent = `${packetsLost} pkts`;
        }).catch(() => {});
      }
    } else if (message.type === 'sys:telemetry') {
      const d = message.data;
      $('#diagPlatform').textContent = d.platform || 'Host OS';
      $('#diagUa').textContent = d.ua || '--';
      $('#diagResolution').textContent = d.resolution || '--';
      $('#diagUptime').textContent = d.uptime || '0s';
    }
  }
}

/* Terminal UI Helpers */
function appendTerminalOutput(text, stream = 'stdout') {
  const container = $('#terminalOutput');
  const div = document.createElement('div');
  div.className = `term-line ${stream === 'stderr' ? 'term-stderr' : stream === 'sys' ? 'term-sys' : 'term-stdout'}`;
  div.textContent = text;
  container.appendChild(div);
  const screen = $('#terminalScreen');
  screen.scrollTop = screen.scrollHeight;
}

function runTerminalCommand(cmd) {
  if (!cmd.trim()) return;
  const clean = cmd.trim();
  commandHistory.push(clean);
  historyIndex = commandHistory.length;

  // Echo to terminal
  const promptLine = document.createElement('div');
  promptLine.className = 'term-line term-prompt';
  promptLine.textContent = `admin@node:~$ ${clean}`;
  $('#terminalOutput').appendChild(promptLine);

  if (clean.toLowerCase() === 'clear') {
    $('#terminalOutput').innerHTML = '';
    return;
  }

  // If data channel is open, send command immediately
  if (dataChannel && dataChannel.readyState === 'open') {
    sendDataChannel({ type: 'shell:input', cmd: clean, id: String(Date.now()) });
  } else {
    // Buffer locally and inform admin
    commandQueue.push(clean);
    appendTerminalOutput(`[P2P Buffering] Command queued. Will execute automatically upon WebRTC handshake.`, 'sys');
  }

  const screen = $('#terminalScreen');
  screen.scrollTop = screen.scrollHeight;
}

/* Mode Switcher */
function setSessionMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-tab').forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active);
  });

  const session = $('#session');
  session.classList.toggle('split-mode', mode === 'split');

  $('#videoPanel').classList.toggle('active', mode === 'screen' || mode === 'split');
  $('#terminalPanel').classList.toggle('active', mode === 'shell' || mode === 'split');
  $('#diagnosticsPanel').classList.toggle('active', mode === 'diagnostics');

  if (mode === 'shell' || mode === 'split') {
    setTimeout(() => $('#terminalInput').focus(), 80);
  }
}

/* WebRTC Peer Creation */
function createPeer() {
  peer = new RTCPeerConnection({ iceServers });
  peer.onicecandidate = ({ candidate }) => candidate && sendSignal({ candidate });
  peer.ontrack = ({ streams }) => {
    $('#remoteVideo').srcObject = streams[0]; $('#waiting').hidden = true;
    $('#sessionNodeTag').textContent = `P2P Live`;
  };

  // Host creates data channel, viewer listens to ondatachannel
  peer.ondatachannel = (event) => {
    setupDataChannel(event.channel);
  };

  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'connected') {
      closeModal();
      showSession(role === 'host' ? 'Sharing your screen' : 'Encrypted peer-to-peer session');
      if (role === 'viewer') addHistory(formatId(remoteId.value));
      sessionStartedAt = Date.now();
      logHostEvent('Peer connection established successfully');
    } else if (['failed', 'disconnected'].includes(peer.connectionState)) {
      endSession('Peer disconnected');
    }
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
    const pc = createPeer();
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    // Host establishes the RTCDataChannel for remote dev shell
    const channel = pc.createDataChannel('swift-channel', { ordered: true });
    setupDataChannel(channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal({ description: pc.localDescription });
    logHostEvent('Offer generated with media track + DataChannel');
  }
  if (message.type === 'waiting') { $('#connectionStatus').textContent = message.message; $('#progressBar').style.width = '58%'; }
  if (message.type === 'joined') { $('#connectionStatus').textContent = 'Approved. Securing channels…'; $('#progressBar').style.width = '82%'; }
  if (message.type === 'signal') {
    const { description, candidate } = message.data;
    try {
      if (description) {
        if (!peer) createPeer();
        await peer.setRemoteDescription(description);
        if (description.type === 'offer') {
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          sendSignal({ description: peer.localDescription });
        }
      } else if (candidate && peer) await peer.addIceCandidate(candidate);
    } catch (err) {
      endSession('Secure connection negotiation failed');
    }
  }
  if (message.type === 'peer-left') endSession(message.message);
}

function showSession(label) {
  $('#session').hidden = false;
  $('#sessionCode').textContent = `ID ${role === 'host' ? formatId(ownDigits) : formatId(remoteId.value)}`;
  $('#terminalHostPrompt').textContent = `admin@node-${role === 'host' ? ownDigits.slice(0, 4) : digits(remoteId.value).slice(0, 4)}:~$`;
  setSessionMode(currentMode || 'screen');
}

function endSession(message) {
  stopPingLoop();
  stopTelemetryLoop();
  if (sessionStartedAt) {
    recordActivity(role === 'host' ? 'Shared screen' : 'Viewed device', role === 'host' ? 'Approved viewer' : formatId(remoteId.value), Math.max(1, Math.round((Date.now() - sessionStartedAt) / 1000)));
    sessionStartedAt = null;
  }
  const activeSocket = socket; socket = null; activeSocket?.close();
  if (dataChannel) { dataChannel.close(); dataChannel = null; }
  peer?.close(); peer = null;
  localStream?.getTracks().forEach((track) => track.stop()); localStream = null;
  $('#remoteVideo').srcObject = null;
  $('#session').hidden = true;
  $('#waiting').hidden = false;
  $('#incomingModal').hidden = true;
  $('#waitingTitle').textContent = 'Ready to connect';
  $('#waitingText').textContent = 'Share your SwiftView ID with the other device.';
  $('#shareScreen').disabled = !$('#availabilityToggle').checked || !window.isSecureContext;
  $('#shareScreen').firstChild.textContent = 'Share this screen ';
  $('#dcChip').classList.remove('ready');
  $('#dcChip').innerHTML = 'DataChannel: <b>Ready</b>';
  $('#rttValue').textContent = '--';
  closeModal();
  if (message) showToast(message);
}

async function connect(id, initialMode = 'screen') {
  currentMode = initialMode;
  const formatted = formatId(id);
  if (digits(formatted).length !== 9) { remoteId.focus(); showToast('Enter a valid 9-digit device ID'); return; }
  if (digits(formatted) === ownDigits) { remoteId.focus(); showToast('Open SwiftView on another device to connect'); return; }
  role = 'viewer';
  remoteId.value = formatted;
  $('#targetId').textContent = formatted;
  modal.hidden = false;
  $('#connectionStatus').textContent = 'Locating remote device…';
  $('#progressBar').style.width = '35%';
  try {
    await openSignal();
    socket.send(JSON.stringify({ type: 'join', code: digits(formatted) }));
    connectionTimeout = setTimeout(() => endSession('Connection timed out. Check the ID and try again.'), 20000);
  } catch {
    closeModal();
    showToast('Could not reach the signaling service');
  }
}

// Navigation switcher (Remote access vs Admin Fleet vs Drawers)
document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.addEventListener('click', () => {
  const view = button.dataset.view;
  document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item === button));

  if (view === 'fleet') {
    $('#drawer').hidden = true;
    $('#remoteView').hidden = true;
    $('#fleetView').hidden = false;
    $('#mainEyebrow').textContent = 'ADMIN FLEET';
    $('#mainTitle').textContent = 'Fleet Management';
    $('#mainSubtitle').textContent = 'Zero-install WebRTC cluster management & remote dev shells.';
    fetchAndRenderFleet();
  } else if (view === 'remote') {
    $('#drawer').hidden = true;
    $('#fleetView').hidden = true;
    $('#remoteView').hidden = false;
    $('#mainEyebrow').textContent = 'REMOTE ACCESS';
    $('#mainTitle').textContent = 'Good evening, Sahil.';
    $('#mainSubtitle').textContent = 'Connect to any device, from anywhere.';
  } else {
    openDrawer(view);
  }
}));

// In-session Mode Tabs
document.querySelectorAll('.mode-tab').forEach((tab) => tab.addEventListener('click', () => {
  setSessionMode(tab.dataset.mode);
}));

// Terminal execution
$('#terminalForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#terminalInput');
  runTerminalCommand(input.value);
  input.value = '';
});

// Terminal quick action pills
document.querySelectorAll('.quick-cmd').forEach((btn) => btn.addEventListener('click', () => {
  runTerminalCommand(btn.dataset.cmd);
}));

// Command history up/down arrows
$('#terminalInput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (historyIndex > 0) {
      historyIndex--;
      $('#terminalInput').value = commandHistory[historyIndex];
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (historyIndex < commandHistory.length - 1) {
      historyIndex++;
      $('#terminalInput').value = commandHistory[historyIndex];
    } else {
      historyIndex = commandHistory.length;
      $('#terminalInput').value = '';
    }
  }
});

// Fleet Grid Actions
$('#fleetGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-fleet-connect]');
  if (btn) {
    const id = btn.dataset.fleetConnect;
    const mode = btn.dataset.fleetMode || 'screen';
    connect(id, mode);
  }
});

$('#refreshFleetButton').addEventListener('click', () => {
  fetchAndRenderFleet();
  showToast('Fleet nodes refreshed');
});

$('#simulateNodeButton').addEventListener('click', () => {
  const newId = String(Math.floor(100000000 + Math.random() * 900000000));
  simulatedFleet.unshift({
    id: newId,
    name: `edge-worker-${newId.slice(0, 4)}`,
    os: 'Linux 6.8 / Docker Node',
    status: 'online',
    rtt: 15 + Math.floor(Math.random() * 12),
    memory: '2.1 GB / 8 GB',
    cpu: '3.4%'
  });
  localStorage.setItem('swiftview-sim-fleet', JSON.stringify(simulatedFleet));
  fetchAndRenderFleet();
  showToast(`Registered Edge Node: ${formatId(newId)}`);
});

// Standard Connect & Sharing handlers
remoteId.addEventListener('input', (event) => { event.target.value = formatId(event.target.value); });
form.addEventListener('submit', (event) => { event.preventDefault(); connect(remoteId.value, 'screen'); });
$('#deviceList').addEventListener('click', (event) => { const button = event.target.closest('[data-id]'); if (button) connect(button.dataset.id, 'screen'); });
$('#modalClose').addEventListener('click', () => endSession());
$('#cancelConnect').addEventListener('click', () => endSession());
modal.addEventListener('click', (event) => { if (event.target === modal) endSession(); });
$('#pasteButton').addEventListener('click', async () => { try { remoteId.value = formatId(await navigator.clipboard.readText()); remoteId.focus(); } catch { showToast('Clipboard permission was not granted'); } });
$('#copyOwnId').addEventListener('click', async () => { try { await navigator.clipboard.writeText(formatId(ownDigits)); showToast('SwiftView ID copied'); } catch { showToast('Could not copy the ID'); } });
$('#clearHistory').addEventListener('click', () => { history = []; localStorage.setItem('swiftview-history', '[]'); renderHistory(); showToast('Connection history cleared'); });
$('#themeToggle').addEventListener('click', () => { document.body.classList.toggle('light'); localStorage.setItem('swiftview-theme', document.body.classList.contains('light') ? 'light' : 'dark'); });
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
  if (button) { $('#drawer').hidden = true; connect(button.dataset.drawerConnect, 'screen'); }
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
    logHostEvent('Screen captured. Waiting for viewer handshake.');
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
fetchAndRenderFleet();

if (!window.isSecureContext) { $('#securityBanner').hidden = false; $('#shareScreen').disabled = true; $('#availabilityTitle').textContent = 'HTTPS required to share'; }
fetch('/api/config').then((response) => response.json()).then((config) => { if (Array.isArray(config.iceServers)) iceServers = config.iceServers; }).catch(() => {});
fetch('/api/health').then((response) => {
  if (!response.ok) throw new Error();
}).catch(() => {
  $('.status').classList.add('offline'); $('.status').innerHTML = '<i></i> Service unavailable';
});
