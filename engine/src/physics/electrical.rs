use crate::state::electrical::PsuMode;
use crate::state::phone_state::*;

pub fn apply_psu_behavior(state: &mut PhoneState) {
    let enabled = state.electrical.input.enabled;
    let target_rail = state.electrical.input.target_rail;
    let current_limit = state.electrical.input.current_limit;
    let voltage = state.electrical.input.voltage;
    let ovp_threshold = state.electrical.input.ovp_threshold;
    let uvp_threshold = state.electrical.input.uvp_threshold;
    let ocp_threshold = state.electrical.input.ocp_threshold;

    if !enabled {
        state.electrical.input.measured_current = 0.0;
        state.electrical.input.psu_mode = PsuMode::Off;
        return;
    }

    let total_load: f64 = state.electrical.total_load().max(0.0_f64);
    let mut effective_current_limit = current_limit.max(0.001_f64);

    let temp_increase = total_load * 0.5 * 0.1;
    state.electrical.input.psu_temperature =
        (state.electrical.input.psu_temperature + temp_increase).min(100.0);

    let thermal_factor: f64 =
        (1.0_f64 - state.stress.electrical * 0.02_f64).clamp(0.7_f64, 1.0_f64);
    effective_current_limit *= thermal_factor;

    let rail_voltage = target_rail
        .and_then(|r| state.electrical.rails.get(&r))
        .map(|r| r.state.voltage)
        .unwrap_or(0.0);

    let voltage_error = (voltage - rail_voltage).abs();
    let current_ratio = total_load / effective_current_limit;

    if current_ratio >= 0.95 {
        state.electrical.input.psu_mode = PsuMode::CC;
    } else if voltage_error > 0.1 && current_ratio < 0.9 {
        state.electrical.input.psu_mode = PsuMode::CV;
    }

    if ovp_threshold > 0.0 && rail_voltage > ovp_threshold {
        state.electrical.input.psu_mode = PsuMode::Fault;
        state.electrical.input.enabled = false;
    }

    if uvp_threshold > 0.0 && rail_voltage < uvp_threshold && rail_voltage > 0.1 {
        state.electrical.input.psu_mode = PsuMode::Fault;
        state.electrical.input.enabled = false;
    }

    if ocp_threshold > 0.0 && total_load > ocp_threshold {
        state.electrical.input.psu_mode = PsuMode::Fault;
        state.electrical.input.enabled = false;
    }

    if total_load > effective_current_limit {
        state.stress.electrical += 0.01_f64 * (total_load - effective_current_limit);
    }
}

pub fn step_electrical(s: &mut PhoneState, dt: f64) {
    apply_psu_behavior(s);

    let _dt: f64 = dt.max(0.0_f64);
    let psu_enabled = s.electrical.input.enabled;
    let psu_ripple = s.electrical.input.output_ripple_pp;

    for (_rail_id, rail) in s.electrical.rails.iter_mut() {
        let ripple_v = if psu_enabled {
            let ripple_freq = 100_000.0;
            let time = s.time;
            let ripple = (time * ripple_freq * 2.0 * std::f64::consts::PI).sin() * psu_ripple / 2.0;
            ripple * 0.1
        } else {
            0.0
        };
        rail.noise = (s.electrical.transient_noise + rail.state.ripple + ripple_v) * 0.05_f64;
    }
}
