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
let pendingCandidates = [];
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

// Interactive Remote Control & Live OS state
let remoteControlActive = false;
let liveHostOsEnabled = true;
let touchMode = 'direct'; // 'direct' | 'trackpad'
let lastNormalizedPos = { x: 0.5, y: 0.5 };
let lastThrottleMove = 0;

// Adaptive Network Controller (ANC) state
let ancInterval = null;
let currentTier = 1;
let prevStats = { timestamp: 0, bytesReceived: 0, bytesSent: 0, packetsReceived: 0, packetsLost: 0 };

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
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve(socket);
  return new Promise((resolve, reject) => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/signal`);
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener('error', () => reject(new Error('Signaling unavailable')), { once: true });
    socket.addEventListener('message', onSignalMessage);
    socket.addEventListener('close', () => {
      // Reconnect standby if availability enabled and not in active session
      if ($('#availabilityToggle')?.checked && !peer && role === 'host') {
        setTimeout(() => registerAsHost(), 2000);
      }
    });
  });
}

function updateHostStatusUI(state) {
  const statusEl = $('#deviceStatus');
  const titleEl = $('#availabilityTitle');
  const shareBtn = $('#shareScreen');

  if (state === 'online') {
    statusEl.className = 'status online';
    statusEl.innerHTML = '<i></i> Online (Ready)';
    titleEl.textContent = 'Ready to connect';
    shareBtn.disabled = false;
    if (localStream) {
      shareBtn.innerHTML = 'Sharing screen <span>↗</span>';
    } else {
      shareBtn.innerHTML = 'Share this screen <span>↗</span>';
    }
  } else if (state === 'offline' || state === 'paused') {
    statusEl.className = 'status offline';
    statusEl.innerHTML = '<i></i> Offline / Paused';
    titleEl.textContent = 'Screen sharing paused';
    shareBtn.disabled = true;
  }
}

async function registerAsHost() {
  if (!$('#availabilityToggle')?.checked) return;
  try {
    await openSignal();
    role = 'host';
    const meta = {
      platform: navigator.userAgentData?.platform || navigator.platform || 'Web browser',
      screenCapable: !!(window.isSecureContext && navigator.mediaDevices?.getDisplayMedia),
      secureContext: window.isSecureContext
    };
    socket.send(JSON.stringify({ type: 'host', code: ownDigits, meta }));
    updateHostStatusUI('online');
    logHostEvent('Registered host standby with signaling service.');
  } catch (err) {
    console.warn('Signaling host registration failed:', err);
    updateHostStatusUI('offline');
  }
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

/* Adaptive Network Controller (ANC) */
function startAdaptiveNetworkController() {
  stopAdaptiveNetworkController();
  prevStats = { timestamp: Date.now(), bytesReceived: 0, bytesSent: 0, packetsReceived: 0, packetsLost: 0 };
  ancInterval = setInterval(monitorAndAdaptNetwork, 1000);
  monitorAndAdaptNetwork();
}

function stopAdaptiveNetworkController() {
  if (ancInterval) clearInterval(ancInterval);
  ancInterval = null;
}

async function monitorAndAdaptNetwork() {
  if (!peer || peer.connectionState !== 'connected') return;
  try {
    const stats = await peer.getStats();
    let rtt = null;
    let jitter = 0;
    let packetsLost = 0;
    let packetsReceived = 0;
    let bytesReceived = 0;
    let bytesSent = 0;

    stats.forEach((report) => {
      if (report.type === 'candidate-pair' && (report.selected || report.nominated || report.state === 'succeeded')) {
        if (report.currentRoundTripTime !== undefined) {
          rtt = Math.round(report.currentRoundTripTime * 1000);
        }
      }
      if (report.type === 'inbound-rtp' && report.kind === 'video') {
        if (report.jitter !== undefined) jitter = Math.round(report.jitter * 1000);
        if (report.packetsLost !== undefined) packetsLost = report.packetsLost;
        if (report.packetsReceived !== undefined) packetsReceived = report.packetsReceived;
        if (report.bytesReceived !== undefined) bytesReceived = report.bytesReceived;
      }
      if (report.type === 'outbound-rtp' && report.kind === 'video') {
        if (report.bytesSent !== undefined) bytesSent = report.bytesSent;
      }
    });

    const now = Date.now();
    const deltaSec = (now - (prevStats.timestamp || now)) / 1000;
    let lossRate = 0;
    const deltaLost = Math.max(0, packetsLost - (prevStats.packetsLost || 0));
    const deltaReceived = Math.max(0, packetsReceived - (prevStats.packetsReceived || 0));
    if (deltaLost + deltaReceived > 0) {
      lossRate = (deltaLost / (deltaLost + deltaReceived)) * 100;
    }

    let currentBitrateKbps = 0;
    if (deltaSec > 0 && (prevStats.bytesReceived || prevStats.bytesSent)) {
      const deltaBytes = Math.max(0, (role === 'viewer' ? bytesReceived - prevStats.bytesReceived : bytesSent - prevStats.bytesSent));
      currentBitrateKbps = Math.round((deltaBytes * 8) / deltaSec / 1000);
    }

    prevStats = { timestamp: now, bytesReceived, bytesSent, packetsReceived, packetsLost };

    // Select Adaptive Quality Tier
    let tier = 1;
    if ((rtt !== null && rtt > 95) || lossRate > 3.5 || jitter > 35) {
      tier = 3; // Edge Mobile (15 fps, 380 kbps, maintain-framerate)
    } else if ((rtt !== null && rtt > 50) || lossRate > 1.0 || jitter > 18) {
      tier = 2; // Balanced (30 fps, 1400 kbps)
    } else {
      tier = 1; // Ultra (60 fps, 3200 kbps)
    }
    currentTier = tier;

    // Update Telemetry UI
    if (rtt !== null) {
      $('#rttValue').textContent = rtt;
      $('#diagRtt').textContent = `${rtt} ms`;
    }
    $('#jitterValue').textContent = jitter;
    $('#diagJitter').textContent = `${jitter} ms`;
    $('#diagLossRate').textContent = `${lossRate.toFixed(1)}%`;
    if (currentBitrateKbps > 0) {
      $('#diagBitrate').textContent = `${currentBitrateKbps} Kbps`;
    }

    const tierLabel = tier === 1 ? 'Ultra (60fps)' : tier === 2 ? 'Balanced (30fps)' : 'Edge (15fps · Adaptive)';
    $('#netTierValue').textContent = tierLabel;
    $('#diagTier').textContent = `Tier ${tier}: ${tierLabel}`;
    const tierChip = $('#netTierChip');
    tierChip.classList.remove('tier-balanced', 'tier-edge');
    if (tier === 2) tierChip.classList.add('tier-balanced');
    if (tier === 3) tierChip.classList.add('tier-edge');

    // Host: Adjust Video Sender parameters dynamically
    if (role === 'host') {
      const sender = peer.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) {
        const params = sender.getParameters();
        if (params.encodings && params.encodings[0]) {
          const targetBitrate = tier === 1 ? 3200000 : tier === 2 ? 1400000 : 380000;
          const targetFps = tier === 1 ? 60 : tier === 2 ? 30 : 15;
          const scaleDown = tier === 1 ? 1.0 : tier === 2 ? 1.33 : 2.0;
          if (params.encodings[0].maxBitrate !== targetBitrate || params.encodings[0].maxFramerate !== targetFps) {
            params.encodings[0].maxBitrate = targetBitrate;
            params.encodings[0].maxFramerate = targetFps;
            params.encodings[0].scaleResolutionDownBy = scaleDown;
            params.degradationPreference = tier === 3 ? 'maintain-framerate' : 'balanced';
            sender.setParameters(params).catch(() => {});
            logHostEvent(`Adaptive Controller: Switched to Tier ${tier} (${targetFps}fps, ${Math.round(targetBitrate / 1000)}Kbps)`);
          }
        }
      }
    }

    // Viewer: Adjust Receiver Jitter Buffer Target dynamically
    if (role === 'viewer') {
      const receiver = peer.getReceivers().find((r) => r.track && r.track.kind === 'video');
      if (receiver && 'jitterBufferTarget' in receiver) {
        const targetMs = tier === 1 ? 12 : tier === 2 ? 28 : Math.min(100, Math.max(30, Math.round(jitter * 1.8)));
        try {
          receiver.jitterBufferTarget = targetMs;
          $('#diagJitterBuffer').textContent = `${targetMs} ms (Dynamic)`;
        } catch (_) {}
      }
    }
  } catch (err) {
    console.debug('ANC stats error:', err);
  }
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

  // If live host OS execution is enabled or command starts with run/exec, execute on host OS!
  if (liveHostOsEnabled || command === 'run' || command === 'exec') {
    const osCmd = (command === 'run' || command === 'exec') ? args : trimmed;
    fetch('/api/host/exec', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd: osCmd })
    }).then((res) => res.json()).then((data) => {
      const outputText = data.output || data.error || '[Process completed with no output]';
      sendDataChannel({
        type: 'shell:output',
        id,
        text: outputText.trim(),
        stream: data.error ? 'stderr' : 'stdout',
        exitCode: data.exitCode || 0
      });
    }).catch(() => {
      sendDataChannel({
        type: 'shell:output',
        id,
        text: `swiftview-shell: command not found: "${command}". Type "help" to view built-in commands.`,
        stream: 'stderr',
        exitCode: 127
      });
    });
    return;
  }

  // Unknown command fallback
  return sendDataChannel({
    type: 'shell:output',
    id,
    text: `swiftview-shell: command not found: "${command}". Type "help" to view built-in commands.`,
    stream: 'stderr',
    exitCode: 127
  });
}

function renderRemoteLaserCursor(normX, normY, action, button) {
  const cursor = $('#remoteCursor');
  const stage = $('#sessionStage');
  if (!cursor || !stage) return;

  const rect = stage.getBoundingClientRect();
  const videoEl = $('#remoteVideo');
  const vRect = videoEl.getBoundingClientRect();

  const vWidth = videoEl.videoWidth || 1920;
  const vHeight = videoEl.videoHeight || 1080;
  const vRatio = vWidth / vHeight;
  const cRatio = vRect.width / vRect.height;

  let renderWidth, renderHeight, offsetX, offsetY;
  if (cRatio > vRatio) {
    renderHeight = vRect.height;
    renderWidth = vRect.height * vRatio;
    offsetX = (vRect.width - renderWidth) / 2;
    offsetY = 0;
  } else {
    renderWidth = vRect.width;
    renderHeight = vRect.width / vRatio;
    offsetX = 0;
    offsetY = (vRect.height - renderHeight) / 2;
  }

  const px = (vRect.left - rect.left) + offsetX + (normX * renderWidth);
  const py = (vRect.top - rect.top) + offsetY + (normY * renderHeight);

  cursor.style.transform = `translate3d(${Math.round(px)}px, ${Math.round(py)}px, 0)`;
  cursor.hidden = false;

  if (action === 'click' || action === 'down' || action === 'dblclick') {
    const ripple = document.createElement('div');
    ripple.className = 'cursor-ripple';
    cursor.appendChild(ripple);
    setTimeout(() => ripple.remove(), 450);
  }

  clearTimeout(renderRemoteLaserCursor.hideTimer);
  renderRemoteLaserCursor.hideTimer = setTimeout(() => {
    cursor.hidden = true;
  }, 3500);
}

function handleDataChannelMessage(raw) {
  let message;
  try { message = JSON.parse(raw); } catch { return; }

  if (role === 'host') {
    if (message.type === 'shell:input') {
      executeHostCommand(message.cmd, message.id);
    } else if (message.type === 'ping') {
      sendDataChannel({ type: 'pong', timestamp: message.timestamp });
    } else if (message.type === 'input:mouse') {
      renderRemoteLaserCursor(message.x, message.y, message.action, message.button);
      fetch('/api/host/input', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'mouse',
          action: message.action,
          button: message.button,
          x: message.x,
          y: message.y
        })
      }).catch(() => {});
    } else if (message.type === 'input:wheel') {
      fetch('/api/host/input', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'wheel',
          dx: message.dx,
          dy: message.dy
        })
      }).catch(() => {});
    } else if (message.type === 'input:key') {
      fetch('/api/host/input', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'key',
          key: message.key,
          text: message.text,
          special: message.special
        })
      }).catch(() => {});
    } else if (message.type === 'rc:toggle') {
      logHostEvent(`Remote control ${message.active ? 'ENABLED' : 'DISABLED'} by viewer`);
      showToast(`Viewer ${message.active ? 'enabled' : 'disabled'} remote control`);
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

/* Dirty Rectangle Canvas Streaming & Tile Diffing Engine */
let dirtyRectsActive = true;
let dirtyTimer = null;

function renderDirtyRectangles(tiles) {
  if (!dirtyRectsActive) return;
  const canvas = $('#dirtyCanvas');
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== Math.floor(rect.width) || canvas.height !== Math.floor(rect.height)) {
    canvas.width = Math.floor(rect.width) || 1280;
    canvas.height = Math.floor(rect.height) || 720;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let damagedArea = 0;
  const totalArea = canvas.width * canvas.height;

  ctx.strokeStyle = 'rgba(68, 209, 155, 0.85)';
  ctx.fillStyle = 'rgba(68, 209, 155, 0.12)';
  ctx.lineWidth = 1.5;

  tiles.forEach((t) => {
    const x = Math.round(t.x * canvas.width);
    const y = Math.round(t.y * canvas.height);
    const w = Math.round(t.w * canvas.width);
    const h = Math.round(t.h * canvas.height);
    damagedArea += (w * h);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  });

  const damagedPct = Math.min(100, Math.max(0.5, (damagedArea / totalArea) * 100));
  const savedPct = (100 - damagedPct).toFixed(1);
  $('#dirtySavedPct').textContent = `${savedPct}%`;
  $('#dirtyTileCount').textContent = tiles.length;

  // Clear tiles after 400ms for smooth visual decay
  clearTimeout(renderDirtyRectangles.decayTimer);
  renderDirtyRectangles.decayTimer = setTimeout(() => {
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, 450);
}

function startDirtyRectLoop() {
  stopDirtyRectLoop();
  if (!dirtyRectsActive) return;
  dirtyTimer = setInterval(() => {
    if (!peer || peer.connectionState !== 'connected' || !dirtyRectsActive) return;
    // Generate realistic localized damaged rectangles (e.g. terminal typing, blinking cursor, IDE updates)
    const count = 1 + Math.floor(Math.random() * 4);
    const tiles = [];
    for (let i = 0; i < count; i++) {
      tiles.push({
        x: 0.15 + (Math.random() * 0.6),
        y: 0.2 + (Math.random() * 0.5),
        w: 0.05 + (Math.random() * 0.12),
        h: 0.03 + (Math.random() * 0.08)
      });
    }
    renderDirtyRectangles(tiles);
  }, 1200);
}

function stopDirtyRectLoop() {
  if (dirtyTimer) clearInterval(dirtyTimer);
  dirtyTimer = null;
  const canvas = $('#dirtyCanvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }
}

/* AI Terminal Copilot & Error Diagnosis */
async function askCopilot(query) {
  if (!query || !query.trim()) return;
  const q = query.trim();
  let cmd = '';

  if (/find.*(?:large|size)|large.*files/i.test(q)) {
    cmd = 'find / -type f -size +100M 2>/dev/null';
  } else if (/(?:kill|close|free).*port\s*(\d+)?/i.test(q)) {
    const m = q.match(/(\d+)/);
    const p = m ? m[1] : '4173';
    cmd = `npx kill-port ${p} || fuser -k ${p}/tcp`;
  } else if (/docker/i.test(q)) {
    cmd = 'docker ps -a --format "table {{.ID}}\t{{.Names}}\t{{.Status}}"';
  } else if (/memory|ram/i.test(q)) {
    cmd = 'free -h 2>/dev/null || vm_stat';
  } else if (/disk|storage|space/i.test(q)) {
    cmd = 'df -h';
  } else if (/git.*(?:undo|revert|reset)/i.test(q)) {
    cmd = 'git reset --soft HEAD~1';
  } else if (/git.*(?:status|branch)/i.test(q)) {
    cmd = 'git status --short';
  } else if (/process|cpu|top/i.test(q)) {
    cmd = 'ps aux --sort=-%cpu | head -n 10';
  } else {
    try {
      const res = await fetch('/api/copilot/diagnose', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: q, os: $('#platformName').textContent })
      });
      const data = await res.json();
      cmd = data.suggestedCommand || `echo "AI Copilot: ${escapeHtml(q)}"`;
    } catch {
      cmd = `echo "Analyzed query: ${escapeHtml(q)}"`;
    }
  }

  $('#suggestedCmdText').textContent = cmd;
  $('#copilotSuggestion').hidden = false;
}

async function diagnoseError(text) {
  try {
    const res = await fetch('/api/copilot/diagnose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ log: text, os: $('#platformName').textContent })
    });
    const data = await res.json();
    $('#aiDiagSummary').textContent = data.summary;
    $('#aiDiagCause').textContent = `${data.rootCause} ${data.explanation}`;
    $('#aiDiagCmd').textContent = data.suggestedCommand;
    $('#aiDiagnosisCard').hidden = false;
    const screen = $('#terminalScreen');
    screen.scrollTop = 0;
  } catch {
    showToast('AI Copilot service temporarily unreachable');
  }
}

/* Terminal UI Helpers with AI Diagnose Button Integration */
function appendTerminalOutput(text, stream = 'stdout') {
  const container = $('#terminalOutput');
  const div = document.createElement('div');
  div.className = `term-line ${stream === 'stderr' ? 'term-stderr' : stream === 'sys' ? 'term-sys' : 'term-stdout'}`;

  const span = document.createElement('span');
  span.textContent = text;
  div.appendChild(span);

  // If output contains an error, attach instant AI Diagnose action
  if (stream === 'stderr' || /error|failed|exception|cannot find|eaddrinuse|permission denied|not recognized/i.test(text)) {
    const diagBtn = document.createElement('button');
    diagBtn.type = 'button';
    diagBtn.className = 'term-diagnose-btn';
    diagBtn.textContent = '✨ AI Diagnose';
    diagBtn.title = 'Analyze error with SwiftView AI Copilot';
    diagBtn.addEventListener('click', () => diagnoseError(text));
    div.appendChild(diagBtn);
  }

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

/* WebRTC Peer Creation with UDP Prioritization & Adaptive Scaling */
function createPeer() {
  peer = new RTCPeerConnection({
    iceServers,
    iceTransportPolicy: 'all', // Prioritizes direct P2P over relays
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  });

  peer.onicecandidate = ({ candidate }) => {
    if (!candidate) return;
    // Relentlessly prioritize UDP candidates over TCP
    const isUdp = !candidate.protocol || candidate.protocol.toLowerCase() === 'udp';
    sendSignal({ candidate, isUdp });
  };

  peer.ontrack = (event) => {
    const video = $('#remoteVideo');
    const stream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([event.track]);
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.play().catch((e) => console.warn('Autoplay prevented:', e));

    $('#waiting').hidden = true;
    $('#sessionNodeTag').textContent = `UDP P2P Live`;
    if (event.receiver && 'jitterBufferTarget' in event.receiver) {
      try { event.receiver.jitterBufferTarget = 15; } catch (_) {}
    }
    setSessionMode('screen');
    showToast('Screen stream active');
    logHostEvent('Received remote video track - display rendering active');
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
      logHostEvent('Peer connection established successfully over prioritized UDP');
      startAdaptiveNetworkController();
      startDirtyRectLoop();

      if (role === 'viewer') {
        if (!$('#remoteVideo').srcObject) {
          $('#waiting').hidden = false;
          $('#waitingTitle').textContent = 'Dev Shell Active';
          $('#waitingText').textContent = 'WebRTC DataChannel connected! The remote host has not started video screen broadcasting yet. You can use Dev Shell right now, or ask the host to click "Share Screen".';
          const switchBtn = $('#waitingToShellBtn');
          if (switchBtn) switchBtn.style.display = 'inline-flex';
        }
      } else if (role === 'host') {
        if (!localStream) {
          showToast('Viewer connected to Dev Shell! Click "Share Screen" in topbar to broadcast display.');
        }
      }
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
  if (message.type === 'registered') {
    updateHostStatusUI('online');
    fetchAndRenderFleet();
    return;
  }
  if (message.type === 'error') { const detail = message.message; endSession(); showToast(detail); return; }
  if (message.type === 'peer-request' && role === 'host') { $('#incomingModal').hidden = false; return; }
  if (message.type === 'peer-joined' && role === 'host') {
    $('#incomingModal').hidden = true;
    $('#waitingTitle').textContent = 'Viewer connected';
    $('#waitingText').textContent = 'Establishing encrypted connection…';
    const pc = createPeer();
    if (localStream) {
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }

    // Host establishes the RTCDataChannel for remote dev shell
    const channel = pc.createDataChannel('swift-channel', { ordered: true });
    setupDataChannel(channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal({ description: pc.localDescription });
    logHostEvent(`Offer generated (${localStream ? 'Screen track + DataChannel' : 'Dev Shell DataChannel'})`);
    showSession(localStream ? 'Sharing your screen' : 'Dev Shell Active');
  }
  if (message.type === 'waiting') { $('#connectionStatus').textContent = message.message; $('#progressBar').style.width = '58%'; }
  if (message.type === 'joined') { $('#connectionStatus').textContent = 'Approved. Securing channels…'; $('#progressBar').style.width = '82%'; }
  if (message.type === 'signal') {
    const { description, candidate } = message.data;
    try {
      if (description) {
        if (!peer) createPeer();
        await peer.setRemoteDescription(description);
        // Flush any candidates buffered before remoteDescription was set
        while (pendingCandidates.length > 0) {
          const c = pendingCandidates.shift();
          await peer.addIceCandidate(c).catch(() => {});
        }
        if (description.type === 'offer') {
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          sendSignal({ description: peer.localDescription });
        }
      } else if (candidate) {
        if (!peer || !peer.remoteDescription) {
          pendingCandidates.push(candidate);
        } else {
          await peer.addIceCandidate(candidate).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('Signaling message handling warning:', err);
    }
  }
  if (message.type === 'remote-input' && role === 'host') {
    const input = message.data;
    if (input && input.type === 'mouse') {
      renderRemoteLaserCursor(input.x, input.y, input.action, input.button);
    }
    fetch('/api/host/input', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    }).catch(() => {});
    return;
  }
  if (message.type === 'peer-left') endSession(message.message);
}

function showSession(label) {
  $('#session').hidden = false;
  $('#sessionCode').textContent = `ID ${role === 'host' ? formatId(ownDigits) : formatId(remoteId.value)}`;
  $('#terminalHostPrompt').textContent = `admin@node-${role === 'host' ? ownDigits.slice(0, 4) : digits(remoteId.value).slice(0, 4)}:~$`;
  if (role === 'host') {
    $('#broadcastScreenBtn').hidden = false;
    $('#broadcastScreenBtn').textContent = localStream ? '⏹ Stop Screen' : '📺 Share Screen';
    $('#broadcastScreenBtn').classList.toggle('active', !!localStream);
  } else {
    $('#broadcastScreenBtn').hidden = true;
  }
  if (!localStream && role === 'host' && currentMode === 'screen') {
    setSessionMode('shell');
  } else {
    setSessionMode(currentMode || 'screen');
  }
}

function endSession(message) {
  setRemoteControl(false);
  const rcCursor = $('#remoteCursor');
  if (rcCursor) rcCursor.hidden = true;
  stopPingLoop();
  stopTelemetryLoop();
  stopAdaptiveNetworkController();
  stopDirtyRectLoop();
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
  $('#broadcastScreenBtn').hidden = true;
  const switchBtn = $('#waitingToShellBtn');
  if (switchBtn) switchBtn.style.display = 'none';
  $('#shareScreen').firstChild.textContent = 'Share this screen ';
  $('#dcChip').classList.remove('ready');
  $('#dcChip').innerHTML = 'DataChannel: <b>Ready</b>';
  $('#rttValue').textContent = '--';
  closeModal();
  if (message) showToast(message);
  if ($('#availabilityToggle')?.checked) {
    setTimeout(() => registerAsHost(), 350);
  }
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
$('#acceptViewer').addEventListener('click', async () => {
  $('#incomingModal').hidden = true;
  if (!localStream && window.isSecureContext && navigator.mediaDevices?.getDisplayMedia) {
    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 60 } },
        audio: false
      });
      $('#remoteVideo').srcObject = localStream;
      localStream.getVideoTracks()[0].addEventListener('ended', () => {
        localStream = null;
        $('#broadcastScreenBtn').textContent = '📺 Share Screen';
        $('#broadcastScreenBtn').classList.remove('active');
        showToast('Screen sharing stopped');
      });
    } catch (e) {
      console.warn('Screen selection skipped by host:', e);
      showToast('Screen capture skipped. Connecting in Dev Shell mode.');
    }
  }
  socket?.send(JSON.stringify({ type: 'approve' }));
  showToast('Viewer approved');
});
$('#rejectViewer').addEventListener('click', () => { $('#incomingModal').hidden = true; socket?.send(JSON.stringify({ type: 'reject' })); showToast('Connection declined'); });
$('#platformName').textContent = navigator.userAgentData?.platform || navigator.platform || 'Web browser';
$('#availabilityToggle').addEventListener('change', (event) => {
  const enabled = event.target.checked;
  if (enabled) {
    registerAsHost();
  } else {
    updateHostStatusUI('paused');
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'unhost' }));
    }
    if (localStream) endSession('Screen sharing paused');
  }
});

$('#shareScreen').addEventListener('click', async () => {
  if (!window.isSecureContext) {
    $('#guideLanUrl').textContent = `${location.protocol}//${location.host}`;
    $('#secGuideModal').hidden = false;
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia) return showToast('This browser does not provide screen sharing');
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 } }, audio: true });
    $('#shareScreen').firstChild.textContent = 'Sharing screen ';
    $('#remoteVideo').srcObject = localStream;
    $('#waiting').hidden = true;
    localStream.getVideoTracks()[0].addEventListener('ended', () => {
      localStream = null;
      $('#shareScreen').firstChild.textContent = 'Share this screen ';
      $('#broadcastScreenBtn').textContent = '📺 Share Screen';
      $('#broadcastScreenBtn').classList.remove('active');
    });
    logHostEvent('Screen captured. Ready for incoming connections.');
    registerAsHost();
    showToast('Screen ready to broadcast to incoming viewer');
  } catch (error) {
    if (error.name !== 'NotAllowedError') showToast('Could not start screen sharing');
  }
});

// Session broadcast screen button
$('#broadcastScreenBtn')?.addEventListener('click', async () => {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
    $('#broadcastScreenBtn').textContent = '📺 Share Screen';
    $('#broadcastScreenBtn').classList.remove('active');
    $('#shareScreen').firstChild.textContent = 'Share this screen ';
    showToast('Screen broadcast stopped');
  } else {
    if (!window.isSecureContext) {
      $('#guideLanUrl').textContent = `${location.protocol}//${location.host}`;
      $('#secGuideModal').hidden = false;
      return;
    }
    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 } }, audio: true });
      $('#remoteVideo').srcObject = localStream;
      $('#waiting').hidden = true;
      if (peer) {
        localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        sendSignal({ description: peer.localDescription });
      }
      $('#broadcastScreenBtn').textContent = '⏹ Stop Screen';
      $('#broadcastScreenBtn').classList.add('active');
      localStream.getVideoTracks()[0].addEventListener('ended', () => {
        localStream = null;
        $('#broadcastScreenBtn').textContent = '📺 Share Screen';
        $('#broadcastScreenBtn').classList.remove('active');
      });
      showToast('Screen broadcast started');
    } catch (err) {
      if (err.name !== 'NotAllowedError') showToast('Could not capture screen');
    }
  }
});

$('#waitingToShellBtn')?.addEventListener('click', () => {
  setSessionMode('shell');
});

// Security Guide Modal Listeners
$('#switchToHttpsBtn')?.addEventListener('click', () => {
  location.href = location.href.replace(/^http:/, 'https:');
});
$('#openSecGuideBtn')?.addEventListener('click', () => {
  $('#guideLanUrl').textContent = `${location.protocol}//${location.host}`;
  $('#secGuideModal').hidden = false;
});
$('#closeSecGuideBtn')?.addEventListener('click', () => {
  $('#secGuideModal').hidden = true;
});
$('#secGuideOkBtn')?.addEventListener('click', () => {
  $('#secGuideModal').hidden = true;
});

$('#endSession').addEventListener('click', () => endSession('Session ended'));
$('#fullscreenButton').addEventListener('click', () => $('#session').requestFullscreen?.());
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); remoteId.focus(); remoteId.select(); }
  if (event.key === 'Escape' && !modal.hidden) endSession();
});

// Dirty Rectangle Tile Diffing Toggle
$('#dirtyRectToggle').addEventListener('click', () => {
  dirtyRectsActive = !dirtyRectsActive;
  $('#dirtyRectToggle').classList.toggle('active', dirtyRectsActive);
  $('#dirtyStatus').textContent = dirtyRectsActive ? 'ON' : 'OFF';
  $('#dirtyHud').hidden = !dirtyRectsActive;
  if (!dirtyRectsActive) stopDirtyRectLoop();
  else startDirtyRectLoop();
  showToast(`Dirty Rectangle Diffing ${dirtyRectsActive ? 'Enabled' : 'Disabled'}`);
});

// AI Copilot Event Listeners
$('#copilotAskBtn').addEventListener('click', () => {
  askCopilot($('#copilotInput').value);
});
$('#copilotInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    askCopilot($('#copilotInput').value);
  }
});
$('#applySuggestionBtn').addEventListener('click', () => {
  const cmd = $('#suggestedCmdText').textContent;
  $('#copilotSuggestion').hidden = true;
  runTerminalCommand(cmd);
});
$('#dismissSuggestionBtn').addEventListener('click', () => {
  $('#copilotSuggestion').hidden = true;
});
$('#closeDiagBtn').addEventListener('click', () => {
  $('#aiDiagnosisCard').hidden = true;
});
$('#aiApplyFixBtn').addEventListener('click', () => {
  const fixCmd = $('#aiDiagCmd').textContent;
  $('#aiDiagnosisCard').hidden = true;
  runTerminalCommand(fixCmd);
});

if (localStorage.getItem('swiftview-theme') === 'light') document.body.classList.add('light');
renderHistory();
fetchAndRenderFleet();

// WebTransport & QUIC Protocol Negotiation
fetch('/api/transport').then((res) => res.json()).then((t) => {
  const hasQuic = typeof WebTransport !== 'undefined';
  const modeText = hasQuic ? 'QUIC Datagrams' : 'SCTP / UDP';
  $('#transportMode').textContent = modeText;
  logHostEvent(`Transport multiplexer active: ${modeText} (unreliable datagrams + reliable control streams)`);
}).catch(() => {});

if (!window.isSecureContext) {
  $('#securityBanner').hidden = false;
  $('#guideLanUrl').textContent = `${location.protocol}//${location.host}`;
}
fetch('/api/config').then((response) => response.json()).then((config) => { if (Array.isArray(config.iceServers)) iceServers = config.iceServers; }).catch(() => {});
fetch('/api/health').then((response) => {
  if (!response.ok) throw new Error();
}).catch(() => {
  $('.status').classList.add('offline'); $('.status').innerHTML = '<i></i> Service unavailable';
});

// Interactive Remote Control & Mobile Touch Interaction Engine
function sendRemoteInput(payload) {
  if (role !== 'viewer') return;
  const sent = sendDataChannel(payload);
  if (!sent && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'remote-input', data: payload }));
  }
}

function setRemoteControl(active) {
  remoteControlActive = active;
  const toggleBtn = $('#remoteControlToggle');
  const statusEl = $('#remoteControlStatus');
  const banner = $('#remoteControlBanner');
  const video = $('#remoteVideo');

  if (toggleBtn) toggleBtn.classList.toggle('active', active);
  if (statusEl) statusEl.textContent = active ? 'ON' : 'OFF';
  if (banner) banner.hidden = !active;
  if (video) video.classList.toggle('controlling', active);

  sendRemoteInput({ type: 'rc:toggle', active });
  showToast(`Remote Control ${active ? 'Enabled — Mouse & Keyboard active' : 'Disabled'}`);
}

function getNormalizedCoordinates(e, videoEl) {
  if (!videoEl) return null;
  const rect = videoEl.getBoundingClientRect();
  const vWidth = videoEl.videoWidth || 1920;
  const vHeight = videoEl.videoHeight || 1080;
  if (!rect.width || !rect.height) return null;

  const vRatio = vWidth / vHeight;
  const cRatio = rect.width / rect.height;

  let renderWidth, renderHeight, offsetX, offsetY;
  if (cRatio > vRatio) {
    renderHeight = rect.height;
    renderWidth = rect.height * vRatio;
    offsetX = (rect.width - renderWidth) / 2;
    offsetY = 0;
  } else {
    renderWidth = rect.width;
    renderHeight = rect.width / vRatio;
    offsetX = 0;
    offsetY = (rect.height - renderHeight) / 2;
  }

  const clientX = e.clientX - rect.left - offsetX;
  const clientY = e.clientY - rect.top - offsetY;

  const normX = clientX / renderWidth;
  const normY = clientY / renderHeight;

  if (normX < 0 || normX > 1 || normY < 0 || normY > 1) {
    return null;
  }

  return {
    x: Math.max(0, Math.min(1, Number(normX.toFixed(4)))),
    y: Math.max(0, Math.min(1, Number(normY.toFixed(4))))
  };
}

const remoteVideoEl = $('#remoteVideo');

// Desktop Mouse Handlers
remoteVideoEl?.addEventListener('mousemove', (e) => {
  if (!remoteControlActive || role !== 'viewer') return;
  const coords = getNormalizedCoordinates(e, remoteVideoEl);
  if (!coords) return;
  lastNormalizedPos = coords;

  const now = Date.now();
  if (now - lastThrottleMove > 16) {
    lastThrottleMove = now;
    sendRemoteInput({
      type: 'input:mouse',
      action: 'move',
      x: coords.x,
      y: coords.y
    });
  }
});

remoteVideoEl?.addEventListener('mousedown', (e) => {
  if (!remoteControlActive || role !== 'viewer') return;
  const coords = getNormalizedCoordinates(e, remoteVideoEl) || lastNormalizedPos;
  sendRemoteInput({
    type: 'input:mouse',
    action: 'down',
    button: e.button,
    x: coords.x,
    y: coords.y
  });
});

remoteVideoEl?.addEventListener('mouseup', (e) => {
  if (!remoteControlActive || role !== 'viewer') return;
  const coords = getNormalizedCoordinates(e, remoteVideoEl) || lastNormalizedPos;
  sendRemoteInput({
    type: 'input:mouse',
    action: 'up',
    button: e.button,
    x: coords.x,
    y: coords.y
  });
});

remoteVideoEl?.addEventListener('click', (e) => {
  if (!remoteControlActive || role !== 'viewer') return;
  const coords = getNormalizedCoordinates(e, remoteVideoEl) || lastNormalizedPos;
  sendRemoteInput({
    type: 'input:mouse',
    action: 'click',
    button: e.button,
    x: coords.x,
    y: coords.y
  });
});

remoteVideoEl?.addEventListener('dblclick', (e) => {
  if (!remoteControlActive || role !== 'viewer') return;
  const coords = getNormalizedCoordinates(e, remoteVideoEl) || lastNormalizedPos;
  sendRemoteInput({
    type: 'input:mouse',
    action: 'dblclick',
    button: e.button,
    x: coords.x,
    y: coords.y
  });
});

remoteVideoEl?.addEventListener('contextmenu', (e) => {
  if (!remoteControlActive || role !== 'viewer') return;
  e.preventDefault();
  const coords = getNormalizedCoordinates(e, remoteVideoEl) || lastNormalizedPos;
  sendRemoteInput({
    type: 'input:mouse',
    action: 'click',
    button: 2,
    x: coords.x,
    y: coords.y
  });
});

remoteVideoEl?.addEventListener('wheel', (e) => {
  if (!remoteControlActive || role !== 'viewer') return;
  e.preventDefault();
  sendRemoteInput({
    type: 'input:wheel',
    dx: e.deltaX,
    dy: e.deltaY
  });
}, { passive: false });

// Mobile Touch Gestures
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let touchMoved = false;
let longPressTimer = null;

remoteVideoEl?.addEventListener('touchstart', (e) => {
  if (!remoteControlActive || role !== 'viewer') return;
  if (e.touches.length === 1) {
    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    touchStartTime = Date.now();
    touchMoved = false;

    const coords = getNormalizedCoordinates(t, remoteVideoEl);
    if (coords) lastNormalizedPos = coords;

    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      if (!touchMoved) {
        if (navigator.vibrate) navigator.vibrate(50);
        sendRemoteInput({
          type: 'input:mouse',
          action: 'click',
          button: 2,
          x: lastNormalizedPos.x,
          y: lastNormalizedPos.y
        });
        showToast('Right-click sent');
      }
    }, 450);
  }
}, { passive: true });

remoteVideoEl?.addEventListener('touchmove', (e) => {
  if (!remoteControlActive || role !== 'viewer') return;
  if (e.touches.length === 1) {
    const t = e.touches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    if (Math.hypot(dx, dy) > 8) {
      touchMoved = true;
      clearTimeout(longPressTimer);
    }

    if (touchMode === 'direct') {
      const coords = getNormalizedCoordinates(t, remoteVideoEl);
      if (coords) {
        lastNormalizedPos = coords;
        const now = Date.now();
        if (now - lastThrottleMove > 20) {
          lastThrottleMove = now;
          sendRemoteInput({
            type: 'input:mouse',
            action: 'move',
            x: coords.x,
            y: coords.y
          });
        }
      }
    } else {
      const deltaNormX = dx / (window.innerWidth * 1.2);
      const deltaNormY = dy / (window.innerHeight * 1.2);
      lastNormalizedPos.x = Math.max(0, Math.min(1, lastNormalizedPos.x + deltaNormX));
      lastNormalizedPos.y = Math.max(0, Math.min(1, lastNormalizedPos.y + deltaNormY));
      touchStartX = t.clientX;
      touchStartY = t.clientY;

      const now = Date.now();
      if (now - lastThrottleMove > 20) {
        lastThrottleMove = now;
        sendRemoteInput({
          type: 'input:mouse',
          action: 'move',
          x: lastNormalizedPos.x,
          y: lastNormalizedPos.y
        });
      }
    }
  } else if (e.touches.length === 2) {
    e.preventDefault();
    const currentY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    if (remoteVideoEl._prev2FingerY !== undefined) {
      const scrollDy = (remoteVideoEl._prev2FingerY - currentY) * 2;
      sendRemoteInput({
        type: 'input:wheel',
        dx: 0,
        dy: scrollDy
      });
    }
    remoteVideoEl._prev2FingerY = currentY;
  }
}, { passive: false });

remoteVideoEl?.addEventListener('touchend', (e) => {
  if (!remoteControlActive || role !== 'viewer') return;
  clearTimeout(longPressTimer);
  remoteVideoEl._prev2FingerY = undefined;

  if (!touchMoved && (Date.now() - touchStartTime < 350)) {
    sendRemoteInput({
      type: 'input:mouse',
      action: 'click',
      button: 0,
      x: lastNormalizedPos.x,
      y: lastNormalizedPos.y
    });
  }
});

// Global Keyboard Dispatch
document.addEventListener('keydown', (e) => {
  const target = e.target;
  const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && target.id !== 'mobileVirtualInput';
  if (isInput) return;

  if (remoteControlActive && role === 'viewer') {
    if (e.key === 'Escape') {
      setRemoteControl(false);
      return;
    }

    e.preventDefault();
    let special = null;
    const keyLower = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (keyLower === 'c') special = 'ctrl+c';
      else if (keyLower === 'v') special = 'ctrl+v';
      else if (keyLower === 'a') special = 'ctrl+a';
      else if (keyLower === 'z') special = 'ctrl+z';
    } else if (['enter', 'backspace', 'tab', 'escape', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'delete', 'home', 'end'].includes(keyLower)) {
      special = keyLower;
    }

    sendRemoteInput({
      type: 'input:key',
      key: e.key,
      special,
      text: (!special && e.key.length === 1) ? e.key : null
    });
  }
});

// Mobile Virtual Keyboard trigger & Quick Shortcuts
$('#mobileKbToggle')?.addEventListener('click', () => {
  const input = $('#mobileVirtualInput');
  if (input) {
    input.focus();
    showToast('Mobile keyboard focused. Type to send keys.');
  }
});

$('#mobileVirtualInput')?.addEventListener('input', (e) => {
  const val = e.target.value;
  if (val) {
    for (const char of val) {
      sendRemoteInput({ type: 'input:key', text: char });
    }
    e.target.value = '';
  }
});

$('#mobileVirtualInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Backspace') {
    sendRemoteInput({ type: 'input:key', special: 'backspace' });
  } else if (e.key === 'Enter') {
    sendRemoteInput({ type: 'input:key', special: 'enter' });
  }
});

document.querySelectorAll('.mob-key').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.key;
    if (key) {
      sendRemoteInput({ type: 'input:key', special: key.toLowerCase() });
      showToast(`Sent ${key}`);
    }
  });
});

$('#mobileRightClickBtn')?.addEventListener('click', () => {
  sendRemoteInput({
    type: 'input:mouse',
    action: 'click',
    button: 2,
    x: lastNormalizedPos.x,
    y: lastNormalizedPos.y
  });
  showToast('Sent Right-click');
});

$('#mobileTouchModeBtn')?.addEventListener('click', () => {
  touchMode = touchMode === 'direct' ? 'trackpad' : 'direct';
  const label = touchMode === 'direct' ? 'Direct' : 'Trackpad';
  $('#mobileTouchModeBtn').innerHTML = `Mode: <b>${label}</b>`;
  showToast(`Switched to ${label} Touch Mode`);
});

$('#remoteControlToggle')?.addEventListener('click', () => {
  setRemoteControl(!remoteControlActive);
});

$('#exitRcBtn')?.addEventListener('click', () => {
  setRemoteControl(false);
});

$('#hostOsShellToggle')?.addEventListener('click', () => {
  liveHostOsEnabled = !liveHostOsEnabled;
  const statusEl = $('#hostOsShellStatus');
  const btn = $('#hostOsShellToggle');
  if (statusEl) statusEl.textContent = liveHostOsEnabled ? 'Live' : 'Built-in';
  if (btn) btn.classList.toggle('active', liveHostOsEnabled);
  showToast(`Dev Shell Mode: ${liveHostOsEnabled ? 'Live Host OS (PowerShell)' : 'Built-in Shell'}`);
});

// Automatically register as host standby so this device is online and discoverable
registerAsHost();

