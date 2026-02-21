use crate::state::phone_state::*;
use crate::state::ids::{RailId, ThermalZoneId};

/// Model perilaku PSU bench sederhana (CV/CC + derating + internal resistance)
pub fn apply_psu_behavior(state: &mut PhoneState) {
    if !state.electrical.input.enabled {
        return;
    }

    let input_voltage: f64 = state.electrical.input.voltage.max(0.0_f64);
    let mut current_limit: f64 = state.electrical.input.current_limit.max(0.001_f64);

    // Total load dari seluruh rail (observable current)
    let total_load: f64 = state.electrical.total_load().max(0.0_f64);

    // Update measured current (ampere display)
    state.electrical.set_input_measured_current(total_load);

    // VBAT adalah tempat PSU "masuk"
    let Some(vbat) = state.electrical.rails.get_mut(&RailId::Vbat) else {
        return;
    };

    // ============================
    // THERMAL / STRESS DERATING
    // ============================
    // Jika stress listrik tinggi, current limit turun sedikit
    let thermal_factor: f64 = (1.0_f64 - state.stress.electrical * 0.02_f64).clamp(0.7_f64, 1.0_f64);
    current_limit *= thermal_factor;

    // ============================
    // DETERMINE CV/CC MODE
    // ============================
    let target_voltage: f64 = if total_load <= current_limit {
        // CV mode
        input_voltage
    } else {
        // CC mode
        let ratio: f64 = (current_limit / total_load).clamp(0.0_f64, 1.0_f64);
        let mut sag_voltage: f64 = input_voltage * ratio;

        // Foldback under heavy overload
        if total_load > current_limit * 1.5_f64 {
            sag_voltage *= 0.7_f64;
        }

        // Stress bertambah proporsional overload
        state.stress.electrical += 0.01_f64 * (total_load - current_limit);

        sag_voltage
    };

    // ============================
    // INTERNAL RESISTANCE MODEL
    // ============================
    let internal_resistance: f64 = 0.05_f64; // 50 mΩ bench PSU feel
    let resistive_drop: f64 = total_load * internal_resistance;
    let target_voltage: f64 = (target_voltage - resistive_drop).max(0.0_f64);

    // ============================
    // SMOOTH CONTROL LOOP RESPONSE
    // ============================
    let response_speed: f64 = 0.25_f64; // control bandwidth feel
    vbat.state.voltage += (target_voltage - vbat.state.voltage) * response_speed;

    // Untuk realism: update target_voltage VBAT juga (optional, membantu rail tracking)
    vbat.target_voltage = target_voltage;
}

/// Electrical step - FASE 10.1
/// Electrical menghasilkan panas -> thermal menyebarkan.
/// Tidak ada stress langsung di sini (stress PSU di apply_psu_behavior).
pub fn step_electrical(s: &mut PhoneState, dt: f64) {
    // Apply external PSU behavior first.
    apply_psu_behavior(s);

    let dt: f64 = dt.max(0.0_f64);

    // =======================
    // ELECTRICAL UPDATE
    // =======================

    // Reset load_current dulu (supaya tidak carry over)
    for (_rail_id, rail) in s.electrical.rails.iter_mut() {
        rail.state.current = 0.0_f64;
    }

    // Update tiap rail
    for (rail_id, rail) in s.electrical.rails.iter_mut() {
        match rail_id {
            // =========================================
            // VBAT - SUMBER DAYA (DINAMIS)
            // =========================================
            RailId::Vbat => {
                // baseline load VBAT (feel)
                rail.state.current = 0.15_f64;

                let capacitance: f64 = rail.health.capacitance.max(1e-6_f64);
                let esr: f64 = rail.health.esr.max(1e-6_f64);

                // ESR drop dari load + leakage
                let drop: f64 = (rail.state.current + rail.leakage_current) * esr;

                // RC approach (simple)
                let dv: f64 = (rail.target_voltage - rail.state.voltage - drop) * dt / capacitance;
                rail.state.voltage += dv;
            }

            // =========================================
            // RAIL SEKUNDER - TRACK TARGET (PASIF)
            // =========================================
            _ => {
                // default no explicit load di rail sekunder (nanti bisa diisi dari BoardProfile)
                rail.state.current = 0.0_f64;

                // tracking lembut (over-damped)
                let alpha: f64 = 0.2_f64;
                rail.state.voltage += (rail.target_voltage - rail.state.voltage) * alpha;
            }
        }

        // =========================================
        // OBSERVATIONAL NOISE (READ-ONLY)
        // =========================================
        rail.noise = (s.electrical.transient_noise + rail.state.ripple) * 0.05_f64;
    }

    // =======================
    // ELECTRICAL -> THERMAL HEAT INJECTION (FASE 10.1)
    // =======================

    // reset heat generation dulu
    for (_id, zone) in s.thermal.zones.iter_mut() {
        zone.heat_generation = 0.0_f64;
    }

    // VBAT + VCORE terutama memanaskan SoC
    if let Some(soc) = s.thermal.zones.get_mut(&ThermalZoneId::Soc) {
        if let Some(vcore) = s.electrical.rails.get(&RailId::Vcore) {
            soc.heat_generation += vcore.state.current * vcore.state.voltage * 0.8_f64;
        }
        if let Some(vbat) = s.electrical.rails.get(&RailId::Vbat) {
            soc.heat_generation += vbat.state.current * 0.2_f64;
        }
    }

    // Board menerima panas sisa
    if let Some(board) = s.thermal.zones.get_mut(&ThermalZoneId::Board) {
        board.heat_generation += s.electrical.total_load() * 0.5_f64;
    }
}