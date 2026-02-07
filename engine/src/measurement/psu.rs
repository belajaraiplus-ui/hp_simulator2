use crate::measurement::tool::MeasurementTool;
use crate::measurement::repetition::repetition_factor;
use crate::state::phone_state::*;

pub struct PSU {
    pub set_voltage: f64,
    pub current_limit: f64,
    pub response_speed: f64,
    pub ripple: f64,
}

impl MeasurementTool for PSU {
    fn perform(&self, s: &mut PhoneState, _dt: f64) -> f64 {
        // 1️⃣ repetition dulu
        let rep = repetition_factor(s, "psu_current", "rail");

        // 2️⃣ baru ambil rail
        let rail = s.electrical.rails.values_mut().next().unwrap();

        rail.target_voltage = self.set_voltage;
        rail.ripple += self.ripple * (1.0 + 0.2 * rep.min(10.0));

        let current = rail.load_current.min(self.current_limit);
        let noise = rail.noise * (1.0 + 0.1 * rep.min(10.0));
        let observed = current + noise;

        let stress = current.abs() * 0.05 * rep;
        s.stress.cumulative_stress += stress;

        s.measurements.history.push(MeasurementEvent {
            time: s.time,
            observed_value: observed,
            noise,
            injected_energy: stress,
            stress_added: stress,
        });

        observed
    }
}