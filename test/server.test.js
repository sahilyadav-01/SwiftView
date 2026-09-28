const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { handler, attachSignaling } = require('../server');

let server;
let baseUrl;
test.before(async () => {
  server = http.createServer(handler);
  attachSignaling(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));

test('serves the application', async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /SwiftView/);
});

test('returns service health', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'swiftview', version: '0.2.0' });
});

test('returns safe public ICE configuration', async () => {
  const response = await fetch(`${baseUrl}/api/config`);
  const config = await response.json();
  assert.equal(config.turnConfigured, false);
  assert.match(config.iceServers[0].urls, /^stun:/);
});

test('prevents path traversal', async () => {
  const response = await fetch(`${baseUrl}/..%2Fplan.md`);
  assert.notEqual(response.status, 200);
});

test('pairs a host and viewer and relays WebRTC signaling', async () => {
  const wsUrl = baseUrl.replace('http', 'ws') + '/signal';
  const host = new WebSocket(wsUrl);
  const viewer = new WebSocket(wsUrl);
  await Promise.all([
    new Promise((resolve) => host.once('open', resolve)),
    new Promise((resolve) => viewer.once('open', resolve))
  ]);
  host.send(JSON.stringify({ type: 'host', code: '123456789' }));
  await new Promise((resolve) => host.once('message', resolve));
  viewer.send(JSON.stringify({ type: 'join', code: '123456789' }));
  const request = JSON.parse(await new Promise((resolve) => host.once('message', resolve)));
  assert.equal(request.type, 'peer-request');
  host.send(JSON.stringify({ type: 'approve' }));
  await new Promise((resolve) => viewer.once('message', resolve));
  await new Promise((resolve) => host.once('message', resolve));
  const relayed = new Promise((resolve) => viewer.once('message', (data) => resolve(JSON.parse(data))));
  host.send(JSON.stringify({ type: 'signal', data: { candidate: 'test-candidate' } }));
  assert.deepEqual(await relayed, { type: 'signal', data: { candidate: 'test-candidate' } });
  host.close(); viewer.close();
});

test('lets a host reject an incoming viewer', async () => {
  const wsUrl = baseUrl.replace('http', 'ws') + '/signal';
  const host = new WebSocket(wsUrl);
  const viewer = new WebSocket(wsUrl);
  await Promise.all([
    new Promise((resolve) => host.once('open', resolve)),
    new Promise((resolve) => viewer.once('open', resolve))
  ]);
  host.send(JSON.stringify({ type: 'host', code: '987654321' }));
  await new Promise((resolve) => host.once('message', resolve));
  viewer.send(JSON.stringify({ type: 'join', code: '987654321' }));
  await new Promise((resolve) => host.once('message', resolve));
  const rejected = new Promise((resolve) => viewer.on('message', (data) => {
    const message = JSON.parse(data);
    if (message.type === 'error') resolve(message);
  }));
  host.send(JSON.stringify({ type: 'reject' }));
  assert.match((await rejected).message, /declined/i);
  host.close(); viewer.close();
});

test('tracks fleet nodes and reports via /api/fleet', async () => {
  const wsUrl = baseUrl.replace('http', 'ws') + '/signal';
  const host = new WebSocket(wsUrl);
  await new Promise((resolve) => host.once('open', resolve));
  host.send(JSON.stringify({ type: 'host', code: '555666777' }));
  await new Promise((resolve) => host.once('message', resolve));

  const response = await fetch(`${baseUrl}/api/fleet`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.devices.some((d) => d.id === '555666777'));

  host.close();
});

test('reports WebTransport and QUIC capabilities via /api/transport', async () => {
  const response = await fetch(`${baseUrl}/api/transport`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.quicSupported, true);
  assert.ok(data.protocols.includes('webtransport-quic'));
});

test('diagnoses stack traces with AI Copilot endpoint', async () => {
  const response = await fetch(`${baseUrl}/api/copilot/diagnose`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ log: "Error: Cannot find module 'express'" })
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.errorType, 'NodeModuleNotFound');
  assert.match(data.suggestedCommand, /npm install express/);
});

test('reports host system capabilities via /api/host/capabilities', async () => {
  const response = await fetch(`${baseUrl}/api/host/capabilities`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.os);
  assert.ok(data.platform);
});

test('accepts remote input events via /api/host/input', async () => {
  const response = await fetch(`${baseUrl}/api/host/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'mouse', action: 'move', x: 0.5, y: 0.5 })
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
});

test('exposes Delete in the mobile remote-control toolbar', async () => {
  const response = await fetch(baseUrl);
  const html = await response.text();
  assert.match(html, /class="mob-btn mob-key" data-key="Delete"/);
});

test('forwards Delete modifiers to the native Windows bridge', async () => {
  const appResponse = await fetch(`${baseUrl}/app.js`);
  const appSource = await appResponse.text();
  assert.match(appSource, /shift: e\.shiftKey/);
  assert.match(appSource, /special: message\.special,[\s\S]*shift: message\.shift/);

  const bridgeSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'input-bridge.ps1'), 'utf8');
  assert.match(bridgeSource, /"delete"\s+\{ Send-VirtualKey 0x2E \$true \$ctrl \$shift \$alt \$meta \}/);
});
