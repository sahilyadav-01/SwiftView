Yes. If you want to build your **own AnyDesk-style remote support software**, I would structure it as a complete product rather than just a remote-screen application.

A practical architecture is to use a **native remote-desktop client + your own authentication/device-management backend + ID/signaling server + relay server + admin dashboard**. This is broadly the architecture used by self-hosted solutions such as RustDesk, where an ID/rendezvous server handles discovery and a relay handles connections when direct P2P connectivity fails. ([RustDesk][1])

## 1. Product concept

**Working name:** `S'K Remote Support`

### Main applications

```text
S'K Remote Support
│
├── Windows Client
├── macOS Client
├── Linux Client
├── Android Client
│
├── Remote Support Server
│   ├── Authentication
│   ├── Device Management
│   ├── ID / Rendezvous
│   ├── Relay
│   ├── Session Management
│   └── Audit Logs
│
├── Admin Web Dashboard
│
└── API
```

The first production release should focus on **Windows-to-Windows remote support**. Add macOS/Linux/mobile after the Windows workflow is stable.

---

# 2. Core features

### Remote connection

* Device ID
* Connection request
* Accept/reject
* Remote screen
* Mouse control
* Keyboard control
* Full-screen mode
* Resolution scaling
* Multi-monitor support
* Clipboard
* File transfer
* Reconnect
* Session timeout
* Connection quality indicator

### Unattended access

For office/server support:

```text
Device
   ↓
Install Agent
   ↓
Generate Device ID
   ↓
Set access password
   ↓
Register with server
   ↓
Technician connects
   ↓
Authentication
   ↓
Remote session
```

Unattended access is an important part of an AnyDesk-style product; AnyDesk documents password-based unattended access and optional 2FA. ([AnyDesk][2])

---

# 3. Security architecture

This should be designed **security-first**, not added later.

```text
Technician
    │
    │ HTTPS / WSS
    ▼
API Gateway
    │
    ├── Authentication
    ├── Authorization
    ├── Device validation
    └── Session authorization
             │
             ▼
      Remote Connection
       │            │
       ▼            ▼
    P2P/direct     Relay
```

### Security features

* TLS
* Device authentication
* Short-lived session tokens
* Public/private key identity
* Password hashing
* 2FA
* Device approval
* Allowlist/blocklist
* Session permissions
* Clipboard permission
* File-transfer permission
* Keyboard/mouse permission
* Screen-view permission
* Audit logs
* Session expiry
* Brute-force protection
* Rate limiting
* Automatic logout
* Device revocation

AnyDesk itself documents controls such as ACLs, session logging, 2FA, permissions and encrypted transport, which are useful requirements to benchmark against. ([AnyDesk][3])

---

# 4. Recommended technology stack

## Desktop client

For the actual remote desktop engine:

**Rust + native OS APIs**

Why?

* High performance
* Low-level screen capture
* Efficient encoding
* Mouse/keyboard control
* Networking
* Cross-platform potential
* Better suitability than building the entire remote desktop engine in React/Electron

RustDesk's current architecture is also a useful reference: its client supports Windows, macOS, Linux, Android, iOS and Web and uses P2P/encrypted connections. ([RustDesk][4])

### UI

```text
Rust
├── Remote Desktop Engine
├── Network Engine
├── Input Engine
├── File Transfer
└── Security

React
└── Desktop UI
```

You can initially use:

**Tauri + React + Rust**

rather than Electron if you want a relatively lightweight desktop application.

---

# 5. Backend

I recommend:

```text
Backend
├── Node.js
├── TypeScript
├── NestJS
├── PostgreSQL
├── Redis
├── WebSocket
└── Docker
```

### Backend services

```text
auth-service
device-service
session-service
notification-service
audit-service
relay-service
admin-service
```

---

# 6. Database design

PostgreSQL:

```text
users
─────
id
name
email
password_hash
role
status
created_at

devices
───────
id
device_id
name
hostname
user_id
platform
os_version
agent_version
status
last_seen
created_at

device_credentials
───────────────────
id
device_id
credential_hash
created_at
expires_at

sessions
────────
id
device_id
technician_id
started_at
ended_at
status
ip_address

session_permissions
────────────────────
session_id
screen
keyboard
mouse
clipboard
file_transfer

audit_logs
──────────
id
user_id
device_id
session_id
action
ip_address
timestamp

files
─────
id
session_id
filename
size
hash
status
created_at
```

---

# 7. Device ID system

Every installed agent gets a unique ID.

Example:

```text
SK-482-917-263
```

But don't use the ID as the actual security credential.

Use:

```text
Device ID
     +
Device public key
     +
Server registration
     +
Session authentication
```

The ID is primarily an identifier.

---

# 8. Connection workflow

### Step 1

Technician enters:

```text
Remote ID

SK-482-917-263
```

### Step 2

Client asks your server:

```text
Where is SK-482-917-263?
```

### Step 3

Server responds with connection information.

### Step 4

Attempt:

```text
P2P
```

### Step 5

If P2P fails:

```text
Technician
    ↓
Relay Server
    ↓
Remote PC
```

This direct-first/relay-fallback architecture is documented by RustDesk: the rendezvous server helps establish the connection and the relay is used when direct connectivity fails. ([RustDesk][1])

---

# 9. Server architecture

For your first production deployment:

```text
                    Internet
                       │
                       ▼
                 Cloudflare
                       │
                       ▼
                 Nginx / Caddy
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
      API           WebSocket       Admin
        │              │
        └──────┬───────┘
               ▼
          Application
               │
       ┌───────┼────────┐
       ▼       ▼        ▼
 PostgreSQL   Redis    Relay
```

---

# 10. Relay server

The relay is critical.

```text
Client A
   │
   │ direct connection
   ▼
Client B
```

If direct connection doesn't work:

```text
Client A
   │
   ▼
Relay Server
   │
   ▼
Client B
```

For a geographically distributed product:

```text
India Relay
Singapore Relay
Europe Relay
US Relay
```

The connection manager can select the appropriate relay.

RustDesk documents multiple relay servers and geographic routing as a way to improve performance when relay connections are required. ([RustDesk][5])

---

# 11. Remote screen pipeline

This is the most technically important component.

```text
Remote PC
    │
    ▼
Screen Capture
    │
    ▼
Change Detection
    │
    ▼
Video Encoder
    │
    ▼
Compression
    │
    ▼
Encrypted Transport
    │
    ▼
Technician PC
    │
    ▼
Decoder
    │
    ▼
Screen Renderer
```

Don't continuously send the entire desktop.

Instead:

```text
Frame 1
████████████████

Frame 2
███ changed ███

Frame 3
       ██ changed
```

Send changed regions/frames where practical.

---

# 12. Codec strategy

Start with:

```text
H.264
```

Then evaluate:

```text
H.265
AV1
VP9
```

Hardware encoding should eventually be supported:

```text
NVIDIA NVENC
Intel Quick Sync
AMD AMF
Windows Media Foundation
```

RustDesk's documentation lists support for VP8/VP9/AV1 software codecs and H.264/H.265 hardware codecs, which is a useful reference point for the eventual feature set. ([RustDesk][6])

---

# 13. Input control

Remote mouse:

```text
Move
Click
Double click
Right click
Scroll
Drag
```

Keyboard:

```text
KeyDown
KeyUp
Shortcut
Ctrl
Alt
Shift
Win
Function keys
```

Architecture:

```text
Technician
   │
   ▼
Input Event
   │
   ▼
Encrypted Channel
   │
   ▼
Remote Agent
   │
   ▼
OS Input API
```

---

# 14. File transfer

Two directions:

```text
PC A
 ↓
Remote PC
```

and:

```text
Remote PC
 ↓
PC A
```

Include:

* Upload
* Download
* Folder transfer
* Progress
* Pause
* Resume
* Cancel
* SHA-256 verification
* Maximum file size
* Permission check

---

# 15. Technician dashboard

Your React dashboard could look like:

```text
┌───────────────────────────────────────────────┐
│ S'K Remote Support                            │
├─────────────┬─────────────────────────────────┤
│ Dashboard   │                                 │
│ Devices     │  Devices Online: 24             │
│ Sessions    │  Active Sessions: 5             │
│ Groups      │  Offline Devices: 8             │
│ Users       │                                 │
│ Reports     │  Recent Sessions                │
│ Settings    │                                 │
└─────────────┴─────────────────────────────────┘
```

---

# 16. Device dashboard

```text
Devices

Search: [________________]

ID            PC Name       Status     Action
------------------------------------------------
482917263     OFFICE-PC01   Online     Connect
482917264     SERVER01      Online     Connect
482917265     LAPTOP-04     Offline    Details
```

---

# 17. Remote session UI

```text
┌──────────────────────────────────────────────┐
│ SERVER01     Connected       32 ms           │
├──────────────────────────────────────────────┤
│                                              │
│                                              │
│             REMOTE DESKTOP                   │
│                                              │
│                                              │
├──────────────────────────────────────────────┤
│ Mouse | Keyboard | Files | Clipboard | View  │
└──────────────────────────────────────────────┘
```

---

# 18. Admin panel

Admin should control:

```text
Users
Devices
Groups
Sessions
Permissions
Security
Relay servers
API keys
Logs
Updates
```

### Roles

```text
Super Admin
Admin
IT Manager
Technician
Viewer
```

Example:

```text
Technician
 ├── View assigned devices
 ├── Start sessions
 ├── Transfer files
 └── View own session logs

Admin
 ├── Manage technicians
 ├── Manage devices
 ├── Manage groups
 └── View reports
```

---

# 19. Organization structure

For an IT-support company, make it multi-tenant from the beginning.

```text
Organization
     │
     ├── Departments
     │
     ├── Technicians
     │
     ├── Customers
     │
     └── Devices
```

Example:

```text
S'K One Tech Support
│
├── IT Support
│   ├── Sahil
│   ├── Technician 2
│   └── Technician 3
│
├── Retail
│   ├── PC-001
│   ├── PC-002
│   └── SERVER-01
│
└── Management
```

---

# 20. Session permissions

Before connection:

```text
Request permissions

☑ View screen
☑ Mouse
☑ Keyboard
☑ Clipboard
☐ File transfer
☐ Remote restart
☐ Shutdown
```

This gives your IT team granular control.

---

# 21. User consent

For attended support:

```text
Technician:
"Sahil wants to connect to your computer."

[Accept]

Permissions:
☑ View screen
☑ Mouse
☑ Keyboard
☐ File transfer

[Allow]
[Reject]
```

This should be extremely clear to the end user.

---

# 22. Unattended mode

For servers:

```text
Unattended Access

Device ID:
SK-482-917-263

Access:
● Enabled

Authentication:
☑ Device credential
☑ 2FA

Allowed technicians:
☑ Sahil
☑ IT Admin

[Save]
```

---

# 23. Audit system

Every important action should create an audit event.

Example:

```text
2026-09-28 16:52
Sahil
Connected to SERVER01

2026-09-28 16:53
Sahil
Clipboard enabled

2026-09-28 16:57
Sahil
File transferred:
printer-driver.zip

2026-09-28 17:03
Session ended
```

---

# 24. Notifications

Support:

```text
Desktop notification
Email
Webhook
```

Examples:

```text
New connection request
Device offline
Device online
Agent outdated
Security event
Session started
Session ended
```

---

# 25. Automatic agent update

Very important for production.

```text
Server
   │
   ├── Agent v1.0.0
   ├── Agent v1.1.0
   └── Agent v1.2.0
             │
             ▼
        Client checks
             │
             ▼
         New version?
          /       \
        Yes        No
        │           │
     Download      Continue
        │
     Verify
        │
     Install
```

Use signed binaries and verify signatures before installing updates.

---

# 26. Windows installer

Create:

```text
SKRemoteSetup.exe
```

Options:

```text
☑ Install for all users
☑ Start with Windows
☑ Install background service
☑ Create desktop shortcut
☑ Register device
☑ Enable unattended access
```

For IT deployment:

```text
SKRemoteSetup.exe /silent
```

---

# 27. Windows service

The remote agent should run as a Windows service.

Example:

```text
S K Remote Agent
        │
        ├── Network
        ├── Screen Capture
        ├── Input
        ├── Security
        ├── File Transfer
        └── Update
```

Keep the privileged service separate from the UI where possible.

---

# 28. API structure

Example:

```text
/api/v1/auth/login
/api/v1/auth/refresh

/api/v1/users
/api/v1/users/:id

/api/v1/devices
/api/v1/devices/:id
/api/v1/devices/:id/status

/api/v1/sessions
/api/v1/sessions/:id/start
/api/v1/sessions/:id/end

/api/v1/files/upload
/api/v1/files/download

/api/v1/audit
/api/v1/organizations

/api/v1/relays
/api/v1/agents
/api/v1/updates
```

---

# 29. WebSocket events

```text
device.online
device.offline

session.request
session.accept
session.reject

session.connected
session.disconnected

input.mouse
input.keyboard

file.started
file.progress
file.completed

clipboard.updated
```

---

# 30. Project repository

I recommend:

```text
sk-remote-support/
```

Structure:

```text
sk-remote-support/
│
├── apps/
│   ├── desktop-client/
│   ├── technician-dashboard/
│   └── admin-panel/
│
├── services/
│   ├── api/
│   ├── signaling/
│   ├── relay/
│   ├── auth/
│   └── notification/
│
├── packages/
│   ├── shared-types/
│   ├── crypto/
│   ├── protocol/
│   └── ui/
│
├── infrastructure/
│   ├── docker/
│   ├── nginx/
│   ├── postgres/
│   └── redis/
│
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── security/
│   └── deployment/
│
└── README.md
```

---

# 31. Development phases

## Phase 1 — Foundation

**Week 1–2**

```text
Repository
TypeScript
Rust
React
PostgreSQL
Docker
Authentication
User management
```

Deliverable:

```text
Login → Dashboard → API
```

---

## Phase 2 — Device Agent

**Week 3–5**

Build:

```text
Windows Agent
Device ID
Device registration
Heartbeat
Online/offline status
Background service
```

Deliverable:

```text
PC → Server → Dashboard
```

---

## Phase 3 — Remote Screen

**Week 6–9**

Build:

```text
Screen capture
Encoding
Transport
Decoder
Screen rendering
```

Deliverable:

```text
Technician PC
      ↓
Remote PC screen
```

---

## Phase 4 — Remote Control

**Week 10–11**

Add:

```text
Mouse
Keyboard
Scrolling
Multi-monitor
Resolution
Fullscreen
```

---

## Phase 5 — P2P + Relay

**Week 12–14**

Implement:

```text
NAT detection
Connection negotiation
P2P
Relay fallback
Connection recovery
```

This is one of the hardest parts of the project.

---

## Phase 6 — File Transfer

**Week 15–16**

```text
Upload
Download
Folder transfer
Resume
Checksum
Permissions
```

---

## Phase 7 — Security

**Week 17–18**

Implement:

```text
TLS
Device keys
2FA
RBAC
ACL
Session permissions
Audit logs
Rate limiting
Credential rotation
```

---

## Phase 8 — Admin Dashboard

**Week 19–20**

```text
Users
Devices
Groups
Technicians
Sessions
Reports
Security
Relay management
```

---

## Phase 9 — Installer + Updates

**Week 21–22**

```text
EXE installer
Windows service
Silent installation
Signed binaries
Auto-update
Uninstall
Rollback
```

---

## Phase 10 — Production

**Week 23–26**

Testing:

```text
NAT
Firewall
VPN
Slow network
High latency
Multiple monitors
4K display
Sleep/wake
UAC
RDP conflicts
Windows lock screen
Network disconnect
Relay failure
Server failure
```

---

# 32. MVP vs full product

### MVP

```text
✓ Windows client
✓ Device ID
✓ Authentication
✓ Screen sharing
✓ Mouse
✓ Keyboard
✓ P2P
✓ Relay
✓ File transfer
✓ Unattended access
✓ Basic dashboard
✓ Session logs
```

### Version 2

```text
✓ Multi-monitor
✓ Clipboard
✓ Chat
✓ Remote reboot
✓ Wake-on-LAN
✓ 2FA
✓ Device groups
✓ Technician roles
✓ Agent auto-update
✓ Better reporting
```

### Version 3

```text
✓ macOS
✓ Linux
✓ Android
✓ Web client
✓ Multi-tenant
✓ SSO
✓ LDAP
✓ Advanced analytics
✓ Regional relay infrastructure
✓ Enterprise policy management
```

---

# 33. Recommended deployment

For your first production environment:

```text
                    DOMAIN
                       │
                 remote.yourdomain
                       │
                       ▼
                  Cloudflare
                       │
                       ▼
                    Nginx
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
      API          Dashboard         Relay
       │                               │
       ▼                               │
 PostgreSQL                            │
       │                               │
       ▼                               │
     Redis                             │
       │                               │
       └──────────────┬────────────────┘
                      │
                 Remote Agents
```

Start with one VPS, then separate services as usage grows.

---

# 34. Important legal/security boundary

Don't design the product as a hidden remote-access tool.

The legitimate product should have:

* visible installation
* clear consent for attended sessions
* explicit unattended-access configuration
* strong authentication
* audit logging
* user-visible connection status
* uninstall capability
* signed updates
* administrator controls

That makes it appropriate for **IT support, company device management and authorized remote administration**.

---

# 35. The practical shortcut

If your main goal is **"I want my own AnyDesk for my IT support business"**, I would **not** start by writing the entire remote-desktop protocol from zero.

A much faster architecture is:

```text
RustDesk Remote Engine
          +
Your branded client
          +
Your own server
          +
Your React dashboard
          +
Your authentication
          +
Your device management
          +
Your support workflow
```

RustDesk explicitly supports self-hosting, custom clients and your own ID/relay infrastructure, so it is a useful technical foundation/reference for this approach. ([RustDesk][1])

Then your product becomes:

```text
             S'K REMOTE SUPPORT
                     │
       ┌─────────────┼─────────────┐
       ▼             ▼             ▼
   Technician      Customer      Admin
      App            App        Dashboard
       │              │             │
       └──────────────┼─────────────┘
                      ▼
                YOUR SERVER
                      │
             ┌────────┴────────┐
             ▼                 ▼
          ID/API             Relay
             │                 │
             └────────┬────────┘
                      ▼
                Remote PC
```

**This is the route I would use for a production-ready first version**, because implementing screen capture, codecs, NAT traversal, encrypted transport, input injection, relay routing and recovery completely from scratch is a substantially larger engineering project.

If you want, I can next turn this into the **actual GitHub project specification** with the exact folder structure, database schema, API contracts, Docker Compose, React dashboard pages, Rust/Tauri client structure, and a **Phase 1 → Phase 26 coding roadmap**.

[1]: https://rustdesk.com/docs/en/self-host/?utm_source=chatgpt.com "Self-host – RustDesk Documentation"
[2]: https://anydesk.com/en/features/unattended-access?utm_source=chatgpt.com "Unattended Access Remote Desktop Software | AnyDesk"
[3]: https://anydesk.com/en/security?utm_source=chatgpt.com "Safe Remote Desktop Solutions for Remote Access Security | AnyDesk"
[4]: https://rustdesk.com/docs/en/client/?utm_source=chatgpt.com "RustDesk Client – RustDesk Documentation"
[5]: https://rustdesk.com/docs/en/self-host/rustdesk-server-pro/relay/?utm_source=chatgpt.com "Configure Relay Servers – RustDesk Documentation"
[6]: https://rustdesk.com/docs/en/?utm_source=chatgpt.com "RustDesk Documentation"
