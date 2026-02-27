use crate::state::ids::{RailId, ThermalZoneId};
use crate::state::phone_state::*;

/// PSU behavior in this stage only contributes stress/derating effects.
/// Rail voltages are integrated in `power::propagate`.
pub fn apply_psu_behavior(state: &mut PhoneState) {
    if !state.electrical.input.enabled {
        state.electrical.input.measured_current = 0.0;
        return;
    }

    let mut current_limit: f64 = state.electrical.input.current_limit.max(0.001_f64);
    let total_load: f64 = state.electrical.total_load().max(0.0_f64);

    let thermal_factor: f64 =
        (1.0_f64 - state.stress.electrical * 0.02_f64).clamp(0.7_f64, 1.0_f64);
    current_limit *= thermal_factor;

    if total_load > current_limit {
        state.stress.electrical += 0.01_f64 * (total_load - current_limit);
    }
}

/// Electrical step:
/// - keep observational noise coherent
/// - couple electrical current into thermal domain
pub fn step_electrical(s: &mut PhoneState, dt: f64) {
    apply_psu_behavior(s);

    let _dt: f64 = dt.max(0.0_f64);

    for (_rail_id, rail) in s.electrical.rails.iter_mut() {
        rail.noise = (s.electrical.transient_noise + rail.state.ripple) * 0.05_f64;
    }

    for (_id, zone) in s.thermal.zones.iter_mut() {
        zone.heat_generation = 0.0_f64;
    }

    for (rid, rail) in s.electrical.rails.iter() {
        let i = rail.state.current.abs();
        if i < 0.001_f64 {
            continue;
        }

        let r = rail.health.esr.max(1e-6_f64);
        let heat = i * i * r;

        let zone = match rid {
            RailId::Vcore => ThermalZoneId::Soc,
            RailId::Vbat => ThermalZoneId::Pmic,
            RailId::Vchg => ThermalZoneId::Board,
            _ => ThermalZoneId::Board,
        };

        if let Some(z) = s.thermal.zones.get_mut(&zone) {
            z.heat_generation += heat;
        }
    }

    if let Some(soc) = s.thermal.zones.get_mut(&ThermalZoneId::Soc) {
        if let Some(vcore) = s.electrical.rails.get(&RailId::Vcore) {
            soc.heat_generation += vcore.state.current * vcore.state.voltage * 0.8_f64;
        }
        if let Some(vbat) = s.electrical.rails.get(&RailId::Vbat) {
            soc.heat_generation += vbat.state.current * 0.2_f64;
        }
    }

    if let Some(board) = s.thermal.zones.get_mut(&ThermalZoneId::Board) {
        board.heat_generation += s.electrical.total_load() * 0.5_f64;
    }
}
