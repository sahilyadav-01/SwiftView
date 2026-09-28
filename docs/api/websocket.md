# WebSocket Protocol v1

## Endpoints

- Technician: `wss://<control-plane>/api/v1/ws/technician`
- Agent: `wss://<control-plane>/api/v1/ws/agent`

Authentication occurs during the HTTP upgrade. Technician sockets use a short-lived user access token. Agent sockets use a device challenge signed by the registered device key. Tokens must not appear in URL query strings.

## Envelope

```json
{
  "v": 1,
  "id": "01K6...ULID",
  "type": "session.request",
  "sentAt": "2026-09-28T12:00:00.000Z",
  "sessionId": "5e5bb3d9-f460-4d9a-a23a-30e8c01d42ca",
  "payload": {}
}
```

`id` is unique per sender and supports acknowledgement and deduplication. `sessionId` is required for session-scoped messages. Receivers reject unsupported versions, invalid schemas, stale timestamps, and session messages from nonparticipants.

## Presence events

| Type | Direction | Payload |
|---|---|---|
| `device.hello` | agent → server | capabilities, agent version, nonce signature |
| `device.ready` | server → agent | device UUID, heartbeat interval, policy version |
| `device.heartbeat` | agent → server | monotonic uptime, active session ID, health |
| `device.policy.updated` | server → agent | signed policy document reference |
| `device.revoked` | server → agent | reason; agent disconnects and clears session credentials |

## Session lifecycle

| Type | Direction | Notes |
|---|---|---|
| `session.request` | server → agent | Technician identity and requested permissions |
| `session.accept` | agent → server | Consent proof and granted permission set |
| `session.reject` | agent → server | Stable reason code; no sensitive free text required |
| `session.authorized` | server → both | Role-specific single-use credential and expiry |
| `session.connecting` | peer → server | Transport negotiation started |
| `session.connected` | peer → server | Selected route and connection metrics |
| `session.permission.updated` | server → both | Monotonic permission version |
| `session.reconnecting` | peer → server | ICE restart within grace period |
| `session.end` | either → server | Explicit end request |
| `session.ended` | server → both | Final reason and audit correlation ID |

## Signaling events

`signal.offer`, `signal.answer`, and `signal.ice` are accepted only after `session.authorized`. The server validates participant role, message size, session status, expiry, and rate limits before relay.

```json
{
  "v": 1,
  "id": "01K6X4Q1KRY2A6V0YQ5ZQW1D4M",
  "type": "signal.ice",
  "sentAt": "2026-09-28T12:01:00.000Z",
  "sessionId": "5e5bb3d9-f460-4d9a-a23a-30e8c01d42ca",
  "payload": {
    "candidate": "candidate:...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

## Acknowledgement and errors

Commands that change durable state receive an acknowledgement:

```json
{
  "v": 1,
  "id": "01K6X4...",
  "type": "ack",
  "sentAt": "2026-09-28T12:01:01.000Z",
  "payload": { "messageId": "01K6X3..." }
}
```

Errors use stable codes such as `AUTH_REQUIRED`, `FORBIDDEN`, `SESSION_EXPIRED`, `DEVICE_OFFLINE`, `RATE_LIMITED`, `INVALID_MESSAGE`, and `UNSUPPORTED_VERSION`. Internal exception details are logged server-side and never returned to peers.

## Limits

- Maximum control message: 64 KiB.
- Heartbeat interval: server supplied, normally 20 seconds.
- Maximum signaling messages: 60 per participant per minute during negotiation.
- Session request expiry: 60 seconds.
- Authorization credential lifetime: 2 minutes to connect.
- Reconnect grace period: 30 seconds by default.
- Unknown or duplicate state transitions are rejected and audited.

## Compatibility

Additive payload fields are permitted within a protocol version. Removing or changing a field requires a new version. Agent capability negotiation determines whether clipboard, file transfer, codecs, and monitor switching can be offered.

