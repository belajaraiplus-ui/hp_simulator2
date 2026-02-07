use crate::state::phone_state::*;
use crate::state::ids::{RailId, ThermalZoneId, ComponentId};
use crate::measurement::meta::apply_meta_effects;


/// Hasil injection BUKAN diagnosis.
/// Ini hanya ringkasan observasi setelah intervensi berisiko.
pub struct InjectionResult {
    pub observed_temperature_rise: f64,
    pub observed_noise_increase: f64,
}

/// Voltage Injection Tool — HIGH RISK
pub struct VoltageInjection;

impl VoltageInjection {
    /// Paksa tegangan ke rail tertentu selama durasi tertentu.
    ///
    /// PERINGATAN:
    /// - Bisa merusak sistem
    /// - Bisa memicu fault permanen
    /// - Bisa tidak memberi informasi berguna
    pub fn inject_voltage(
        state: &mut PhoneState,
        rail: RailId,
        voltage: f64,
        duration: f64,
    ) -> InjectionResult {
        let rail_state = state
            .electrical
            .rails
            .get_mut(&rail)
            .expect("inject_voltage: rail not found");

        // =======================
        // PARAMETER NORMALIZATION
        // =======================
        let duration = duration.clamp(0.01, 5.0);
        let delta_v = (voltage - rail_state.voltage).max(0.0);

        // =======================
        // ELECTRICAL STRESS
        // =======================
        let forced_current = delta_v / rail_state.esr.max(0.01);
        let electrical_energy = forced_current * voltage * duration;

        state.stress.electrical += electrical_energy * 0.2;
        state.stress.measurement += electrical_energy * 0.1;

        // Permanent degradation chance (silent, irreversible)
        if state.rng_hit((electrical_energy * 0.02).min(0.3)) {
            state.material.aging_map
                .entry(ComponentId::RailDriver(rail))
                .and_modify(|v| *v += 0.1)
                .or_insert(0.1);
        }

        // =======================
        // THERMAL RESPONSE
        // =======================
        let mut temp_rise = 0.0;

        for (zone_id, zone) in state.thermal.zones.iter_mut() {
            // crude coupling: board & soc more sensitive
            let coupling = match zone_id {
                ThermalZoneId::Soc => 0.6,
                ThermalZoneId::Board => 0.4,
                _ => 0.2,
            };

            let heat = electrical_energy * coupling * 0.05;
            let delta_t = heat / zone.thermal_mass.max(10.0);

            zone.temperature += delta_t;
            temp_rise += delta_t;
        }

        // =======================
        // NOISE & INSTABILITY
        // =======================
        let noise_increase = electrical_energy * 0.03;
        state.electrical.transient_noise += noise_increase;

        // =======================
        // FAULT INTERACTION (INDIRECT)
        // =======================
        for fault in state.faults.active.values_mut() {
            let stress_factor =
                state.stress.electrical * fault.coupling.electrical +
                state.stress.thermal * fault.coupling.thermal;

            fault.accumulated_stress += stress_factor * duration;

            // phase jump chance (NOT guaranteed)
            if state.rng_hit((stress_factor * 0.01).min(0.2)) {
                fault.intensity = (fault.intensity + 0.2).min(1.0);
            }
        }

        // =======================
        // LOG EVENT (MEASUREMENT TRACE)
        // =======================
        state.measurements.history.push(MeasurementEvent {
            time: state.time,
            target: format!("INJECT({:?})", rail),
            observed_value: voltage,
            noise: noise_increase,
            injected_energy: electrical_energy,
            stress_added: electrical_energy,
        });

        // =======================
        // META-FAULT PSIKOLOGIS
        // =======================
        // Injection sangat kuat memicu sunk-cost & confirmation bias
        apply_meta_effects(state);

        InjectionResult {
            observed_temperature_rise: temp_rise,
            observed_noise_increase: noise_increase,
        }
    }
}
