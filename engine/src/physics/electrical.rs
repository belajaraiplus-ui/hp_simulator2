use crate::state::phone_state::*;
use crate::state::ids::{RailId, ThermalZoneId};

/// Electrical step — FASE 10.1
/// Electrical menghasilkan panas → thermal menyebarkan.
/// Tidak ada stress langsung di sini.
pub fn step_electrical(s: &mut PhoneState, dt: f64) {
    // =======================
    // ELECTRICAL UPDATE
    // =======================
    for (rail_id, rail) in s.electrical.rails.iter_mut() {
        match rail_id {
            // =========================================
            // VBAT — SUMBER DAYA (DINAMIS)
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
            // RAIL SEKUNDER — TRACK TARGET (PASIF)
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
    // ELECTRICAL → THERMAL HEAT INJECTION (FASE 10.1)
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
