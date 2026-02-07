use crate::state::phone_state::PhoneState;
use std::collections::HashMap;

/// Meta-fault psikologis berbasis PERILAKU TEKNISI.
/// Tidak menerima parameter eksternal.
/// Semua efek muncul dari histori measurement.
pub fn apply_meta_effects(state: &mut PhoneState) {
    let history = &state.measurements.history;

    if history.len() < 3 {
        return;
    }

    // =======================
    // ANALISIS PERILAKU TEKNISI
    // =======================

    let mut target_count: HashMap<&str, usize> = HashMap::new();
    let mut electrical_focus = 0usize;
    let mut thermal_focus = 0usize;

    for m in history.iter().rev().take(10) {
        let target = m.target.as_str();
        *target_count.entry(target).or_insert(0) += 1;

        if target.starts_with("V(") {
            electrical_focus += 1;
        }
        if target.starts_with("T(") {
            thermal_focus += 1;
        }
    }

    let repeated_focus = target_count.values().any(|&c| c >= 4);

    // =======================
    // 1. CONFIRMATION BIAS
    // =======================
    if repeated_focus {
        // Noise tampak "lebih rapi", tapi bias meningkat
        state.electrical.transient_noise *= 0.92;
        state.stress.measurement += 0.05;
    }

    // =======================
    // 2. SUNK COST FALLACY
    // =======================
    if state.stress.measurement > 2.0 {
        // Sistem makin dipaksa → rapuh
        state.electrical.transient_noise += 0.1;
        state.stress.electrical += 0.05;
    }

    // =======================
    // 3. TUNNEL VISION
    // =======================
    if electrical_focus >= 5 && thermal_focus == 0 {
        // blind spot thermal
        state.stress.thermal += 0.05;
    }

    if thermal_focus >= 5 && electrical_focus == 0 {
        // blind spot electrical
        state.stress.electrical += 0.05;
    }

    // =======================
    // 4. FALSE STABILITY WINDOW
    // =======================
    // Banyak pengukuran, tapi noise kecil → rasa aman palsu
    if history.len() >= 8 && state.electrical.transient_noise < 0.05 {
        state.stress.measurement += 0.1;
    }
}
