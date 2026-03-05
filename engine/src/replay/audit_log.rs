use serde::{Deserialize, Serialize};

use crate::pedagogy::risk_model::{ActionEvent, ConsequenceEvent};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuditLogEntry {
    pub tick: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wall_timestamp_ms: Option<u64>,
    pub seed: u64,
    pub action: ActionEvent,
    pub consequence: ConsequenceEvent,
    pub state_delta_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct AuditLog {
    pub entries: Vec<AuditLogEntry>,
}

impl AuditLog {
    pub fn append(&mut self, entry: AuditLogEntry) {
        self.entries.push(entry);
        self.entries.sort_by_key(|e| e.tick);
    }

    pub fn timeline_hash(&self) -> String {
        let mut h: u64 = 1469598103934665603;
        for e in &self.entries {
            h ^= e.tick;
            h = h.wrapping_mul(1099511628211);
            h ^= e.seed;
            h = h.wrapping_mul(1099511628211);
            for b in e.state_delta_hash.as_bytes() {
                h ^= *b as u64;
                h = h.wrapping_mul(1099511628211);
            }
            for b in e.consequence.reason_code.as_bytes() {
                h ^= *b as u64;
                h = h.wrapping_mul(1099511628211);
            }
        }
        format!("{:016x}", h)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionMetadata {
    pub scenario_id: String,
    pub use_case: String,
    pub seed: u64,
    pub duration_ticks: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RiskSummary {
    pub risky_actions_count: usize,
    pub secondary_damage_events: usize,
    pub misleading_measurements: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionReview {
    pub metadata: SessionMetadata,
    pub timeline: Vec<AuditLogEntry>,
    pub evidence_graph: crate::pedagogy::evidence_graph::EvidenceGraph,
    pub reasoning: crate::pedagogy::reasoning_score::ReasoningReview,
    pub risk_summary: RiskSummary,
}
