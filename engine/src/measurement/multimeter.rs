use crate::measurement::tool::MeasurementTool;
use crate::measurement::repetition::repetition_factor;
use crate::measurement::meta::apply_meta_effects;
use crate::state::phone_state::{PhoneState, MeasurementEvent};
use crate::state::ids::RailId;

pub struct VoltageMeter {
    pub input_impedance: f64,
    pub internal_noise: f64,
}

impl MeasurementTool for VoltageMeter {
    fn perform(&self, s: &mut PhoneState, _dt: f64) -> f64 {
        // =======================f
        // 1️⃣ PILIH TARGET RAIL (SAFE)
        // =======================
        let target_rail_id: RailId = s
            .electrical
            .rails
            .keys()
            .next()
            .cloned()
            .unwrap_or(RailId::Vbat);

        // =======================
        // 2️⃣ REPETITION FACTOR
        // =======================
        let rep = repetition_factor(s, "multimeter_voltage", &format!("{:?}", target_rail_id));

        // =======================
        // 3️⃣ PHYSICS & STRESS (SCOPED MUTABLE BORROW)
        // =======================
        let (observed, stress_val, noise_val) = {
            let rail = s
                .electrical
                .rails
                .get_mut(&target_rail_id)
                .expect("Critical: Target rail missing");

            // Loading effect (probe impedance)
            rail.load_current += (rail.voltage / self.input_impedance) * rep;

            // Noise model
            let noise =
                (self.internal_noise + rail.noise) * (1.0 + 0.1 * rep.min(10.0));

            let measured = rail.voltage + noise;

            // Stress contribution
            let stress = rail.load_current.abs() * 0.02 * rep;

            (measured, stress, noise)
        };

        // =======================
        // 4️⃣ GLOBAL STATE UPDATE
        // =======================
        s.stress.cumulative_stress += stress_val;

        s.measurements.history.push(MeasurementEvent {
            time: s.time,
            observed_value: observed,
            noise: noise_val,
            injected_energy: stress_val,
            stress_added: stress_val,
        });

        // =======================
        // 5️⃣ META EFFECT (LAST)
        // =======================
        apply_meta_effects(s, rep);

        observed
    }
}
