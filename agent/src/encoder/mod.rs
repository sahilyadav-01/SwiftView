pub mod nvenc;

use super::capture::CapturedFrame;
use anyhow::Result;

pub struct EncodedPacket {
    pub data: Vec<u8>,
    pub is_keyframe: bool,
    pub timestamp_ms: u64,
}

pub trait VideoEncoder: Send + Sync {
    /// Initialize hardware encoder (NVENC, Intel QuickSync, or Software fallback)
    fn init(&mut self, width: u32, height: u32, fps: u32, bitrate_kbps: u32) -> Result<()>;

    /// Dynamically adjust bitrate and framerate without restarting the encoder pipeline
    fn adjust_bitrate_and_fps(&mut self, bitrate_kbps: u32, fps: u32) -> Result<()>;

    /// Encode raw frame into compressed H.264 / AV1 NAL units
    fn encode(&mut self, frame: &CapturedFrame) -> Result<Vec<EncodedPacket>>;
}
