use crate::measurement::tool::MeasurementTool;
use crate::measurement::repetition::repetition_factor;
use crate::state::phone_state::*;

pub struct Oscilloscope {
    pub bandwidth: f64,
    pub probe_capacitance: f64,
}

impl MeasurementTool for Oscilloscope {
    fn perform(&self, s: &mut PhoneState, _dt: f64) -> f64 {
        // 1️⃣ Hitung repetition dulu (butuh &mut PhoneState)
        let rep = repetition_factor(s, "scope", "rail");

        // 2️⃣ Baru ambil mutable borrow ke rail
        let rail = s.electrical.rails.values_mut().next().unwrap();

        // Probe loading (kapasitansi bertambah)
        rail.health.capacitance += self.probe_capacitance * (1.0 + 0.1 * rep.min(10.0));

        // Noise/jitter akibat probe
        let jitter_like = rail.noise * (1.0 + 0.2 * rep.min(10.0));
        let observed = rail.state.voltage + jitter_like;

        // 3️⃣ Stress akibat pengukuran
        let stress = jitter_like.abs() * 0.03 * rep;
        s.stress.measurement += stress;

        s.measurements.history.push(MeasurementEvent {
            time: s.time,
            target: "Scope(Rail)".to_string(),
            observed_value: observed,
            noise: jitter_like,
            injected_energy: stress,
            stress_added: stress,
        });

        observed
    }
}
