use crate::measurement::repetition::repetition_factor;
use crate::measurement::tool::MeasurementTool;
use crate::state::ids::RailId;
use crate::state::phone_state::*;

pub struct PSU {
    pub set_voltage: f64,
    pub current_limit: f64,
    pub response_speed: f64,
    pub ripple: f64,
}

impl MeasurementTool for PSU {
    fn perform(&self, s: &mut PhoneState, _dt: f64) -> f64 {
        // 1) Repetition/fatigue factor
        let rep = repetition_factor(s, "psu_current", "rail");

        // 2) Update canonical PSU input state with finite response speed
        let previous_setpoint = s.electrical.input.voltage;
        let alpha = self.response_speed.clamp(0.01, 1.0);
        let commanded_voltage =
            previous_setpoint + (self.set_voltage - previous_setpoint) * alpha;

        s.electrical
            .apply_psu_config(commanded_voltage, self.current_limit, true);

        // 3) Inject PSU ripple deterministically on VBAT
        let rail_noise = if let Some(vbat) = s.electrical.rails.get_mut(&RailId::Vbat) {
            vbat.ripple += self.ripple * (1.0 + 0.2 * rep.min(10.0));
            vbat.noise
        } else {
            0.0
        };

        // 4) Observe output current under configured limit
        let current = s
            .electrical
            .total_load()
            .min(self.current_limit.max(0.0));
        s.electrical.set_input_measured_current(current);

        let noise = rail_noise * (1.0 + 0.1 * rep.min(10.0));
        let observed = current + noise;

        // 5) Keep side effects and event logging compatible
        let stress = current.abs() * 0.05 * rep;
        s.stress.measurement += stress;

        s.measurements.history.push(MeasurementEvent {
            time: s.time,
            target: "PSU(Current)".to_string(),
            observed_value: observed,
            noise,
            injected_energy: stress,
            stress_added: stress,
        });

        observed
    }
}
