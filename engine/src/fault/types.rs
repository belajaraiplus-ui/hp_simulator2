use crate::state::ids::{FaultId, SystemTag};

#[derive(Clone)]
pub struct FaultTemplate {
    pub fault_id: FaultId,
    pub base_intensity: f64,
    pub activation_energy: f64,
    pub progression_rate: f64,
    pub affected_systems: Vec<SystemTag>,
    pub coupling: Vec<(FaultId, f64)>, // (target, strength)
}

#[derive(Clone)]
pub struct FaultInstance {
    pub intensity: f64, // kontinu
    pub active: bool,   // aktif ≠ terlihat
}

#[derive(Clone)]
pub struct Hypothesis {
    pub description: String,
    pub confidence: f64, // 0.0 – 1.0 (BUKAN probabilitas benar)
}

#[derive(Clone)]
pub struct AnalysisReport {
    pub hypotheses: Vec<Hypothesis>,
    pub data_quality: f64, // seberapa konsisten data (bisa menipu)
}
