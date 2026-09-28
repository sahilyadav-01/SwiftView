# S'K Remote Support — Product Specification

Repository codename: **SwiftView**  
Initial target: **authorized Windows-to-Windows remote support**

## Product boundary

S'K Remote Support is a visible, consent-based remote-support product for managed business devices. It is not a hidden-access or surveillance tool. Attended sessions require an explicit local approval. Unattended access must be enabled by an administrator, bound to a device credential, restricted by policy, and recorded in the audit log.

## Current baseline

The repository currently contains:

- a Node.js HTTP/WebSocket signaling prototype;
- a browser dashboard and WebRTC screen-sharing client;
- Windows mouse and keyboard injection through a local PowerShell bridge;
- a Rust agent that persists a device ID, registers with signaling, reconnects, and prompts for local approval;
- a test suite for the prototype server.

The current nine-digit ID is discovery information, not authentication. Rooms and audit-like UI data are currently ephemeral. The native agent does not yet capture, encode, transport, or render the desktop.

## Version 1 outcome

A technician signs in, selects an authorized online Windows device, requests a session, receives user consent or authenticates through an approved unattended policy, and obtains a secure remote screen with mouse and keyboard control. Direct connectivity is attempted first and a managed relay is used when direct connectivity fails. Every authorization and session transition is auditable.

## Required capabilities

### Identity and tenancy

- Organizations, users, roles, teams, and device groups.
- OIDC-ready user authentication with short-lived access tokens and rotating refresh tokens.
- Argon2id password hashing when local credentials are enabled.
- Per-installation asymmetric device identity and revocation.
- Roles: super admin, organization admin, IT manager, technician, and viewer.

### Device management

- Human-readable device ID plus immutable internal UUID.
- Device registration, heartbeat, online/offline state, version, platform, and capabilities.
- Tags, groups, ownership, notes, policy assignment, and revocation.
- Signed agent releases and an explicit update channel.

### Sessions

- Attended request/accept/reject workflow.
- Optional policy-controlled unattended access.
- Permission grants for screen, mouse, keyboard, clipboard, file transfer, and restart.
- Short-lived, single-session authorization token.
- Direct WebRTC connection first; TURN relay fallback.
- Reconnect grace period, idle timeout, absolute timeout, and explicit termination.
- Connection quality and selected route visibility.

### Remote desktop

- Windows Desktop Duplication API capture.
- Dirty-region awareness and frame pacing.
- H.264 baseline target, with hardware encoding selected when available.
- Mouse movement, clicks, drag, wheel, keyboard, modifiers, shortcuts, and function keys.
- Fullscreen, fit/original scaling, monitor selection, and connection metrics.

### Clipboard and file transfer

- Disabled until separately granted for the session.
- Bidirectional clipboard with size and content-type limits.
- Chunked upload/download, pause/resume/cancel, quotas, and SHA-256 verification.
- File names normalized and destination paths constrained to an approved root.
- No silent overwrite; conflicts require an explicit policy or user choice.

### Operations

- Append-only audit events for authentication, policy, device, permission, and session actions.
- Metrics for API, signaling, relay, session quality, and agent versions.
- Structured logs with correlation IDs and secret redaction.
- Backups, restore tests, health endpoints, and documented incident response.

## Non-goals for version 1

- Hidden installation or hidden active sessions.
- Mobile hosting, macOS hosting, or Linux hosting.
- Kernel drivers, credential-screen bypass, or security-control bypass.
- Arbitrary remote shell access as a default technician permission.
- Recording session video by default.

## Success criteria

- A new Windows device can be installed, registered, approved, and visible in the dashboard.
- An authorized technician can establish an attended session across common home/office NATs.
- TURN fallback is automatic and clearly indicated.
- Revoking a device or user prevents new sessions within 60 seconds.
- Session permission changes take effect immediately and are audited.
- No session begins without a valid, unexpired server authorization.
- P95 control latency is below 150 ms on a healthy direct connection.
- Recovery from a short network interruption succeeds without starting an unauthorized new session.

## Repository target

```text
SwiftView/
├── apps/
│   ├── desktop-client/          # Tauri/React shell and user consent UI
│   ├── technician-dashboard/    # Technician web application
│   └── admin-panel/             # Organization administration
├── services/
│   ├── api/                     # Auth, devices, sessions, policy, audit
│   ├── signaling/               # Presence and session negotiation
│   ├── relay/                   # Managed relay integration/control
│   └── notification/            # Email/webhook/desktop notifications
├── agent/                       # Existing Rust native-agent foundation
├── packages/
│   ├── protocol/                # Versioned HTTP/WebSocket schemas
│   ├── shared-types/            # Generated TypeScript/Rust contracts
│   ├── crypto/                  # Identity and envelope primitives
│   └── ui/                      # Shared design system
├── infrastructure/
│   ├── docker-compose.yml
│   ├── coturn/
│   └── nginx/
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── database/
│   └── security/
├── public/                      # Existing browser prototype
├── server.js                    # Existing prototype control/signaling server
└── test/                        # Existing prototype tests
```

New services should be introduced alongside the prototype. The prototype is retired only after an equivalent tested production path exists.

