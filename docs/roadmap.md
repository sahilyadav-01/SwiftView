# 26-Phase Delivery Roadmap

Each phase has an objective and an exit gate. Calendar duration depends on team size; gates matter more than nominal weeks.

| Phase | Deliverable | Exit gate |
|---:|---|---|
| 1 | Repository conventions, ownership, CI, formatting, test policy | Clean checkout builds and tests on Windows and Linux CI |
| 2 | Product requirements and authorized-use boundary | Scope, non-goals, consent, and retention are approved |
| 3 | PostgreSQL schema and migrations | Fresh install and forward migration tests pass |
| 4 | Organization, user, role, and assignment model | Cross-tenant negative authorization tests pass |
| 5 | Login, MFA, token rotation, logout, lockout | Credential/replay abuse tests pass |
| 6 | Device enrollment and asymmetric identity | Single-use enrollment and device revocation demonstrated |
| 7 | Agent heartbeat and durable presence model | Online/offline transitions survive API restarts |
| 8 | Technician device inventory and search | Only authorized devices appear; pagination is stable |
| 9 | Session request state machine | Invalid and duplicate transitions fail closed |
| 10 | Consent UI and permission grants | Local user can inspect, allow, restrict, or reject |
| 11 | Versioned authenticated signaling | Unauthorized offers/candidates are rejected and audited |
| 12 | Windows service/UI separation and authenticated IPC | UI compromise cannot directly invoke unrestricted privileged actions |
| 13 | DXGI capture with monitor enumeration | Stable capture across resize, lock/unlock, and monitor changes |
| 14 | H.264 software encode/decode pipeline | Continuous 1080p session meets baseline CPU and latency targets |
| 15 | Hardware encoder adapters and fallback | NVENC/Quick Sync/AMF failures fall back without unauthorized restart |
| 16 | WebRTC media transport and rendering | Direct LAN session is stable for a two-hour soak |
| 17 | Native mouse/keyboard using SendInput | Key transitions, modifiers, layouts, drag, and scroll pass fixtures |
| 18 | ICE/TURN fallback and relay selection | Restricted-NAT test matrix connects through an authorized relay |
| 19 | Reconnect, timeout, and connection-quality UI | Network interruption respects grace and authorization expiry |
| 20 | Multi-monitor, scaling, and fullscreen | Monitor switching and DPI tests pass on supported Windows versions |
| 21 | Clipboard synchronization | Separate permission, limits, loop prevention, and audit pass |
| 22 | File transfer protocol | Resume, cancel, quotas, path constraints, and SHA-256 tests pass |
| 23 | Unattended access policy and MFA controls | No unattended session can bypass assignment, role, or device policy |
| 24 | Admin, audit, reports, notifications, relay health | Incident-relevant actions are searchable and externally exportable |
| 25 | Signed installer, service lifecycle, and signed updater | Install/update/rollback/silent deployment test matrix passes |
| 26 | Production hardening and pilot | Pen test, restore drill, failure drills, support runbooks, and pilot sign-off complete |

## MVP milestone

The MVP is complete after phase 19 and includes identity, device inventory, consent, screen viewing, native mouse/keyboard, direct/relay transport, reconnect, and audit. Clipboard, file transfer, unattended access, and automatic updates remain disabled until their individual gates pass.

## Workstream dependencies

```text
Identity (3–6) ──> Presence (7–8) ──> Authorization (9–11)
                                            │
Native foundation (12) ──> Capture (13–15) ├──> Session MVP (16–19)
                                            │
                                            └──> Extended features (20–25)
                                                           │
                                                           └──> Production (26)
```

## Definition of done for every phase

- Acceptance criteria are automated where practical.
- Security and privacy effects are documented.
- Logs and metrics support diagnosis without leaking protected content.
- Upgrade and rollback behavior are defined.
- User-facing failure states are understandable.
- API/protocol changes are versioned and reflected in the specifications.
- No feature is enabled by default before its authorization and audit paths exist.

