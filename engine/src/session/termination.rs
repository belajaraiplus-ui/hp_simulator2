use crate::state::phone_state::*;

/// Alasan berakhirnya sesi.
/// BUKAN penilaian benar/salah.
/// BUKAN diagnosis teknis.
#[derive(Debug, Clone)]
pub enum TerminationReason {
    /// Pemain secara sadar memilih berhenti
    VoluntaryStop,

    /// Sistem tidak lagi aman dijalankan (thermal / electrical runaway)
    ForcedShutdown,

    /// Kerusakan material melewati batas pemulihan
    IrreversibleDamage,

    /// Sistem tidak lagi dapat diobservasi secara bermakna
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
/// PURE FUNCTION — tidak memodifikasi state.
pub struct SessionTermination;

impl SessionTermination {
    pub fn evaluate(state: &PhoneState) -> SessionStatus {
        // =======================
        // ELECTRICAL INSTABILITY
        // =======================
        // Kombinasi stress + noise, bukan nilai rail langsung
        let electrical_unstable =
            state.stress.electrical > 5.0 &&
            state.electrical.transient_noise > 1.0;

        // =======================
        // THERMAL CRITICAL STATE
        // =======================
        // Batas keras fisik, zona apa pun
        let thermal_critical = state
            .thermal
            .zones
            .values()
            .any(|z| z.temperature > 120.0);

        // =======================
        // MATERIAL DEGRADATION
        // =======================
        // Kerusakan permanen, tidak bisa dipulihkan
        let material_failure = state
            .material
            .aging_map
            .values()
            .any(|v| *v > 1.5);

        // =======================
        // MEASUREMENT ABUSE
        // =======================
        // Over-probing yang meningkatkan stress sistemik
        let measurement_abuse =
            state.stress.measurement > 3.0 &&
            state.fatigue.counts.len() > 20;

        // =======================
        // OBSERVABILITY COLLAPSE (REFINED)
        // =======================
        // 1. Pemain memang sudah mencoba mengamati sistem
        let attempted_observation =
            state.measurements.history.len() > 8 &&
            state.stress.measurement > 1.5;

        // 2. Sistem tidak lagi memberi observasi bermakna
        let observability_degraded =
            state.last_voltage.is_empty() ||
            state.electrical.transient_noise > 2.0;

        // Collapse hanya sah jika ada niat + degradasi
        let observability_lost =
            attempted_observation && observability_degraded;

        // =======================
        // DECISION PRIORITY (DOCUMENTED)
        // =======================
        // Prioritas bersifat fisik → epistemik
        // 1. Kerusakan permanen
        // 2. Shutdown paksa (keselamatan sistem)
        // 3. Keruntuhan observabilitas / abuse
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
