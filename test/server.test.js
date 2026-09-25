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
  await new Promise((resolve) => host.once('message', resolve));
  const relayed = new Promise((resolve) => viewer.once('message', (data) => resolve(JSON.parse(data))));
  host.send(JSON.stringify({ type: 'signal', data: { candidate: 'test-candidate' } }));
  assert.deepEqual(await relayed, { type: 'signal', data: { candidate: 'test-candidate' } });
  host.close(); viewer.close();
});
