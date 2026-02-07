use crate::state::phone_state::*;
use crate::state::ids::{RailId, ThermalZoneId};
use crate::measurement::meta::apply_meta_effects;


/// Semua observasi HARUS lewat sini.
/// Measurement adalah INTERAKSI LISTRIK, bukan pembacaan pasif.
pub struct MeasurementEngine;

impl MeasurementEngine {
    /// =======================
    /// MULTIMETER — VOLTAGE (LIVE SYSTEM)
    /// =======================
    pub fn measure_voltage(state: &mut PhoneState, rail: RailId) -> f64 {
        let rail_state = state
            .electrical
            .rails
            .get_mut(&rail)
            .expect("measure_voltage: requested rail not found");

        // =======================
        // MEASUREMENT FATIGUE
        // =======================
        let key = ("voltage".to_string(), format!("{:?}", rail));
        let count = state.fatigue.counts.entry(key.clone()).or_insert(0);
        *count += 1;

        let fatigue_factor = (*count as f64).min(10.0) * 0.05;

        // =======================
        // ENERGY INJECTION
        // =======================
        let injected = 0.002 + fatigue_factor * 0.002;
        state.stress.measurement += injected;

        // =======================
        // ELECTRICAL INTERACTION
        // Probe menambah beban & memicu drop kecil
        // =======================
        let probe_load = 0.01 + fatigue_factor * 0.02;
        rail_state.load_current += probe_load;

        // voltage sag akibat probe (non-ideal)
        rail_state.voltage -= probe_load * rail_state.esr;

        // =======================
        // NOISE MODEL (CONTEXTUAL)
        // =======================
        let stress_noise =
            state.stress.electrical * 0.02 +
            state.stress.measurement * 0.03;

        let fatigue_noise = fatigue_factor * 0.05;

        let noise = rail_state.noise
            + state.electrical.transient_noise
            + stress_noise
            + fatigue_noise;

        // =======================
        // OBSERVED VALUE
        // =======================
        let observed = rail_state.voltage + noise;

        // =======================
        // LOG & LAST-SEEN (UI PROXY)
        // =======================
        state.measurements.history.push(MeasurementEvent {
            time: state.time,
            target: format!("V({:?})", rail),
            observed_value: observed,
            noise,
            injected_energy: injected,
            stress_added: injected,
        });

        state.last_voltage.insert(rail, observed);
        // META-FAULT PSIKOLOGIS
        apply_meta_effects(state);

        observed
    }

    /// =======================
    /// TEMPERATURE MEASUREMENT
    /// =======================
    pub fn measure_temperature(state: &mut PhoneState, zone: ThermalZoneId) -> f64 {
        let z = state
            .thermal
            .zones
            .get_mut(&zone)
            .expect("measure_temperature: requested thermal zone not found");

        // =======================
        // MEASUREMENT FATIGUE
        // =======================
        let key = ("temperature".to_string(), format!("{:?}", zone));
        let count = state.fatigue.counts.entry(key.clone()).or_insert(0);
        *count += 1;

        let fatigue_factor = (*count as f64).min(10.0) * 0.03;

        // =======================
        // ENERGY INJECTION
        // =======================
        let injected = 0.001 + fatigue_factor * 0.0015;
        state.stress.measurement += injected;

        // =======================
        // THERMAL DISTORTION
        // Probe dapat mengganggu local equilibrium
        // =======================
        z.temperature += fatigue_factor * 0.1;

        // =======================
        // NOISE MODEL
        // =======================
        let noise =
            state.electrical.transient_noise * 0.5 +
            state.stress.thermal * 0.02 +
            fatigue_factor * 0.1;

        let observed = z.temperature + noise;

        // =======================
        // LOG & LAST-SEEN
        // =======================
        state.measurements.history.push(MeasurementEvent {
            time: state.time,
            target: format!("T({:?})", zone),
            observed_value: observed,
            noise,
            injected_energy: injected,
            stress_added: injected,
        });

        state.last_temperature.insert(zone, observed);

        // META-FAULT PSIKOLOGIS
        apply_meta_effects(state);
        
        observed
    }
}
