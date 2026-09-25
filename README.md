# SwiftView

A working browser-based remote desktop viewing MVP. A host shares a screen, sends its nine-digit ID to a viewer, and SwiftView negotiates an encrypted peer-to-peer WebRTC media channel through the included signaling server.

## Run locally

```powershell
node server.js
```

Open [http://localhost:4173](http://localhost:4173).

## Test

```powershell
node --test
```

## Included

- Responsive dark/light desktop dashboard
- Validated 9-digit device IDs with clipboard support
- Recent device history persisted in local storage
- Real screen capture, WebSocket signaling, and WebRTC video/audio
- Fullscreen remote viewing with disconnect handling
- Online/availability state and keyboard shortcut (`Ctrl+K`)
- Zero production dependencies and a health endpoint

## Architecture path

Both devices must reach this Node server. Internet deployment requires HTTPS/WSS and a TURN server. Browsers intentionally prohibit system-wide input injection; remote mouse and keyboard control requires the planned signed Rust/Tauri desktop agent with explicit host consent.

## Internet deployment

Deploy the included `Dockerfile` (or `render.yaml`) to a host that provides a public HTTPS URL. Configure `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL` using credentials from a TURN service or your own Coturn instance. HTTPS enables browser screen capture; TURN relays WebRTC when direct NAT traversal fails. Never commit TURN credentials—use deployment environment variables.
