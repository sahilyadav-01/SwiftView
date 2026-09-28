const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync, spawn } = require('node:child_process');
const { WebSocketServer } = require('ws');

const root = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const rooms = new Map();

let inputBridgeProcess = null;

function closeInputBridge() {
  const bridge = inputBridgeProcess;
  inputBridgeProcess = null;
  if (!bridge) return;

  if (bridge.stdin && !bridge.stdin.destroyed) bridge.stdin.end();
  if (bridge.exitCode === null && !bridge.killed) bridge.kill();
}

function getInputBridge() {
  if (process.platform !== 'win32') return null;
  if (inputBridgeProcess && !inputBridgeProcess.killed && inputBridgeProcess.exitCode === null) {
    return inputBridgeProcess;
  }
  const script = path.join(__dirname, 'scripts', 'input-bridge.ps1');
  if (!fs.existsSync(script)) return null;

  try {
    inputBridgeProcess = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', script
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    inputBridgeProcess.stderr.on('data', (d) => {
      const err = d.toString().trim();
      if (err) console.warn('[InputBridge stderr]:', err);
    });

    const bridge = inputBridgeProcess;
    inputBridgeProcess.on('error', (err) => {
      console.warn('[InputBridge] Process error:', err.message);
    });
    inputBridgeProcess.on('exit', () => {
      if (inputBridgeProcess === bridge) inputBridgeProcess = null;
    });

    return inputBridgeProcess;
  } catch (err) {
    console.warn('[InputBridge] Failed to spawn:', err.message);
    return null;
  }
}

function dispatchHostInput(event) {
  if (!event || typeof event !== 'object') return false;
  const type = {
    'input:mouse': 'mouse',
    'input:wheel': 'wheel',
    'input:key': 'key'
  }[event.type] || event.type;
  if (!['mouse', 'wheel', 'key'].includes(type)) return false;

  const bridge = getInputBridge();
  if (!bridge || !bridge.stdin || bridge.stdin.destroyed) return false;
  try {
    bridge.stdin.write(JSON.stringify({ ...event, type }) + '\n');
    return true;
  } catch {
    return false;
  }
}

function getLocalIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ status: 'ok', service: 'swiftview', version: '0.2.0' }));
  }
  if (url.pathname === '/api/config') {
    const iceServers = [{ urls: process.env.STUN_URL || 'stun:stun.l.google.com:19302' }];
    if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      iceServers.push({ urls: process.env.TURN_URL, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ iceServers, turnConfigured: iceServers.length > 1 }));
  }
  if (url.pathname === '/api/fleet') {
    const devices = [];
    for (const [code, room] of rooms.entries()) {
      if (room.host && room.host.readyState === 1) {
        devices.push({
          id: code,
          busy: !!(room.viewer && room.viewer.readyState === 1),
          registeredAt: room.registeredAt || Date.now()
        });
      }
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ count: devices.length, devices }));
  }
  if (url.pathname === '/api/transport') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({
      quicSupported: true,
      webTransportEnabled: true,
      protocols: ['webtransport-quic', 'webrtc-datachannel', 'websocket-relay'],
      datagramMaxPayload: 1200,
      features: ['unreliable-datagrams', 'reliable-streams', 'multiplexing']
    }));
  }
  if (url.pathname === '/api/copilot/diagnose' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const text = payload.log || payload.command || '';
        const os = payload.os || 'Linux';
        let diagnosis = {
          errorType: 'GenericExecutionNotice',
          summary: 'Command executed with non-zero exit code or anomalous output.',
          rootCause: 'Process returned standard error output.',
          suggestedCommand: 'dmesg -T | tail -n 20',
          confidence: 0.72,
          explanation: 'Review kernel and recent process logs to pinpoint failure reason.'
        };

        if (/cannot find module ['"]?([^'"\s]+)['"]?/i.test(text)) {
          const mod = text.match(/cannot find module ['"]?([^'"\s]+)['"]?/i)[1];
          diagnosis = {
            errorType: 'NodeModuleNotFound',
            summary: `Missing Node.js dependency: '${mod}'.`,
            rootCause: `Package '${mod}' is required but not installed in the local node_modules hierarchy.`,
            suggestedCommand: `npm install ${mod}`,
            confidence: 0.98,
            explanation: `Run 'npm install ${mod}' to download and link the missing dependency.`
          };
        } else if (/eaddrinuse|address already in use/i.test(text)) {
          const portMatch = text.match(/:(\d{2,5})/);
          const p = portMatch ? portMatch[1] : '4173';
          diagnosis = {
            errorType: 'PortCollision',
            summary: `Port ${p} is already bound by another process.`,
            rootCause: `A previous server or background daemon is occupying port ${p}.`,
            suggestedCommand: os.includes('Windows') ? `Stop-Process -Id (Get-NetTCPConnection -LocalPort ${p}).OwningProcess -Force` : `fuser -k ${p}/tcp`,
            confidence: 0.95,
            explanation: `Terminate the process holding port ${p} or select an alternative port via environment variable PORT.`
          };
        } else if (/permission denied|eacces/i.test(text)) {
          diagnosis = {
            errorType: 'PermissionDenied',
            summary: 'Insufficient filesystem or process permissions.',
            rootCause: 'The user account does not have write or execute privileges for the requested target.',
            suggestedCommand: os.includes('Windows') ? 'Start-Process powershell -Verb runAs' : 'chmod +x ./* && sudo !!',
            confidence: 0.92,
            explanation: 'Grant execution permissions using chmod or run command in an elevated administrative shell.'
          };
        } else if (/command not found|is not recognized as an internal/i.test(text)) {
          const cmdMatch = text.match(/(?:command not found:?|not recognized as an internal or external command.*)['"]?([a-zA-Z0-9_-]+)/i);
          const missingCmd = cmdMatch ? cmdMatch[1] : 'utility';
          diagnosis = {
            errorType: 'BinaryNotFound',
            summary: `Executable '${missingCmd}' is not in system PATH.`,
            rootCause: `The binary '${missingCmd}' is not installed or the directory is missing from the environment PATH.`,
            suggestedCommand: `which ${missingCmd} || where.exe ${missingCmd}`,
            confidence: 0.91,
            explanation: `Install '${missingCmd}' using your system package manager (winget/apt/brew) or update system PATH.`
          };
        } else if (/git/i.test(text) && /conflict|fatal: not a git repository/i.test(text)) {
          diagnosis = {
            errorType: 'GitRepositoryError',
            summary: 'Git state conflict or missing repository initialization.',
            rootCause: 'Working directory has unresolved conflicts or lacks a .git configuration.',
            suggestedCommand: 'git status --short',
            confidence: 0.89,
            explanation: 'Check repository status and resolve conflicted hunks before proceeding.'
          };
        }

        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(diagnosis));
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    });
    return;
  }
  if (url.pathname === '/api/host/capabilities') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({
      os: os.type(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      hostname: os.hostname(),
      canControlInput: process.platform === 'win32',
      inputBridgeAvailable: !!fs.existsSync(path.join(__dirname, 'scripts', 'input-bridge.ps1'))
    }));
  }
  if (url.pathname === '/api/host/input' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const dispatched = dispatchHostInput(payload);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, dispatched }));
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }
  if (url.pathname === '/api/host/exec' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { cmd } = JSON.parse(body || '{}');
        if (!cmd || typeof cmd !== 'string') {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: 'Missing command' }));
        }
        const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
        try {
          const stdout = execSync(cmd, { shell, timeout: 8000, encoding: 'utf8', maxBuffer: 512 * 1024 });
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ output: stdout, exitCode: 0 }));
        } catch (execErr) {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            output: execErr.stdout || '',
            error: execErr.stderr || execErr.message,
            exitCode: execErr.status || 1
          }));
        }
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(file, (error, body) => {
    if (error) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'content-type': types[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    res.end(body);
  });
}

function attachSignaling(server) {
  const wss = new WebSocketServer({ server, path: '/signal', maxPayload: 64 * 1024 });
  server.once('close', closeInputBridge);
  const send = (socket, payload) => socket && socket.readyState === 1 && socket.send(JSON.stringify(payload));

  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return send(socket, { type: 'error', message: 'Invalid message' }); }
      if (message.type === 'fleet') {
        const devices = [];
        for (const [code, room] of rooms.entries()) {
          if (room.host && room.host.readyState === 1) {
            devices.push({ id: code, busy: !!(room.viewer && room.viewer.readyState === 1) });
          }
        }
        return send(socket, { type: 'fleet', devices });
      }
      if (message.type === 'host' && /^\d{9}$/.test(message.code)) {
        if (socket.room && socket.role === 'host' && socket.room !== message.code) {
          rooms.delete(socket.room);
        }
        const existing = rooms.get(message.code);
        if (existing?.host && existing.host !== socket && existing.host.readyState === socket.OPEN) {
          return send(socket, { type: 'error', message: 'Device ID is already online' });
        }
        socket.room = message.code; socket.role = 'host';
        rooms.set(message.code, { host: socket, viewer: null, meta: message.meta || {}, registeredAt: Date.now() });
        return send(socket, { type: 'registered' });
      }
      if (message.type === 'unhost') {
        if (socket.room && socket.role === 'host') {
          rooms.delete(socket.room);
          socket.room = null;
          socket.role = null;
          return send(socket, { type: 'unregistered' });
        }
      }
      if (message.type === 'join' && /^\d{9}$/.test(message.code)) {
        const room = rooms.get(message.code);
        if (!room?.host || room.host.readyState !== socket.OPEN) return send(socket, { type: 'error', message: 'Remote device is offline or unavailable' });
        if (room.viewer?.readyState === socket.OPEN) return send(socket, { type: 'error', message: 'Remote device is already in a session' });
        if (socket.room && socket.role === 'host') {
          rooms.delete(socket.room);
        }
        socket.room = message.code; socket.role = 'viewer'; room.viewer = socket;
        send(socket, { type: 'waiting', message: 'Waiting for the host to approve your request' });
        return send(room.host, { type: 'peer-request', meta: message.meta || {} });
      }
      if (message.type === 'approve' && socket.role === 'host') {
        const room = rooms.get(socket.room);
        if (!room?.viewer) return;
        send(room.viewer, { type: 'joined' }); return send(room.host, { type: 'peer-joined' });
      }
      if (message.type === 'reject' && socket.role === 'host') {
        const room = rooms.get(socket.room);
        if (!room?.viewer) return;
        send(room.viewer, { type: 'error', message: 'The host declined the connection request' });
        room.viewer.room = null; room.viewer.role = null; room.viewer = null; return;
      }
      if (message.type === 'signal' && socket.room) {
        const room = rooms.get(socket.room);
        return send(socket.role === 'host' ? room?.viewer : room?.host, { type: 'signal', data: message.data });
      }
      if (message.type === 'remote-input' && socket.room) {
        const room = rooms.get(socket.room);
        if (room && socket.role === 'viewer') {
          dispatchHostInput(message.data);
          // Relay only so the host UI can visualize the remote pointer. The
          // server has already injected this event into the native bridge.
          return send(room.host, { type: 'remote-input', data: message.data });
        }
      }
      if (message.type === 'remote-control-state' && socket.room) {
        const room = rooms.get(socket.room);
        const target = socket.role === 'host' ? room?.viewer : room?.host;
        return send(target, { type: 'remote-control-state', enabled: !!message.enabled });
      }
    });
    socket.on('close', () => {
      const room = rooms.get(socket.room); if (!room) return;
      if (socket.role === 'host') { send(room.viewer, { type: 'peer-left', message: 'Remote device ended the session' }); rooms.delete(socket.room); }
      else if (room.viewer === socket) { room.viewer = null; send(room.host, { type: 'peer-left', message: 'Viewer disconnected' }); }
    });
  });
  return wss;
}

function ensureCertificate() {
  const pfxPath = path.join(__dirname, 'cert.pfx');
  if (fs.existsSync(pfxPath)) {
    return { pfx: fs.readFileSync(pfxPath), passphrase: 'swiftview' };
  }
  const certPem = path.join(__dirname, 'cert.pem');
  const keyPem = path.join(__dirname, 'key.pem');
  if (fs.existsSync(certPem) && fs.existsSync(keyPem)) {
    return { cert: fs.readFileSync(certPem), key: fs.readFileSync(keyPem) };
  }
  try {
    const localIps = getLocalIps();
    const names = ['localhost', '127.0.0.1', ...localIps].map((n) => `'${n}'`).join(',');
    const pfxClean = pfxPath.replace(/\\/g, '/');
    const cmd = `$cert = New-SelfSignedCertificate -DnsName ${names} -CertStoreLocation 'cert:\\CurrentUser\\My'; $pwd = ConvertTo-SecureString -String 'swiftview' -Force -AsPlainText; Export-PfxCertificate -Cert $cert -FilePath '${pfxClean}' -Password $pwd`;
    execSync(`powershell -NoProfile -Command "${cmd}"`, { stdio: 'ignore' });
    if (fs.existsSync(pfxPath)) {
      return { pfx: fs.readFileSync(pfxPath), passphrase: 'swiftview' };
    }
  } catch (err) {
    console.warn('Could not auto-generate self-signed certificate:', err.message);
  }
  return null;
}

if (require.main === module) {
  if (process.platform === 'win32') {
    try { getInputBridge(); } catch (_) {}
  }
  const localIps = getLocalIps();
  const primaryIp = localIps[0] || '127.0.0.1';
  const sslOpts = ensureCertificate();

  const httpServer = http.createServer(handler);
  attachSignaling(httpServer);

  let mainServer;
  if (sslOpts) {
    const httpsServer = https.createServer(sslOpts, handler);
    attachSignaling(httpsServer);

    mainServer = net.createServer((socket) => {
      socket.once('data', (buf) => {
        socket.pause();
        socket.unshift(buf);
        if (buf[0] === 22) {
          httpsServer.emit('connection', socket);
        } else {
          httpServer.emit('connection', socket);
        }
        process.nextTick(() => socket.resume());
      });
    });
  } else {
    mainServer = httpServer;
  }

  mainServer.listen(port, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`  SwiftView Server Running (Dual HTTP & HTTPS Active)`);
    console.log(`  > Local:   http://localhost:${port}  |  https://localhost:${port}`);
    console.log(`  > Network: http://${primaryIp}:${port}  |  https://${primaryIp}:${port}`);
    console.log(`  * Open https://${primaryIp}:${port} for full 60fps screen video.`);
    console.log(`======================================================\n`);
  });
}

module.exports = { handler, attachSignaling };
