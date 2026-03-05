use serde::{Deserialize, Serialize};

use crate::replay::audit_log::AuditLog;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayResult {
    pub entry_count: usize,
    pub hash: String,
}

pub struct Replayer;

impl Replayer {
    pub fn replay(log: &AuditLog, seed: u64) -> ReplayResult {
        let mut copy = log.clone();
        copy.entries.sort_by_key(|e| e.tick);
        for e in &mut copy.entries {
            e.seed = seed;
        }
        ReplayResult {
            entry_count: copy.entries.len(),
            hash: copy.timeline_hash(),
        }
    }

    pub fn determinism_ratio(log: &AuditLog, seed: u64, runs: usize) -> f64 {
        if runs == 0 {
            return 0.0;
        }
        let baseline = Self::replay(log, seed).hash;
        let mut matches = 0usize;
        for _ in 0..runs {
            let hash = Self::replay(log, seed).hash;
            if hash == baseline {
                matches += 1;
            }
        }
        matches as f64 / runs as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pedagogy::risk_model::{
        ActionEvent, ActionMetadata, ConsequenceEvent, ConsequenceLevel,
    };
    use crate::replay::audit_log::{AuditLog, AuditLogEntry};

    fn entry(tick: u64) -> AuditLogEntry {
        AuditLogEntry {
            tick,
            wall_timestamp_ms: None,
            seed: 7,
            action: ActionEvent {
                tool: "multimeter".into(),
                setting: None,
                target: "vbat".into(),
                at_tick: tick,
                metadata: ActionMetadata::default(),
            },
            consequence: ConsequenceEvent {
                level: ConsequenceLevel::Safe,
                reason_code: "SAFE_BASELINE".into(),
                description: "ok".into(),
                probability: 0.0,
                applied_state_delta_summary: "none".into(),
            },
            state_delta_hash: format!("h{}", tick),
            notes: None,
        }
    }

    #[test]
    fn same_seed_same_hash() {
        let mut log = AuditLog::default();
        log.append(entry(2));
        log.append(entry(1));

        let a = Replayer::replay(&log, 99).hash;
        let b = Replayer::replay(&log, 99).hash;
        assert_eq!(a, b);
        assert!(Replayer::determinism_ratio(&log, 99, 100) >= 0.99);
    }
}
