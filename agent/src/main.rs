//! SwiftView native Windows host.

mod adaptive;
mod capture;
mod encoder;
mod signaling;

use anyhow::{bail, Context, Result};
use clap::Parser;
use signaling::SignalingClient;
use std::{fs, path::PathBuf};

#[derive(Parser, Debug)]
#[command(
    name = "swiftview-agent",
    version,
    about = "Native SwiftView desktop host"
)]
struct Args {
    /// SwiftView signaling server WebSocket URL.
    #[arg(short, long, default_value = "ws://localhost:4173/signal")]
    server: String,

    /// Nine-digit device ID. A stable ID is generated and saved when omitted.
    #[arg(short, long)]
    id: Option<String>,

    /// Approve viewer requests without a local confirmation prompt.
    #[arg(long, default_value_t = false)]
    unattended: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,swiftview_agent=debug".into()),
        )
        .init();

    let args = Args::parse();
    let host_id = match args.id {
        Some(id) => validate_id(&id)?,
        None => load_or_create_device_id()?,
    };

    tracing::info!("SwiftView Native Host v{}", env!("CARGO_PKG_VERSION"));
    tracing::info!("Device ID: {}", SignalingClient::format_id(&host_id));
    tracing::info!("Signaling server: {}", args.server);
    tracing::info!(
        "Unattended access: {}",
        if args.unattended {
            "enabled"
        } else {
            "disabled"
        }
    );

    let client = SignalingClient::new(args.server, host_id, args.unattended);
    tokio::select! {
        result = client.run() => result?,
        result = tokio::signal::ctrl_c() => result.context("failed to install Ctrl+C handler")?,
    }

    tracing::info!("SwiftView native host stopped cleanly");
    Ok(())
}

fn validate_id(value: &str) -> Result<String> {
    let digits: String = value.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() != 9 {
        bail!("device ID must contain exactly nine digits");
    }
    Ok(digits)
}

fn load_or_create_device_id() -> Result<String> {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("SwiftView");
    let path = base.join("device-id");
    if path.exists() {
        return validate_id(fs::read_to_string(&path)?.trim());
    }

    fs::create_dir_all(&base)?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_nanos();
    let id = format!("{:09}", 100_000_000 + (nanos % 900_000_000));
    fs::write(&path, &id)
        .with_context(|| format!("could not save device ID to {}", path.display()))?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_formatted_device_id() {
        assert_eq!(validate_id("123 456 789").unwrap(), "123456789");
    }

    #[test]
    fn rejects_invalid_device_id() {
        assert!(validate_id("1234").is_err());
    }
}
