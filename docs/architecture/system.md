# System Architecture

## Trust boundaries

```text
Technician UI                     Managed device
     │                                  │
     │ HTTPS/WSS                        │ mTLS/WSS
     ▼                                  ▼
┌──────────────────────────────────────────────┐
│ Public edge: TLS termination, WAF, rate limit│
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ API/control  │  │ Signaling    │  │ TURN relay   │
│ plane        │  │ presence/SDP │  │ media/data   │
└──────┬───────┘  └──────┬───────┘  └──────────────┘
       │                 │
       ├─────────┬───────┘
       ▼         ▼
  PostgreSQL    Redis
```

The control plane decides whether a session may exist. Signaling exchanges only authorized negotiation messages. Media, input, clipboard, and file data use an end-to-end protected session transport; TURN relays packets but does not grant authorization.

## Components

| Component | Responsibility | Must not do |
|---|---|---|
| Desktop client | Consent UI, rendering, technician controls | Store reusable plaintext secrets |
| Native agent | Capture, encode, transport, input, file sandbox | Authorize technicians by itself |
| API | Identity, devices, policy, sessions, audit | Carry video frames |
| Signaling | Presence, offers/answers/candidates, reconnect | Treat a device ID as authentication |
| TURN | Relay WebRTC packets when direct fails | Access application credentials |
| PostgreSQL | Durable business and audit data | Track high-frequency presence |
| Redis | Presence, rate limits, short-lived challenges | Be the sole durable system of record |

## Session sequence

```text
Technician       API       Signaling       Agent       User
    │ login       │            │             │          │
    ├────────────>│            │             │          │
    │ list device │            │             │          │
    ├────────────>│            │             │          │
    │ request session          │             │          │
    ├────────────>│ authorize  │             │          │
    │             ├───────────>│ request     │          │
    │             │            ├────────────>│ prompt   │
    │             │            │             ├─────────>│
    │             │            │             │ approve  │
    │             │            │<────────────┤<─────────┤
    │ session token            │             │          │
    │<────────────┤            │             │          │
    │ SDP/ICE with token        │             │          │
    ├─────────────────────────>│────────────>│          │
    │<================ direct WebRTC or TURN ===========>│
```

1. The API verifies tenant membership, role, device policy, rate limits, and requested permissions.
2. The API creates a pending session and a nonce-bound request.
3. The agent shows technician identity, organization, and requested permissions.
4. Approval causes the API to mint short-lived, audience-bound session credentials for both peers.
5. Signaling accepts only messages tied to that session and participant.
6. Each peer derives per-session transport keys and confirms the transcript.
7. Session start, permission changes, route changes, reconnects, and end are audited.

## Native Windows agent modules

```text
agent-core
├── identity       device key, registration, rotation
├── policy         locally cached signed policy
├── signaling      presence and negotiation
├── capture        DXGI Desktop Duplication
├── encode         Media Foundation / hardware adapters
├── transport      WebRTC media and reliable data channels
├── input          SendInput-based mouse/keyboard injection
├── clipboard      permission-gated synchronization
├── file-transfer  sandboxed chunk protocol and hashes
├── consent-ui     attended approval and active-session indicator
├── audit          local delivery queue
└── updater        signature verification and rollback
```

The privileged Windows service owns capture/input primitives. A lower-privilege UI process displays consent and status. IPC messages are authenticated and schema validated.

## Connection strategy

1. Gather host and server-reflexive ICE candidates.
2. Attempt direct UDP within a bounded window.
3. Prefer a healthy direct candidate pair.
4. Fall back to the lowest-latency authorized TURN region.
5. On route failure, perform ICE restart within the existing authorized session.
6. End the session when the reconnect grace period or authorization expiry is reached.

## Data channels

| Channel | Delivery | Examples |
|---|---|---|
| `control.v1` | ordered/reliable | permission state, monitor selection, session close |
| `input.v1` | ordered, low-latency | keyboard and button transitions |
| `pointer.v1` | unordered, limited retransmit | pointer movement, wheel |
| `clipboard.v1` | ordered/reliable | bounded clipboard messages |
| `files.v1` | ordered/reliable | manifests, chunks, acknowledgements |
| `telemetry.v1` | unordered | RTT, loss, bitrate, encoder state |

Every message carries protocol version, session ID, sequence number, timestamp, and type. Unknown versions fail closed.

## Deployment stages

- **Local development:** API prototype, PostgreSQL, Redis, and optional TURN through Docker Compose.
- **Pilot:** one region, managed PostgreSQL/Redis, two API/signaling replicas, one TURN endpoint.
- **Production:** separate control and relay networks, regional TURN pools, durable audit export, automated backups, and monitored key rotation.

