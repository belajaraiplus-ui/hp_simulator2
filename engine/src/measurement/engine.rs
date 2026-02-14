use crate::state::phone_state::*;
use crate::state::ids::{RailId, ThermalZoneId};
use crate::measurement::meta::apply_meta_effects;


/// Semua observasi HARUS lewat sini.
/// Measurement adalah INTERAKSI LISTRIK, bukan pembacaan pasif.
pub struct MeasurementEngine;

#[derive(Copy, Clone, PartialEq, Eq)]
enum ComponentKind {
    Capacitor,
    Resistor,
    Trace,
    Inductor,
    TestPoint,
}

#[derive(Copy, Clone)]
struct ComponentProbe {
    id: &'static str,
    rail: RailId,
    kind: ComponentKind,
    parasitic_ohm: f64,
    diode_offset: f64,
}

impl MeasurementEngine {
    fn component_probe(component_id: &str) -> Option<ComponentProbe> {
        match component_id.trim().to_lowercase().as_str() {
            "c_vbat_in" => Some(ComponentProbe {
                id: "c_vbat_in",
                rail: RailId::Vbat,
                kind: ComponentKind::Capacitor,
                parasitic_ohm: 0.08,
                diode_offset: 0.15,
            }),
            "c_vcore_out" => Some(ComponentProbe {
                id: "c_vcore_out",
                rail: RailId::Vcore,
                kind: ComponentKind::Capacitor,
                parasitic_ohm: 0.05,
                diode_offset: 0.12,
            }),
            "r_vcore_fb" => Some(ComponentProbe {
                id: "r_vcore_fb",
                rail: RailId::Vcore,
                kind: ComponentKind::Resistor,
                parasitic_ohm: 47.0,
                diode_offset: -0.05,
            }),
            "r_vbat_sense" => Some(ComponentProbe {
                id: "r_vbat_sense",
                rail: RailId::Vbat,
                kind: ComponentKind::Resistor,
                parasitic_ohm: 0.01, // REVISI: Sense resistor harusnya sangat kecil (10mOhm)
                diode_offset: -0.06,
            }),
            "j_vbat_main" => Some(ComponentProbe {
                id: "j_vbat_main",
                rail: RailId::Vbat,
                kind: ComponentKind::Trace,
                parasitic_ohm: 0.02,
                diode_offset: -0.10,
            }),
            "j_vcore_phase" => Some(ComponentProbe {
                id: "j_vcore_phase",
                rail: RailId::Vcore,
                kind: ComponentKind::Trace,
                parasitic_ohm: 0.03,
                diode_offset: -0.08,
            }),
            // TAMBAHAN: Induktor VCORE (Komponen fisik besar di area PMIC)
            "l_vcore" => Some(ComponentProbe {
                id: "l_vcore",
                rail: RailId::Vcore,
                kind: ComponentKind::Inductor,
                parasitic_ohm: 0.005, // DCR sangat rendah
                diode_offset: -0.02,
            }),
            "tp_vbat" => Some(ComponentProbe {
                id: "tp_vbat",
                rail: RailId::Vbat,
                kind: ComponentKind::TestPoint,
                parasitic_ohm: 0.01,
                diode_offset: 0.0,
            }),
            "tp_vcore" => Some(ComponentProbe {
                id: "tp_vcore",
                rail: RailId::Vcore,
                kind: ComponentKind::TestPoint,
                parasitic_ohm: 0.01,
                diode_offset: 0.0,
            }),
            "tp_vio" => Some(ComponentProbe {
                id: "tp_vio",
                rail: RailId::Vio,
                kind: ComponentKind::TestPoint,
                parasitic_ohm: 0.01,
                diode_offset: 0.0,
            }),
            _ => None,
        }
    }

    pub fn measure_component(state: &mut PhoneState, mode: &str, component_id: &str) -> Option<f64> {
        let probe = Self::component_probe(component_id)?;
        let mode_key = mode.trim().to_lowercase();

        if mode_key.contains("diode") {
            return Some(Self::measure_component_diode(state, probe));
        }

        if mode_key.contains("ohm") || mode_key.contains("resistance") {
            return Some(Self::measure_component_resistance(state, probe));
        }

        if mode_key.contains("continuity") || mode_key.contains("beep") {
            return Some(Self::measure_component_continuity(state, probe));
        }

        Some(Self::measure_component_voltage(state, probe))
    }

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

    /// =======================
    /// DIODE MEASUREMENT
    /// =======================
    pub fn measure_diode(state: &mut PhoneState, rail: RailId) -> f64 {
        let rail_state = state
            .electrical
            .rails
            .get_mut(&rail)
            .expect("measure_diode: rail not found");

        // Typical diode test current
        let test_current = 0.002; // 2mA

        rail_state.load_current += test_current;

        let total_current = rail_state.load_current + rail_state.leakage_current;

        let epsilon = 0.000_001;

        // =======================
        // Base diode drop model
        // =======================
        let mut forward_voltage = if total_current < 0.001 + epsilon {
            // Open circuit (simulate OL)
            3.0
        } else if total_current > 2.0 {
            // Short condition
            0.02
        } else {
            // Normal semiconductor drop
            0.2 + (rail_state.esr * 0.5)
        };

        // =======================
        // Stress influence
        // =======================
        if state.stress.electrical > 0.7 {
            forward_voltage *= 1.05;
        }

        // =======================
        // Noise & jitter
        // =======================
        let noise =
            state.electrical.transient_noise * 0.1 +
            state.stress.measurement * 0.02;

        let jitter = (state.rng_f64() - 0.5) * 0.01;

        forward_voltage += noise + jitter;

        // Clamp display range
        if forward_voltage.is_nan() {
            forward_voltage = 3.0;
        }

        forward_voltage = forward_voltage.clamp(0.0, 3.0);

        // =======================
        // Log event
        // =======================
        state.measurements.history.push(
            crate::state::phone_state::MeasurementEvent {
                time: state.time,
                target: format!("DIODE_{:?}", rail),
                observed_value: forward_voltage,
                noise,
                injected_energy: test_current,
                stress_added: 0.001,
            }
        );

        state.stress.measurement += 0.001;

        forward_voltage
    }

    /// =======================
    /// OHM / RESISTANCE MEASUREMENT
    /// =======================
    pub fn measure_resistance(state: &mut PhoneState, rail: RailId) -> f64 {
        let rail_state = state
            .electrical
            .rails
            .get_mut(&rail)
            .expect("measure_resistance: rail not found");

        // Measurement fatigue
        let key = ("resistance".to_string(), format!("{:?}", rail));
        let count = state.fatigue.counts.entry(key.clone()).or_insert(0);
        *count += 1;
        let fatigue_factor = (*count as f64).min(10.0) * 0.04;

        // Small constant current source (typical DMM)
        let test_current = 0.001 + fatigue_factor * 0.0005; // 1.0mA -> 1.5mA
        rail_state.load_current += test_current;

        // If circuit is powered, reading becomes unreliable (OL)
        let live_voltage = rail_state.voltage.abs();
        let mut resistance = if live_voltage > 0.2 {
            1.0e9
        } else {
            // Approximate equivalent resistance to ground from leakage
            let nominal_v = rail_state.target_voltage.max(0.1);
            let leakage = rail_state.leakage_current.max(1e-6);
            let mut r_eq = nominal_v / leakage;

            // Add test lead/contact resistance
            r_eq += 0.2;

            // Compliance limit (~2V for many DMMs)
            if test_current * r_eq > 2.0 {
                r_eq = 1.0e9;
            }

            r_eq
        };

        // Noise & jitter (ohms)
        let noise =
            (state.electrical.transient_noise * 5.0) +
            (state.stress.measurement * 1.5) +
            fatigue_factor * 0.5;

        let jitter = (state.rng_f64() - 0.5) * (resistance * 0.02).min(5.0);

        resistance += noise + jitter;

        if resistance.is_nan() {
            resistance = 1.0e9;
        }

        resistance = resistance.clamp(0.0, 1.0e9);

        // Log event
        state.measurements.history.push(
            crate::state::phone_state::MeasurementEvent {
                time: state.time,
                target: format!("R({:?})", rail),
                observed_value: resistance,
                noise,
                injected_energy: test_current,
                stress_added: test_current * 0.5,
            }
        );

        state.stress.measurement += test_current * 0.5;

        resistance
    }

    /// =======================
    /// CONTINUITY MEASUREMENT
    /// =======================
    pub fn measure_continuity(state: &mut PhoneState, rail: RailId) -> f64 {
        let rail_state = state
            .electrical
            .rails
            .get_mut(&rail)
            .expect("measure_continuity: rail not found");

        // Measurement fatigue
        let key = ("continuity".to_string(), format!("{:?}", rail));
        let count = state.fatigue.counts.entry(key.clone()).or_insert(0);
        *count += 1;
        let fatigue_factor = (*count as f64).min(10.0) * 0.03;

        // Higher test current for continuity beeper
        let test_current = 0.003 + fatigue_factor * 0.001; // 3mA -> 4mA
        rail_state.load_current += test_current;

        // Treat live circuit as open (no beep)
        let live_voltage = rail_state.voltage.abs();
        let mut resistance = if live_voltage > 0.2 {
            1.0e9
        } else {
            let nominal_v = rail_state.target_voltage.max(0.1);
            let leakage = rail_state.leakage_current.max(1e-6);
            let mut r_eq = nominal_v / leakage;

            // Add contact resistance
            r_eq += 0.2;

            // Compliance limit
            if test_current * r_eq > 2.0 {
                r_eq = 1.0e9;
            }

            r_eq
        };

        // Continuity threshold (typical 30-50 ohm)
        let continuity_threshold = 50.0;
        if resistance > continuity_threshold {
            resistance = 1.0e9;
        }

        let noise =
            (state.electrical.transient_noise * 3.0) +
            (state.stress.measurement * 1.0) +
            fatigue_factor * 0.3;

        let jitter = (state.rng_f64() - 0.5) * 0.5;

        resistance += noise + jitter;

        if resistance.is_nan() {
            resistance = 1.0e9;
        }

        resistance = resistance.clamp(0.0, 1.0e9);

        // Log event
        state.measurements.history.push(
            crate::state::phone_state::MeasurementEvent {
                time: state.time,
                target: format!("CONT({:?})", rail),
                observed_value: resistance,
                noise,
                injected_energy: test_current,
                stress_added: test_current * 0.4,
            }
        );

        state.stress.measurement += test_current * 0.4;

        resistance
    }

    fn measure_component_voltage(state: &mut PhoneState, probe: ComponentProbe) -> f64 {
        let rail_state = state
            .electrical
            .rails
            .get_mut(&probe.rail)
            .expect("measure_component_voltage: rail not found");

        let key = ("component_voltage".to_string(), probe.id.to_string());
        let count = state.fatigue.counts.entry(key).or_insert(0);
        *count += 1;
        let fatigue_factor = (*count as f64).min(10.0) * 0.04;

        let base_probe_load = match probe.kind {
            ComponentKind::Capacitor => 0.008,
            ComponentKind::Resistor => 0.004,
            ComponentKind::Inductor => 0.005,
            ComponentKind::Trace => 0.002,
            ComponentKind::TestPoint => 0.001,
        };

        let probe_load = base_probe_load + fatigue_factor * 0.01;
        rail_state.load_current += probe_load;

        let local_drop = probe_load * (rail_state.esr + probe.parasitic_ohm);
        rail_state.voltage -= local_drop;

        let noise =
            rail_state.noise +
            state.electrical.transient_noise * 0.8 +
            fatigue_factor * 0.03;

        let mut observed = rail_state.voltage + noise;
        if observed.is_nan() {
            observed = 0.0;
        }

        state.measurements.history.push(MeasurementEvent {
            time: state.time,
            target: format!("V({})", probe.id),
            observed_value: observed,
            noise,
            injected_energy: probe_load,
            stress_added: probe_load,
        });

        state.last_voltage.insert(probe.rail, observed);
        state.stress.measurement += probe_load;
        apply_meta_effects(state);

        observed
    }

    fn measure_component_resistance(state: &mut PhoneState, probe: ComponentProbe) -> f64 {
        let rail_state = state
            .electrical
            .rails
            .get_mut(&probe.rail)
            .expect("measure_component_resistance: rail not found");

        let key = ("component_resistance".to_string(), probe.id.to_string());
        let count = state.fatigue.counts.entry(key).or_insert(0);
        *count += 1;
        let fatigue_factor = (*count as f64).min(10.0) * 0.03;

        let test_current = 0.001 + fatigue_factor * 0.0004;
        rail_state.load_current += test_current;

        let live_voltage = rail_state.voltage.abs();
        let mut resistance = if live_voltage > 0.2 {
            1.0e9
        } else {
            // Hitung resistansi ekuivalen rail (V / Leakage) untuk simulasi kapasitor
            let nominal_v = rail_state.target_voltage.max(0.1);
            let leakage = rail_state.leakage_current.max(1e-6);
            let rail_resistance = nominal_v / leakage;

            match probe.kind {
                // REVISI: Kapasitor membaca resistansi rail, bukan 3 ohm (kecuali short)
                ComponentKind::Capacitor => rail_resistance + probe.parasitic_ohm,
                ComponentKind::Resistor => probe.parasitic_ohm + (rail_state.esr * 2.0),
                ComponentKind::Inductor => probe.parasitic_ohm + rail_state.esr,
                ComponentKind::Trace => probe.parasitic_ohm + 0.05 + rail_state.esr,
                ComponentKind::TestPoint => 0.2 + rail_state.esr + probe.parasitic_ohm,
            }
        };

        let noise =
            state.electrical.transient_noise * 2.0 +
            state.stress.measurement * 0.8 +
            fatigue_factor * 0.2;

        let jitter = (state.rng_f64() - 0.5) * 0.4;
        resistance += noise + jitter;

        if resistance.is_nan() {
            resistance = 1.0e9;
        }
        resistance = resistance.clamp(0.0, 1.0e9);

        state.measurements.history.push(MeasurementEvent {
            time: state.time,
            target: format!("R({})", probe.id),
            observed_value: resistance,
            noise,
            injected_energy: test_current,
            stress_added: test_current * 0.4,
        });

        state.stress.measurement += test_current * 0.4;
        apply_meta_effects(state);

        resistance
    }

    fn measure_component_diode(state: &mut PhoneState, probe: ComponentProbe) -> f64 {
        let rail_state = state
            .electrical
            .rails
            .get_mut(&probe.rail)
            .expect("measure_component_diode: rail not found");

        let test_current = 0.002;
        rail_state.load_current += test_current;

        let mut forward_voltage = match probe.kind {
            ComponentKind::Capacitor => 1.8 + probe.diode_offset,
            ComponentKind::Resistor => 0.03 + probe.diode_offset,
            ComponentKind::Inductor => 0.005 + probe.diode_offset, // Hampir short
            ComponentKind::Trace => 0.02 + probe.diode_offset,
            ComponentKind::TestPoint => 0.25 + (rail_state.esr * 0.3) + probe.diode_offset,
        };

        if state.stress.electrical > 0.7 {
            forward_voltage *= 1.03;
        }

        let noise =
            state.electrical.transient_noise * 0.08 +
            state.stress.measurement * 0.015;
        let jitter = (state.rng_f64() - 0.5) * 0.01;

        forward_voltage += noise + jitter;
        forward_voltage = forward_voltage.clamp(0.0, 3.0);

        state.measurements.history.push(MeasurementEvent {
            time: state.time,
            target: format!("DIODE({})", probe.id),
            observed_value: forward_voltage,
            noise,
            injected_energy: test_current,
            stress_added: 0.001,
        });

        state.stress.measurement += 0.001;
        apply_meta_effects(state);

        forward_voltage
    }

    fn measure_component_continuity(state: &mut PhoneState, probe: ComponentProbe) -> f64 {
        let rail_state = state
            .electrical
            .rails
            .get_mut(&probe.rail)
            .expect("measure_component_continuity: rail not found");

        let test_current = 0.003;
        rail_state.load_current += test_current;

        let live_voltage = rail_state.voltage.abs();
        let mut resistance = if live_voltage > 0.2 {
            1.0e9
        } else {
            match probe.kind {
                ComponentKind::Capacitor => 1.0e9,
                ComponentKind::Resistor => probe.parasitic_ohm + 2.0,
                ComponentKind::Inductor => probe.parasitic_ohm + 0.1,
                ComponentKind::Trace => probe.parasitic_ohm + 0.2,
                ComponentKind::TestPoint => 0.8 + probe.parasitic_ohm,
            }
        };

        if resistance > 50.0 {
            resistance = 1.0e9;
        }

        let noise = state.electrical.transient_noise * 1.5 + state.stress.measurement * 0.5;
        let jitter = (state.rng_f64() - 0.5) * 0.3;
        resistance += noise + jitter;
        resistance = resistance.clamp(0.0, 1.0e9);

        state.measurements.history.push(MeasurementEvent {
            time: state.time,
            target: format!("CONT({})", probe.id),
            observed_value: resistance,
            noise,
            injected_energy: test_current,
            stress_added: test_current * 0.3,
        });

        state.stress.measurement += test_current * 0.3;
        apply_meta_effects(state);

        resistance
    }
}
