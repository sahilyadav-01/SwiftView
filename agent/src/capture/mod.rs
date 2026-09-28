pub mod windows_dxgi;

pub struct CapturedFrame {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
    pub timestamp_ms: u64,
}

pub trait ScreenCapture: Send + Sync {
    /// Initialize the capture pipeline (e.g. DXGI Output Duplication on Windows)
    fn init(&mut self) -> anyhow::Result<()>;

    /// Acquire the next desktop frame with sub-millisecond hardware copy
    fn acquire_frame(&mut self, timeout_ms: u32) -> anyhow::Result<Option<CapturedFrame>>;
}
