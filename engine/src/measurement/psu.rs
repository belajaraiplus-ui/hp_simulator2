use crate::measurement::tool::MeasurementTool;
use crate::state::ids::RailId;
use crate::state::phone_state::*;
use crate::util::rng::XorShift64;

pub struct PSU {
    pub set_voltage: f64,
    pub current_limit: f64,
    pub response_speed: f64,
    pub ripple: f64,
}

impl MeasurementTool for PSU {
    fn perform(&self, s: &mut PhoneState, _dt: f64) -> f64 {
        let rail_noise = s
            .electrical
            .rails
            .get(&RailId::Vbat)
            .map(|vbat| vbat.noise.abs())
            .unwrap_or(0.0_f64);
        let effective_limit = if self.current_limit > 0.0_f64 {
            self.current_limit
        } else {
            s.electrical.input.current_limit
        };
        let true_current = if s.electrical.input.enabled {
            s.electrical
                .total_load()
                .min(effective_limit.max(0.0_f64))
        } else {
            0.0_f64
        };

        let time_bits = s.time.to_bits();
        let sample_index = s.measurements.history.len() as u64;
        let knob_bits = self.set_voltage.to_bits()
            ^ self.response_speed.to_bits().rotate_left(7)
            ^ self.ripple.to_bits().rotate_left(13);
        let seed =
            time_bits ^ sample_index.rotate_left(19) ^ knob_bits.rotate_left(29) ^ 0xA24BAED4963EE407u64;
        let mut rng = XorShift64::new(seed);

        let (range, lsd) = if true_current.abs() < 0.6_f64 {
            (0.6_f64, 0.001_f64)
        } else if true_current.abs() < 6.0_f64 {
            (6.0_f64, 0.01_f64)
        } else {
            (20.0_f64, 0.1_f64)
        };
        let condition = (s.electrical.transient_noise.abs() + rail_noise).min(1.0_f64);
        let systematic = rng.uniform(-1.0_f64, 1.0_f64)
            * (true_current.abs() * 0.002_f64 + range * 0.0005_f64 + condition * range * 0.001_f64);
        let jitter = rng.uniform(-1.0_f64, 1.0_f64) * lsd * (0.5_f64 + 2.0_f64 * condition);
        let raw = true_current + systematic + jitter;
        let observed = ((raw / lsd).round() * lsd).clamp(-range, range);
        let noise = observed - true_current;

        s.measurements.history.push(MeasurementEvent {
            time: s.time,
            target: "PSU(Current)".to_string(),
            observed_value: observed,
            noise,
            injected_energy: 0.0_f64,
            stress_added: 0.0_f64,
        });

        observed
    }
}
