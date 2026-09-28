# SwiftView Native Agent Daemon (`swiftview-agent`)

A high-performance, low-latency desktop host daemon for **SwiftView** written in **Rust**. It implements OS-level hardware-accelerated screen capture (Windows DXGI Desktop Duplication API), hardware video encoding (NVENC / QuickSync), and prioritized UDP transport over direct WebRTC peer-to-peer connections.

---

## Key Architectural Advantages

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
# Connect with an auto-generated 9-digit device ID:
cargo run --release

# Or specify a custom ID and signaling URL:
cargo run --release -- --id 847291635 --server ws://localhost:4173/signal
```

Now open [http://localhost:4173](http://localhost:4173) in any browser, enter the 9-digit ID, and experience hardware-accelerated direct UDP streaming!
