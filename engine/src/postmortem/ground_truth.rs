use crate::state::phone_state::*;
use crate::session::termination::TerminationReason;
use crate::state::ids::{FaultId, ThermalZoneId, RailId};

/// Catatan forensik akhir sesi.
/// TIDAK digunakan selama gameplay.
#[derive(Debug)]
pub struct GroundTruth {
    pub termination_reason: TerminationReason,

    /// Rantai sebab–akibat fault
    pub fault_chain: Vec<FaultRecord>,

    /// Jejak degradasi sistem
    pub degradation_timeline: Vec<DegradationRecord>,

    /// Pengukuran / tindakan berisiko
    pub critical_actions: Vec<ActionRecord>,
}

/// =======================
/// SUB-RECORDS
/// =======================

#[derive(Debug)]
pub struct FaultRecord {
    pub fault: FaultId,
    pub final_phase: String,
    pub final_intensity: f64,
}

#[derive(Debug)]
pub struct DegradationRecord {
    pub domain: String,
    pub magnitude: f64,
}

#[derive(Debug)]
pub struct ActionRecord {
    pub time: f64,
    pub action: String,
    pub consequence: String,
}

/// =======================
/// GROUND TRUTH BUILDER
/// =======================

pub struct GroundTruthBuilder;

impl GroundTruthBuilder {
    /// Dipanggil SEKALI saat sesi berakhir.
    pub fn build(
        state: &PhoneState,
        reason: TerminationReason,
    ) -> GroundTruth {
        // =======================
        // FAULT CHAIN
        // =======================
        let fault_chain = state.faults.active.iter().map(|(id, f)| {
            FaultRecord {
                fault: *id,
                final_phase: format!("{:?}", f.phase),
                final_intensity: f.intensity,
            }
        }).collect();

        // =======================
        // DEGRADATION TIMELINE (FINAL STATE)
        // =======================
        let mut degradation = Vec::new();

        degradation.push(DegradationRecord {
            domain: "electrical_stress".to_string(),
            magnitude: state.stress.electrical,
        });

        degradation.push(DegradationRecord {
            domain: "thermal_stress".to_string(),
            magnitude: state.stress.thermal,
        });

        degradation.push(DegradationRecord {
            domain: "measurement_stress".to_string(),
            magnitude: state.stress.measurement,
        });

        for (comp, v) in state.material.aging_map.iter() {
            degradation.push(DegradationRecord {
                domain: format!("material:{:?}", comp),
                magnitude: *v,
            });
        }

        // =======================
        // CRITICAL ACTIONS
        // =======================
        let critical_actions = state.measurements.history.iter()
            .filter(|m| m.injected_energy > 0.01)
            .map(|m| ActionRecord {
                time: m.time,
                action: m.target.clone(),
                consequence: "Energi disuntikkan melebihi observasi pasif".to_string(),
            })
            .collect();

        GroundTruth {
            termination_reason: reason,
            fault_chain,
            degradation_timeline: degradation,
            critical_actions,
        }
    }
}
