# SwiftView

A working browser-based remote desktop viewing MVP. A host shares a screen, sends its nine-digit ID to a viewer, and SwiftView negotiates an encrypted peer-to-peer WebRTC media channel through the included signaling server.

**Author:** Sahil Yadav

## Run locally

```powershell
node server.js
```

Open [http://localhost:4173](http://localhost:4173).

For screen sharing from another device on the local network, open the HTTPS address shown by the server, for example:

```text
https://192.168.1.214:4173
```

The bundled certificate is self-signed, so the browser may ask you to accept a certificate warning. Screen capture requires a secure context (`https://` or `localhost`). Refresh SwiftView on both devices after restarting the server.

## Remote sharing

1. Run SwiftView on the Windows computer you want to share and control.
2. Open SwiftView over HTTPS and copy its nine-digit SwiftView ID.
3. Open the same SwiftView server from the viewer device.
4. Enter the host ID and request a connection.
5. On the host, approve the request and select the screen or window to share.
6. On the viewer, enable **Remote Control** to use the mouse and keyboard.

The native mouse and keyboard bridge controls the Windows computer running `server.js`. If the sharing browser runs on a different computer from the server, video can still be shared, but native input will target the server computer. Run the server on the host computer for complete remote control.

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
- Native Windows mouse, keyboard, scrolling, and touch-to-pointer control
- WebRTC DataChannel input with WebSocket fallback and duplicate-event prevention
- Online/availability state and keyboard shortcut (`Ctrl+K`)
- Zero production dependencies and `/api/health`, `/api/fleet`, `/api/transport`, `/api/copilot/diagnose` endpoints

## Architecture path

Both devices must reach this Node server. Internet deployment requires HTTPS/WSS and a TURN server. Browsers intentionally prohibit direct system-wide input injection. On Windows, SwiftView passes authorized remote-control events to the included PowerShell input bridge. The experimental native Rust capture and control agent is available in [`agent/`](agent/README.md).

### Native AnyDesk-alternative roadmap

- [x] Stable native device identity
- [x] Native signaling registration and automatic reconnect
- [x] Local connection approval and explicit unattended mode
- [ ] Real DXGI desktop frame capture
- [ ] H.264 hardware encoding with software fallback
- [ ] Native WebRTC host and viewer media transport
- [ ] Windows mouse and keyboard injection inside the native host
- [ ] Authenticated unattended-access credentials
- [ ] Clipboard synchronization and encrypted file transfer
- [ ] Windows service and signed installer

## Internet deployment

Deploy the included `Dockerfile` (or `render.yaml`) to a host that provides a public HTTPS URL. Configure `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL` using credentials from a TURN service or your own Coturn instance. HTTPS enables browser screen capture; TURN relays WebRTC when direct NAT traversal fails. Never commit TURN credentials—use deployment environment variables.
