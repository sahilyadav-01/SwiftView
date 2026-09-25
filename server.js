const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');

const root = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ status: 'ok', service: 'swiftview', version: '0.1.0' }));
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
  const wss = new WebSocketServer({ server, path: '/signal' });
  const rooms = new Map();
  const send = (socket, payload) => socket && socket.readyState === 1 && socket.send(JSON.stringify(payload));

  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return send(socket, { type: 'error', message: 'Invalid message' }); }
      if (message.type === 'host' && /^\d{9}$/.test(message.code)) {
        const existing = rooms.get(message.code);
        if (existing?.host?.readyState === socket.OPEN) return send(socket, { type: 'error', message: 'Device ID is already online' });
        socket.room = message.code; socket.role = 'host';
        rooms.set(message.code, { host: socket, viewer: null });
        return send(socket, { type: 'registered' });
      }
      if (message.type === 'join' && /^\d{9}$/.test(message.code)) {
        const room = rooms.get(message.code);
        if (!room?.host || room.host.readyState !== socket.OPEN) return send(socket, { type: 'error', message: 'Remote device is offline or unavailable' });
        if (room.viewer?.readyState === socket.OPEN) return send(socket, { type: 'error', message: 'Remote device is already in a session' });
        socket.room = message.code; socket.role = 'viewer'; room.viewer = socket;
        send(socket, { type: 'joined' }); return send(room.host, { type: 'peer-joined' });
      }
      if (message.type === 'signal' && socket.room) {
        const room = rooms.get(socket.room);
        return send(socket.role === 'host' ? room?.viewer : room?.host, { type: 'signal', data: message.data });
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

if (require.main === module) {
  const server = http.createServer(handler);
  attachSignaling(server);
  server.listen(port, () => {
    console.log(`SwiftView is running at http://localhost:${port}`);
  });
}

module.exports = { handler, attachSignaling };
