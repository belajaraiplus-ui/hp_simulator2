use crate::state::phone_state::*;
use crate::state::ids::{RailId, ThermalZoneId};

/// Semua observasi HARUS lewat sini.
pub struct MeasurementEngine;

impl MeasurementEngine {
    /// Ukur tegangan rail (LIVE SYSTEM)
    pub fn measure_voltage(state: &mut PhoneState, rail: RailId) -> f64 {
        let rail_state = state
            .electrical
            .rails
            .get_mut(&rail)
            .expect("measure_voltage: requested rail not found");

        // =======================
        // ENERGY INJECTION
        // =======================
        let injected = 0.002;
        state.stress.measurement += injected;

        // =======================
        // MEASUREMENT LOAD
        // =======================
        rail_state.load_current += 0.01;

        // =======================
        // NOISY READOUT
        // =======================
        let noise = rail_state.noise + state.electrical.transient_noise;
        let observed = rail_state.voltage + noise;

        // =======================
        // LOG & LAST-SEEN
        // =======================
        state.measurements.history.push(MeasurementEvent {
            time: state.time,
            target: format!("{:?}", rail),
            observed_value: observed,
            noise,
            injected_energy: injected,
            stress_added: injected,
        });

        // update last seen map (proxy UI only)
        state.last_voltage.insert(rail, observed);

        observed
    }

    /// Ukur temperatur zone
    pub fn measure_temperature(state: &mut PhoneState, zone: ThermalZoneId) -> f64 {
        let z = state
            .thermal
            .zones
            .get(&zone)
            .expect("measure_temperature: requested thermal zone not found");

        let injected = 0.001;
        state.stress.measurement += injected;

        let noise = 0.5 * state.electrical.transient_noise;
        let observed = z.temperature + noise;

        state.measurements.history.push(MeasurementEvent {
            time: state.time,
            target: format!("{:?}", zone),
            observed_value: observed,
            noise,
            injected_energy: injected,
            stress_added: injected,
        });

        state.last_temperature.insert(zone, observed);

        observed
    }
}
