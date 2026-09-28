const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
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
