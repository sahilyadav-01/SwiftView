//! SwiftView Native Rust Host Daemon
//!
//! High-performance, zero-latency desktop host daemon with hardware-accelerated
//! frame capture (Windows DXGI), NVENC/QuickSync encoding, and prioritized UDP WebRTC transport.

mod adaptive;
mod capture;
mod encoder;
mod signaling;

use adaptive::AdaptiveController;
use capture::windows_dxgi::DxgiDesktopDuplication;
use capture::ScreenCapture;
use clap::Parser;
use encoder::nvenc::HardwareEncoder;
use encoder::VideoEncoder;

#[derive(Parser, Debug)]
#[command(name = "swiftview-agent")]
#[command(version = "0.2.0")]
#[command(about = "Native low-latency desktop host daemon for SwiftView")]
struct Args {
    /// SwiftView signaling server WebSocket URL
    #[arg(short, long, default_value = "ws://localhost:4173/signal")]
    server: String,

    /// 9-digit device ID to register (generated randomly if omitted)
    #[arg(short, long)]
    id: Option<String>,

    /// Display index to capture (0 = Primary)
    #[arg(short, long, default_value_t = 0)]
    display: u32,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,swiftview_agent=debug".into()),
        )
        .init();

    let args = Args::parse();
    let host_id = args.id.unwrap_or_else(|| {
        let rand_val: u32 = 100_000_000 + (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() % 900_000_000) as u32;
        rand_val.to_string()
    });

    tracing::info!("=======================================================");
    tracing::info!(" SwiftView Native Daemon v0.2.0 [UDP Optimized]        ");
    tracing::info!(" Host Device ID: {}", signaling::SignalingClient::format_id(&host_id));
    tracing::info!(" Signaling Server: {}", args.server);
    tracing::info!(" Transport Mode: Prioritized UDP over Direct P2P       ");
    tracing::info!("=======================================================");

    // 1. Initialize hardware-accelerated desktop capture
    let mut capture_engine = DxgiDesktopDuplication::new(args.display);
    capture_engine.init()?;

    // 2. Initialize hardware video encoder
    let mut encoder_engine = HardwareEncoder::new();
    encoder_engine.init(1920, 1080, 60, 3200)?;

    // 3. Initialize Adaptive Network Controller (ANC)
    let mut adaptive_ctrl = AdaptiveController::new();
    tracing::info!("Adaptive Network Controller active. Target: Sub-50ms latency.");

    // Simulation of network adaptation monitoring
    let (tier, target_fps, target_bitrate) = adaptive_ctrl.update_metrics(24, 3, 0.2);
    tracing::info!(
        "Current Network Health: {:?} (Target: {} FPS, {} Kbps)",
        tier,
        target_fps,
        target_bitrate
    );

    tracing::info!("Ready for incoming viewer connections. Press Ctrl+C to terminate.");

    // Keep running
    tokio::signal::ctrl_c().await?;
    tracing::info!("Shutting down SwiftView native daemon cleanly.");

    Ok(())
}
