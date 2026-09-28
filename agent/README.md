# SwiftView Native Agent Daemon (`swiftview-agent`)

A native desktop host for **SwiftView**, written in Rust by **Sahil Yadav**.

## Current implementation status

The native host foundation is operational: it keeps a stable nine-digit device ID, connects to the SwiftView WebSocket signaling service, registers as an available host, reconnects with exponential backoff, and locally approves or rejects viewer requests. The DXGI capture, hardware encoder, WebRTC media transport, native input, clipboard, and file-transfer modules are the next roadmap milestones.

---

## Architecture targets

- **Zero-Copy Frame Capture:** Uses the Windows DXGI Desktop Duplication API (`IDXGIOutputDuplication`) directly on Direct3D 11 devices, eliminating the CPU copy latency inherent in browser-based `getDisplayMedia()`.
- **Prioritized UDP Transport:** Direct P2P UDP media streams (`webrtc-rs`) that bypass TCP head-of-line blocking under packet loss.
- **Adaptive Network Controller (ANC):** Real-time bitrate and framerate scaling:
  - **Tier 1 (Ultra):** 60 FPS @ 3.2 Mbps (< 50ms latency, Fiber/5G)
  - **Tier 2 (Balanced):** 30 FPS @ 1.4 Mbps (4G/5G mobile)
  - **Tier 3 (Edge Mobile):** 15 FPS @ 380 Kbps (Highway bus / edge networks with packet drop)
- **Zero GC Jitter:** Deterministic microsecond execution preventing frame micro-stutters.

---

## Prerequisites & Installation

To build and run the native agent on Windows:

1. **Install Rust & Cargo:**
   Download and install the official Rust toolchain via [rustup.rs](https://rustup.rs/):
   ```powershell
   winget install Rustlang.Rustup
   # or run the rustup-init.exe installer
   ```
   Verify installation:
   ```powershell
   rustc --version
   cargo --version
   ```

2. **C++ Build Tools:**
   Ensure the **Desktop development with C++** workload is installed from Visual Studio Installer (needed for Windows DXGI SDK headers).

---

## Building

```powershell
cd agent
cargo build --release
```

The optimized binary is compiled to `agent/target/release/swiftview-agent.exe`.

---

## Running the Agent

Start your local SwiftView signaling server:
```powershell
node server.js
```

In another terminal, run the native agent daemon:
```powershell
# Connect with a stable, automatically generated 9-digit device ID:
cargo run --release

# Or specify a custom ID and signaling URL:
cargo run --release -- --id 847291635 --server ws://localhost:4173/signal

# Explicitly enable unattended approval (disabled by default):
cargo run --release -- --unattended
```

Without `--unattended`, each incoming connection must be approved locally by typing `y`. Unattended mode currently controls approval only; password authentication will be added before production unattended access is considered complete.

Open [http://localhost:4173](http://localhost:4173) to confirm that the native device appears online. Browser-to-native video is not enabled yet while the capture and WebRTC milestones are under development.
