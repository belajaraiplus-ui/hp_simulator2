use crate::fault::model::*;
use crate::state::ids::FaultId;
use crate::state::phone_state::PhoneState;

/// =======================
/// FAULT ENGINE — FASE 10.1
/// Fault berkembang melalui waktu, panas, arus, dan stress.
/// BUKAN status.
/// =======================

pub fn step_faults(state: &mut PhoneState, dt: f64) {
    let avg_temp = state.thermal.average();
    let total_load = state.electrical.total_load();

    for fault in state.faults.active.values_mut() {
        // =======================
        // LOCAL STRESS ACCUMULATION
        // =======================

        let thermal_stress = avg_temp * fault.coupling.thermal;
        let electrical_stress = total_load * fault.coupling.electrical;

        fault.accumulated_stress += (thermal_stress + electrical_stress) * dt;

        // =======================
        // ESCALATION (continuous)
        // =======================

        fault.intensity += fault.escalation_rate * fault.accumulated_stress * dt;
        fault.intensity = clamp01(fault.intensity);

        // =======================
        // PHASE TRANSITION
        // =======================

        match fault.phase {
            FaultPhase::Soft => {
                if fault.intensity > SOFT_TO_PERSISTENT_THRESHOLD {
                    fault.phase = FaultPhase::Persistent;
                }
            }

            FaultPhase::Persistent => {
                if fault.intensity > PERSISTENT_TO_LATENT_THRESHOLD {
                    fault.phase = FaultPhase::Latent;
                }
            }

            FaultPhase::Latent => {
                // latent tetap hidup, tapi tidak naik phase lagi
            }
        }
    }
}

/// =======================
/// SECONDARY FAULT PROPAGATION
/// Persistent fault dapat memicu fault lain.
/// =======================

pub fn propagate_faults(state: &mut PhoneState) {
    // snapshot untuk menghindari mut borrow conflict
    let snapshot = state.faults.active.clone();

    for (id, fault) in snapshot {
        if fault.phase == FaultPhase::Persistent {
            let probability = fault.intensity * 0.05;

            // =======================
            // RNG WAJIB DARI PHONE_STATE
            // =======================

            if state.rng_hit(probability) {
                spawn_secondary_fault(state, id);

                // =======================
                // SYSTEM CONSEQUENCE
                // Propagasi fault TIDAK gratis
                // =======================

                state.stress.electrical += probability * 0.1;
                state.stress.thermal += probability * 0.05;
            }
        }
    }
}

/// =======================
/// HELPERS
/// =======================

fn spawn_secondary_fault(state: &mut PhoneState, source: FaultId) {
    // Pilih fault acak SELAIN source
    // (akan diganti coupling matrix di fase lanjut)

    let new_id = FaultId::random_except(source);

    if state.faults.active.contains_key(&new_id) {
        return;
    }

    let instance = FaultInstance::new(
        new_id, 0.02, // escalation rate default
        0.5,  // thermal coupling default
        0.5,  // electrical coupling default
    );

    state.faults.active.insert(new_id, instance);
}
