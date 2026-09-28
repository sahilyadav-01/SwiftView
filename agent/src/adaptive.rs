//! Adaptive Network Controller (ANC) in Rust
//!
//! Monitors RTCP feedback, jitter, and packet loss to automatically scale
//! framerate and bitrate for spotty mobile networks.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkTier {
    Tier1Ultra,    // 60 FPS, 3200 Kbps (Fiber / 5G)
    Tier2Balanced, // 30 FPS, 1400 Kbps (4G / 5G)
    Tier3Edge,     // 15 FPS, 380 Kbps (Spotty Intercity Bus Route)
}

pub struct AdaptiveController {
    pub current_tier: NetworkTier,
    pub rtt_ms: u32,
    pub jitter_ms: u32,
    pub loss_percent: f32,
}

impl AdaptiveController {
    pub fn new() -> Self {
        Self {
            current_tier: NetworkTier::Tier1Ultra,
            rtt_ms: 20,
            jitter_ms: 2,
            loss_percent: 0.0,
        }
    }

    /// Update network metrics from inbound RTCP Receiver Reports
    pub fn update_metrics(
        &mut self,
        rtt_ms: u32,
        jitter_ms: u32,
        loss_percent: f32,
    ) -> (NetworkTier, u32, u32) {
        self.rtt_ms = rtt_ms;
        self.jitter_ms = jitter_ms;
        self.loss_percent = loss_percent;

        let new_tier = if rtt_ms > 95 || loss_percent > 3.5 || jitter_ms > 35 {
            NetworkTier::Tier3Edge
        } else if rtt_ms > 50 || loss_percent > 1.0 || jitter_ms > 18 {
            NetworkTier::Tier2Balanced
        } else {
            NetworkTier::Tier1Ultra
        };

        if new_tier != self.current_tier {
            tracing::info!(
                "Adaptive Controller state transition: {:?} -> {:?} (RTT: {}ms, Loss: {:.1}%, Jitter: {}ms)",
                self.current_tier,
                new_tier,
                rtt_ms,
                loss_percent,
                jitter_ms
            );
            self.current_tier = new_tier;
        }

        let (target_fps, target_bitrate_kbps) = match self.current_tier {
            NetworkTier::Tier1Ultra => (60, 3200),
            NetworkTier::Tier2Balanced => (30, 1400),
            NetworkTier::Tier3Edge => (15, 380),
        };

        (self.current_tier, target_fps, target_bitrate_kbps)
    }
}
