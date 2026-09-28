//! SwiftView Signaling Client
//!
//! Connects over WebSocket to the SwiftView signaling server to broker
//! peer registration and SDP offer/answers over prioritized UDP.

use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SignalingMessage {
    #[serde(rename = "host")]
    RegisterHost { code: String },

    #[serde(rename = "registered")]
    Registered,

    #[serde(rename = "peer-request")]
    PeerRequest,

    #[serde(rename = "approve")]
    Approve,

    #[serde(rename = "signal")]
    Signal { data: serde_json::Value },

    #[serde(rename = "error")]
    Error { message: String },
}

pub struct SignalingClient {
    pub server_url: String,
    pub device_id: String,
}

impl SignalingClient {
    pub fn new(server_url: String, device_id: String) -> Self {
        Self {
            server_url,
            device_id,
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
}
