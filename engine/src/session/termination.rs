use crate::state::phone_state::*;
use crate::state::ids::ThermalZoneId;

/// Alasan berakhirnya sesi.
/// BUKAN penilaian benar/salah.
#[derive(Debug, Clone)]
pub enum TerminationReason {
    VoluntaryStop,
    ForcedShutdown,
    IrreversibleDamage,
    InstabilityCollapse,
}

/// Status sesi simulasi.
#[derive(Debug, Clone)]
pub struct SessionStatus {
    pub terminated: bool,
    pub reason: Option<TerminationReason>,
}

/// Evaluator termination.
/// Dipanggil SETIAP tick / setelah aksi berisiko.
pub struct SessionTermination;

impl SessionTermination {
    pub fn evaluate(state: &PhoneState) -> SessionStatus {
        // =======================
        // ELECTRICAL RUNAWAY
        // =======================
        let electrical_unstable =
            state.stress.electrical > 5.0 &&
            state.electrical.transient_noise > 1.0;

        // =======================
        // THERMAL RUNAWAY
        // =======================
        let thermal_critical = state.thermal.zones.values().any(|z| {
            z.temperature > 120.0
        });

        // =======================
        // MATERIAL DEGRADATION
        // =======================
        let material_failure = state.material.aging_map
            .values()
            .any(|v| *v > 1.5);

        // =======================
        // OBSERVABILITY COLLAPSE
        // =======================
        let observability_lost =
            state.last_voltage.len() == 0 &&
            state.measurements.history.len() > 10;

        // =======================
        // MEASUREMENT ABUSE
        // =======================
        let measurement_abuse =
            state.stress.measurement > 3.0 &&
            state.fatigue.counts.len() > 20;

        // =======================
        // DECISION TREE (NO SHORTCUT)
        // =======================

        if material_failure {
            return SessionStatus {
                terminated: true,
                reason: Some(TerminationReason::IrreversibleDamage),
            };
        }

        if thermal_critical || electrical_unstable {
            return SessionStatus {
                terminated: true,
                reason: Some(TerminationReason::ForcedShutdown),
            };
        }

        if observability_lost || measurement_abuse {
            return SessionStatus {
                terminated: true,
                reason: Some(TerminationReason::InstabilityCollapse),
            };
        }

        SessionStatus {
            terminated: false,
            reason: None,
        }
    }
}
