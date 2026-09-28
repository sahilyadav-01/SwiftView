//! Persistent WebSocket signaling for the native SwiftView host.

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_tungstenite::{connect_async, tungstenite::Message};

pub struct SignalingClient {
    pub server_url: String,
    pub device_id: String,
    pub unattended: bool,
}

impl SignalingClient {
    pub fn new(server_url: String, device_id: String, unattended: bool) -> Self {
        Self {
            server_url,
            device_id,
            unattended,
        }
    }

    pub fn format_id(id: &str) -> String {
        let digits: String = id.chars().filter(|c| c.is_ascii_digit()).collect();
        if digits.len() == 9 {
            format!("{} {} {}", &digits[0..3], &digits[3..6], &digits[6..9])
        } else {
            digits
        }
    }

    pub async fn run(&self) -> Result<()> {
        let mut retry_delay = Duration::from_secs(1);
        loop {
            match self.run_connection().await {
                Ok(()) => tracing::warn!("Signaling connection closed"),
                Err(error) => tracing::warn!("Signaling connection failed: {error:#}"),
            }
            tracing::info!("Reconnecting in {} second(s)...", retry_delay.as_secs());
            tokio::time::sleep(retry_delay).await;
            retry_delay = (retry_delay * 2).min(Duration::from_secs(30));
        }
    }

    async fn run_connection(&self) -> Result<()> {
        let (socket, _) = connect_async(&self.server_url)
            .await
            .with_context(|| format!("could not connect to {}", self.server_url))?;
        let (mut writer, mut reader) = socket.split();

        writer.send(Message::Text(json!({
            "type": "host",
            "code": self.device_id,
            "meta": {
                "name": std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Windows PC".into()),
                "os": "Windows native agent",
                "native": true,
                "screenCapable": cfg!(windows),
                "inputCapable": cfg!(windows)
            }
        }).to_string())).await?;

        while let Some(message) = reader.next().await {
            let message = message?;
            if !message.is_text() {
                continue;
            }
            let payload: Value = serde_json::from_str(message.to_text()?)?;
            match payload.get("type").and_then(Value::as_str) {
                Some("registered") => {
                    tracing::info!("Native host registered and ready for connections");
                }
                Some("peer-request") => {
                    let approved = self.unattended || request_local_approval().await?;
                    let response = if approved { "approve" } else { "reject" };
                    writer
                        .send(Message::Text(json!({ "type": response }).to_string()))
                        .await?;
                    tracing::info!(
                        "Viewer request {}",
                        if approved { "approved" } else { "rejected" }
                    );
                }
                Some("peer-left") => tracing::info!("Viewer disconnected"),
                Some("error") => {
                    let detail = payload
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown error");
                    anyhow::bail!("signaling server rejected the agent: {detail}");
                }
                Some(kind) => tracing::debug!("Received signaling message: {kind}"),
                None => tracing::warn!("Received malformed signaling message"),
            }
        }
        Ok(())
    }
}

async fn request_local_approval() -> Result<bool> {
    tracing::warn!("Incoming viewer request. Type 'y' and press Enter to approve:");
    let mut answer = String::new();
    BufReader::new(tokio::io::stdin())
        .read_line(&mut answer)
        .await?;
    Ok(matches!(
        answer.trim().to_ascii_lowercase().as_str(),
        "y" | "yes"
    ))
}
