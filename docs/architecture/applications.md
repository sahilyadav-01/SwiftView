# Application Structure

## Desktop client

Recommended shell: Tauri with a React UI and Rust native modules.

```text
apps/desktop-client/
├── src/                         # React UI
│   ├── pages/Home.tsx
│   ├── pages/IncomingRequest.tsx
│   ├── pages/ActiveSession.tsx
│   ├── pages/UnattendedAccess.tsx
│   └── components/PermissionList.tsx
├── src-tauri/
│   ├── src/main.rs
│   ├── src/ipc.rs
│   └── capabilities/
└── package.json

agent/
└── src/
    ├── identity.rs
    ├── signaling.rs
    ├── policy.rs
    ├── capture/
    ├── encode/
    ├── transport/
    ├── input/
    ├── clipboard/
    ├── file_transfer/
    ├── audit.rs
    └── updater.rs
```

The UI process never receives the device private key. The service never decides consent by interpreting arbitrary UI text; it accepts only authenticated, typed IPC messages.

## Technician dashboard

```text
apps/technician-dashboard/src/
├── routes/
│   ├── login/
│   ├── devices/
│   ├── devices/[id]/
│   ├── sessions/
│   └── session/[id]/
├── features/
│   ├── auth/
│   ├── device-search/
│   ├── session-request/
│   ├── remote-canvas/
│   ├── clipboard/
│   └── file-transfer/
├── api/                         # Generated OpenAPI client
└── protocol/                    # Generated WebSocket types
```

Primary pages:

1. Login and MFA.
2. Device inventory with assignment, status, version, and last seen.
3. Device detail with policy, capabilities, and session history.
4. Permission-aware session request.
5. Remote session with screen, metrics, monitor, clipboard, and file panels.
6. Technician session history and audit details.

## Admin panel

```text
apps/admin-panel/src/routes/
├── overview/
├── users/
├── roles/
├── devices/
├── groups/
├── policies/
├── sessions/
├── audit/
├── relays/
├── agent-releases/
└── organization/
```

Destructive administration actions require re-authentication, a reason, and an audit event. Bulk changes display the resolved target count before confirmation.

## Backend service boundaries

Start as a modular monolith plus separate signaling/relay processes. Split services only when scaling or isolation requires it.

```text
services/api/src/modules/
├── auth/
├── organizations/
├── users/
├── devices/
├── policy/
├── sessions/
├── files/
├── audit/
├── notifications/
└── agent-releases/
```

The API owns durable state. Signaling consumes authorization decisions and emits lifecycle facts; it does not duplicate the authorization model.

## Shared contracts

OpenAPI and JSON Schema are the sources of truth. CI generates TypeScript and Rust types and fails on uncommitted generated changes. Every protocol change includes compatibility notes and at least one cross-language fixture.

