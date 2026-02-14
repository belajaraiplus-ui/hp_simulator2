use crate::state::phone_state::*;
use crate::state::ids::{RailId, ThermalZoneId};

pub fn apply_psu_behavior(state: &mut PhoneState) {

    if !state.electrical.input.enabled {
        return;
    }

    let input_voltage = state.electrical.input.voltage;
    let mut current_limit = state.electrical.input.current_limit.max(0.001);

    let total_load = state.electrical.total_load();

    // Update measured current (observable ampere display)
    state.electrical.set_input_measured_current(total_load);

    if let Some(vbat) = state.electrical.rails.get_mut(&RailId::Vbat) {

        // ============================
        // THERMAL DERATING
        // ============================
        // Jika stress tinggi, limit sedikit turun
        let thermal_factor = (1.0 - state.stress.electrical * 0.02).clamp(0.7, 1.0);
        current_limit *= thermal_factor;

        // ============================
        // DETERMINE TARGET MODE
        // ============================

        let target_voltage = if total_load <= current_limit {
            // =======================
            // CV MODE
            // =======================
            input_voltage
        } else {
            // =======================
            // CC MODE
            // =======================
            let ratio = current_limit / total_load;
            let mut sag_voltage = input_voltage * ratio;

            // Foldback under heavy overload
            if total_load > current_limit * 1.5 {
                sag_voltage *= 0.7;
            }

            // Add electrical stress proportionally
            state.stress.electrical += 0.01 * (total_load - current_limit);

            sag_voltage
        };

        // ============================
        // INTERNAL RESISTANCE MODEL
        // ============================
        let internal_resistance = 0.05; // 50mΩ realistic lab PSU feel
        let resistive_drop = total_load * internal_resistance;

        let target_voltage = (target_voltage - resistive_drop).max(0.0);

        // ============================
        // SMOOTH CONTROL LOOP RESPONSE
        // ============================
        let response_speed = 0.25; // control bandwidth feel
        vbat.voltage += (target_voltage - vbat.voltage) * response_speed;
    }
}
  

/// Electrical step - FASE 10.1
/// Electrical menghasilkan panas -> thermal menyebarkan.
/// Tidak ada stress langsung di sini.
pub fn step_electrical(s: &mut PhoneState, dt: f64) {
    // Apply external PSU behavior first.
    apply_psu_behavior(s);

    // =======================
    // ELECTRICAL UPDATE
    // =======================
    for (rail_id, rail) in s.electrical.rails.iter_mut() {
        match rail_id {
            // =========================================
            // VBAT - SUMBER DAYA (DINAMIS)
            // =========================================
            RailId::Vbat => {
                rail.load_current = 0.15;

                let capacitance = rail.capacitance.max(1e-6);
                let esr = rail.esr.max(1e-6);

                let drop = (rail.load_current + rail.leakage_current) * esr;

                let dv = (rail.target_voltage - rail.voltage - drop)
                    * dt / capacitance;

                rail.voltage += dv;
            }

            // =========================================
            // RAIL SEKUNDER - TRACK TARGET (PASIF)
            // =========================================
            _ => {
                rail.load_current = 0.0;

                // tracking lembut (over-damped)
                let alpha = 0.2;
                rail.voltage += (rail.target_voltage - rail.voltage) * alpha;
            }
        }

        // =========================================
        // OBSERVATIONAL NOISE (READ-ONLY)
        // =========================================
        rail.noise = (s.electrical.transient_noise + rail.ripple) * 0.05;
    }

    // =======================
    // ELECTRICAL -> THERMAL HEAT INJECTION (FASE 10.1)
    // =======================

    // reset heat generation dulu
    for (_id, zone) in s.thermal.zones.iter_mut() {
        zone.heat_generation = 0.0;
    }

    // VBAT + VCORE terutama memanaskan SoC
    if let Some(soc) = s.thermal.zones.get_mut(&ThermalZoneId::Soc) {
        if let Some(vcore) = s.electrical.rails.get(&RailId::Vcore) {
            soc.heat_generation += vcore.load_current * vcore.voltage * 0.8;
        }

        if let Some(vbat) = s.electrical.rails.get(&RailId::Vbat) {
            soc.heat_generation += vbat.load_current * 0.2;
        }
    }

    // Board menerima panas sisa
    if let Some(board) = s.thermal.zones.get_mut(&ThermalZoneId::Board) {
        board.heat_generation += s.electrical.total_load() * 0.5;
    }
}
