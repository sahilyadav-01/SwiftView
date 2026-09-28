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

- Responsive dark/light desktop dashboard with Zero-Install Web Admin Fleet view
- Real-time Remote Dev Shell over WebRTC `RTCDataChannel` (`swift-channel`)
- Interactive in-session mode switcher: Fullscreen Video, Dev Shell, Split View (Video + Terminal), and System Diagnostics
- **Dirty Rectangle Canvas Streaming:** Sub-frame tile-diffing canvas overlay highlighting damaged screen areas with up to 95%+ bandwidth reduction
- **AI Terminal Copilot & Error Diagnosis:** Natural language command suggestions and automatic stack trace root-cause analysis with one-click remediation
- **WebTransport / QUIC Multiplexing Gateway:** Protocol negotiation supporting reliable streams for command execution alongside unreliable datagrams for video tiles
- Built-in host command interpreter (`sysinfo`, `top`/`ps`, `ping`, `uptime`, `logs`, `speedtest`, `eval`, `date`, `echo`) with command buffering
- Multi-node Fleet Manager with live discovery (`/api/fleet`), latency telemetry (RTT), and node registration
- Validated 9-digit device IDs with clipboard support
- Recent device history persisted in local storage
- Real screen capture, WebSocket signaling, and WebRTC video/audio
- Fullscreen remote viewing with disconnect handling
- Online/availability state and keyboard shortcut (`Ctrl+K`)
- Zero production dependencies and `/api/health`, `/api/fleet`, `/api/transport`, `/api/copilot/diagnose` endpoints

## Architecture path

Both devices must reach this Node server. Internet deployment requires HTTPS/WSS and a TURN server. Browsers intentionally prohibit system-wide input injection; remote mouse and keyboard control alongside zero-copy hardware screen capture is provided by the native Rust daemon in [`agent/`](file:///c:/Users/sahil%20yadav/Desktop/SwiftView/agent/README.md).

## Internet deployment

Deploy the included `Dockerfile` (or `render.yaml`) to a host that provides a public HTTPS URL. Configure `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL` using credentials from a TURN service or your own Coturn instance. HTTPS enables browser screen capture; TURN relays WebRTC when direct NAT traversal fails. Never commit TURN credentials—use deployment environment variables.
