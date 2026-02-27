use crate::measurement::meta::apply_meta_effects;
use crate::state::ids::{RailId, ThermalZoneId};
use crate::state::phone_state::*;
use crate::util::rng::XorShift64;

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
    #[inline]
    fn hash_label_64(label: &str) -> u64 {
        let mut h = 1469598103934665603u64;
        for b in label.as_bytes() {
            h ^= *b as u64;
            h = h.wrapping_mul(1099511628211u64);
        }
        h
    }

    #[inline]
    fn deterministic_measurement_rng(state: &PhoneState, target: &str) -> XorShift64 {
        let time_bits = state.time.to_bits();
        let sample_index = state.measurements.history.len() as u64;
        let seed = time_bits
            ^ sample_index.rotate_left(17)
            ^ Self::hash_label_64(target).rotate_left(31)
            ^ 0xD6E8FEB86659FD93u64;
        XorShift64::new(seed)
    }

    #[inline]
    fn dmm_voltage_range(abs_true: f64) -> (f64, f64) {
        if abs_true < 0.6_f64 {
            (0.6_f64, 0.0001_f64)
        } else if abs_true < 6.0_f64 {
            (6.0_f64, 0.001_f64)
        } else if abs_true < 60.0_f64 {
            (60.0_f64, 0.01_f64)
        } else {
            (600.0_f64, 0.1_f64)
        }
    }

    #[inline]
    fn quantize(value: f64, step: f64) -> f64 {
        if step <= 0.0_f64 {
            value
        } else {
            (value / step).round() * step
        }
    }

    fn multimeter_voltage_noise(
        state: &PhoneState,
        target: &str,
        true_voltage: f64,
        rail_noise: f64,
    ) -> (f64, f64) {
        let abs_true = true_voltage.abs();
        let (range, lsd) = Self::dmm_voltage_range(abs_true);
        let mut rng = Self::deterministic_measurement_rng(state, target);

        let condition = (state.electrical.transient_noise.abs() + rail_noise.abs()).min(1.0_f64);
        let range_error = range * 0.0002_f64;
        let reading_error = abs_true * 0.0010_f64;
        let condition_error = condition * range * 0.0005_f64;
        let systematic =
            rng.uniform(-1.0_f64, 1.0_f64) * (range_error + reading_error + condition_error);

        let jitter_span = lsd * (0.5_f64 + condition * 3.0_f64);
        let jitter = rng.uniform(-jitter_span, jitter_span);

        let raw = true_voltage + systematic + jitter;
        let quantized = Self::quantize(raw, lsd).clamp(-range, range);
        let noise = quantized - true_voltage;
        (quantized, noise)
    }

    fn component_probe(component_id: &str) -> Option<ComponentProbe> {
        match component_id.trim().to_lowercase().as_str() {
            "c_vbat_in" => Some(ComponentProbe {
                id: "c_vbat_in",
                rail: RailId::Vbat,
                kind: ComponentKind::Capacitor,
                parasitic_ohm: 0.08_f64,
                diode_offset: 0.15_f64,
            }),
            "c_vcore_out" => Some(ComponentProbe {
                id: "c_vcore_out",
                rail: RailId::Vcore,
                kind: ComponentKind::Capacitor,
                parasitic_ohm: 0.05_f64,
                diode_offset: 0.12_f64,
            }),
            "r_vcore_fb" => Some(ComponentProbe {
                id: "r_vcore_fb",
                rail: RailId::Vcore,
                kind: ComponentKind::Resistor,
                parasitic_ohm: 47.0_f64,
                diode_offset: -0.05_f64,
            }),
            "r_vbat_sense" => Some(ComponentProbe {
                id: "r_vbat_sense",
                rail: RailId::Vbat,
                kind: ComponentKind::Resistor,
                parasitic_ohm: 0.01_f64, // sense resistor ~10mΩ
                diode_offset: -0.06_f64,
            }),
            "j_vbat_main" => Some(ComponentProbe {
                id: "j_vbat_main",
                rail: RailId::Vbat,
                kind: ComponentKind::Trace,
                parasitic_ohm: 0.02_f64,
                diode_offset: -0.10_f64,
            }),
            "j_vcore_phase" => Some(ComponentProbe {
                id: "j_vcore_phase",
                rail: RailId::Vcore,
                kind: ComponentKind::Trace,
                parasitic_ohm: 0.03_f64,
                diode_offset: -0.08_f64,
            }),
            "l_vcore" => Some(ComponentProbe {
                id: "l_vcore",
                rail: RailId::Vcore,
                kind: ComponentKind::Inductor,
                parasitic_ohm: 0.005_f64, // DCR rendah
                diode_offset: -0.02_f64,
            }),
            "tp_vbat" => Some(ComponentProbe {
                id: "tp_vbat",
                rail: RailId::Vbat,
                kind: ComponentKind::TestPoint,
                parasitic_ohm: 0.01_f64,
                diode_offset: 0.0_f64,
            }),
            "tp_vcore" => Some(ComponentProbe {
                id: "tp_vcore",
                rail: RailId::Vcore,
                kind: ComponentKind::TestPoint,
                parasitic_ohm: 0.01_f64,
                diode_offset: 0.0_f64,
            }),
            "tp_vio" => Some(ComponentProbe {
                id: "tp_vio",
                rail: RailId::Vio,
                kind: ComponentKind::TestPoint,
                parasitic_ohm: 0.01_f64,
                diode_offset: 0.0_f64,
            }),
            _ => None,
        }
    }

    pub fn measure_component(
        state: &mut PhoneState,
        mode: &str,
        component_id: &str,
    ) -> Option<f64> {
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
            .get(&rail)
            .expect("measure_voltage: requested rail not found");
        let true_voltage = rail_state.state.voltage;
        let rail_noise = rail_state.noise;
        let target = format!("V({:?})", rail);
        let (observed, noise) =
            Self::multimeter_voltage_noise(state, &target, true_voltage, rail_noise);

        state.measurements.history.push(MeasurementEvent {
            time: state.time,
            target,
            observed_value: observed,
            noise,
            injected_energy: 0.0_f64,
            stress_added: 0.0_f64,
        });

        state.last_voltage.insert(rail, observed);
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

        let key = ("temperature".to_string(), format!("{:?}", zone));
        let count = state.fatigue.counts.entry(key).or_insert(0);
        *count += 1;

        let fatigue_factor: f64 = (*count as f64).min(10.0_f64) * 0.03_f64;

        let injected: f64 = 0.001_f64 + fatigue_factor * 0.0015_f64;
        state.stress.measurement += injected;

        // probe distortion
        z.temperature += fatigue_factor * 0.1_f64;

        let noise: f64 = state.electrical.transient_noise * 0.5_f64
            + state.stress.thermal * 0.02_f64
            + fatigue_factor * 0.1_f64;

        let observed: f64 = z.temperature + noise;

        state.measurements.history.push(MeasurementEvent {
            time: state.time,
            target: format!("T({:?})", zone),
            observed_value: observed,
            noise,
            injected_energy: injected,
            stress_added: injected,
        });

        state.last_temperature.insert(zone, observed);

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
        let test_current: f64 = 0.002_f64; // 2mA
        rail_state.state.current += test_current;

        // Baseline dari expected profile
        let mut forward_voltage: f64 = rail_state.diode_drop_nominal();

        // Stress influence
        if state.stress.electrical > 0.7_f64 {
            forward_voltage *= 1.05_f64;
        }

        // Noise & jitter
        let noise: f64 =
            state.electrical.transient_noise * 0.1_f64 + state.stress.measurement * 0.02_f64;

        let jitter: f64 = (state.rng_f64() - 0.5_f64) * 0.01_f64;

        forward_voltage += noise + jitter;

        if forward_voltage.is_nan() {
            forward_voltage = 3.0_f64;
        }
        forward_voltage = forward_voltage.clamp(0.0_f64, 3.0_f64);

        state.measurements.history.push(MeasurementEvent {
            time: state.time,
            target: format!("DIODE_{:?}", rail),
            observed_value: forward_voltage,
            noise,
            injected_energy: test_current,
            stress_added: 0.001_f64,
        });

        state.stress.measurement += 0.001_f64;

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

        let key = ("resistance".to_string(), format!("{:?}", rail));
        let count = state.fatigue.counts.entry(key).or_insert(0);
        *count += 1;

        let fatigue_factor: f64 = (*count as f64).min(10.0_f64) * 0.04_f64;

        // DMM current source
        let test_current: f64 = 0.001_f64 + fatigue_factor * 0.0005_f64;
        rail_state.state.current += test_current;

        // If powered, DMM ohm mode jadi OL / unreliable
        let live_voltage: f64 = rail_state.state.voltage.abs();

        let mut resistance: f64 = if live_voltage > 0.2_f64 {
            1.0e9_f64
        } else {
            // R2G is source of truth
            let mut r_eq: f64 = rail_state.health.resistance_to_ground.max(1e-6_f64);

            // Lead/contact resistance
            r_eq += 0.2_f64;

            // compliance limit (approx 2V)
            if test_current * r_eq > 2.0_f64 {
                1.0e9_f64
            } else {
                r_eq
            }
        };

        let noise: f64 = (state.electrical.transient_noise * 5.0_f64)
            + (state.stress.measurement * 1.5_f64)
            + fatigue_factor * 0.5_f64;

        let jitter: f64 = (state.rng_f64() - 0.5_f64) * (resistance * 0.02_f64).min(5.0_f64);

        resistance += noise + jitter;

        if resistance.is_nan() {
            resistance = 1.0e9_f64;
        }
        resistance = resistance.clamp(0.0_f64, 1.0e9_f64);

        state.measurements.history.push(MeasurementEvent {
            time: state.time,
            target: format!("R({:?})", rail),
            observed_value: resistance,
            noise,
            injected_energy: test_current,
            stress_added: test_current * 0.5_f64,
        });

        state.stress.measurement += test_current * 0.5_f64;

        resistance
    }

    /// =======================
    /// CONTINUITY MEASUREMENT
    /// =======================
    /// Return value: "ohms display".
    /// - Jika > threshold, dianggap OL (1e9) → tidak beep.
    pub fn measure_continuity(state: &mut PhoneState, rail: RailId) -> f64 {
        let rail_state = state
            .electrical
            .rails
            .get_mut(&rail)
            .expect("measure_continuity: rail not found");

        let key = ("continuity".to_string(), format!("{:?}", rail));
        let count = state.fatigue.counts.entry(key).or_insert(0);
        *count += 1;

        let fatigue_factor: f64 = (*count as f64).min(10.0_f64) * 0.03_f64;

        // continuity current sedikit lebih tinggi
        let test_current: f64 = 0.003_f64 + fatigue_factor * 0.001_f64;
        rail_state.state.current += test_current;

        let live_voltage: f64 = rail_state.state.voltage.abs();

        let mut resistance: f64 = if live_voltage > 0.2_f64 {
            1.0e9_f64
        } else {
            let mut r_eq: f64 = rail_state.health.resistance_to_ground.max(1e-6_f64);
            r_eq += 0.2_f64;

            if test_current * r_eq > 2.0_f64 {
                1.0e9_f64
            } else {
                r_eq
            }
        };

        let continuity_threshold: f64 = rail_state.expected.continuity_beep_below_ohms.max(1.0_f64);

        // Tidak beep → tampilkan OL
        if resistance > continuity_threshold {
            resistance = 1.0e9_f64;
        }

        let noise: f64 = (state.electrical.transient_noise * 3.0_f64)
            + (state.stress.measurement * 1.0_f64)
            + fatigue_factor * 0.3_f64;

        let jitter: f64 = (state.rng_f64() - 0.5_f64) * 0.5_f64;

        resistance += noise + jitter;

        if resistance.is_nan() {
            resistance = 1.0e9_f64;
        }
        resistance = resistance.clamp(0.0_f64, 1.0e9_f64);

        state.measurements.history.push(MeasurementEvent {
            time: state.time,
            target: format!("CONT({:?})", rail),
            observed_value: resistance,
            noise,
            injected_energy: test_current,
            stress_added: test_current * 0.4_f64,
        });

        state.stress.measurement += test_current * 0.4_f64;

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

        let fatigue_factor: f64 = (*count as f64).min(10.0_f64) * 0.04_f64;

        let base_probe_load: f64 = match probe.kind {
            ComponentKind::Capacitor => 0.008_f64,
            ComponentKind::Resistor => 0.004_f64,
            ComponentKind::Inductor => 0.005_f64,
            ComponentKind::Trace => 0.002_f64,
            ComponentKind::TestPoint => 0.001_f64,
        };

        let probe_load: f64 = base_probe_load + fatigue_factor * 0.01_f64;
        rail_state.state.current += probe_load;

        let local_drop: f64 = probe_load * (rail_state.health.esr + probe.parasitic_ohm);
        rail_state.state.voltage -= local_drop;

        let noise: f64 = rail_state.noise
            + state.electrical.transient_noise * 0.8_f64
            + fatigue_factor * 0.03_f64;

        let mut observed: f64 = rail_state.state.voltage + noise;
        if observed.is_nan() {
            observed = 0.0_f64;
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

        let fatigue_factor: f64 = (*count as f64).min(10.0_f64) * 0.03_f64;

        let test_current: f64 = 0.001_f64 + fatigue_factor * 0.0004_f64;
        rail_state.state.current += test_current;

        let live_voltage: f64 = rail_state.state.voltage.abs();
        let mut resistance: f64 = if live_voltage > 0.2_f64 {
            1.0e9_f64
        } else {
            // NODE/RAIL based: pakai R2G rail + parasitik kecil
            let mut r_eq: f64 = rail_state.health.resistance_to_ground.max(1e-6_f64);

            // parasitik sesuai titik probe (trace/coil/pad)
            r_eq += probe.parasitic_ohm;

            // contact/lead
            r_eq += 0.2_f64;

            // compliance
            if test_current * r_eq > 2.0_f64 {
                1.0e9_f64
            } else {
                r_eq
            }
        };

        let noise: f64 = state.electrical.transient_noise * 2.0_f64
            + state.stress.measurement * 0.8_f64
            + fatigue_factor * 0.2_f64;

        let jitter: f64 = (state.rng_f64() - 0.5_f64) * 0.4_f64;

        resistance += noise + jitter;

        if resistance.is_nan() {
            resistance = 1.0e9_f64;
        }
        resistance = resistance.clamp(0.0_f64, 1.0e9_f64);

        state.measurements.history.push(MeasurementEvent {
            time: state.time,
            target: format!("R({})", probe.id),
            observed_value: resistance,
            noise,
            injected_energy: test_current,
            stress_added: test_current * 0.4_f64,
        });

        state.stress.measurement += test_current * 0.4_f64;

        apply_meta_effects(state);
        resistance
    }

    fn measure_component_diode(state: &mut PhoneState, probe: ComponentProbe) -> f64 {
        let rail_state = state
            .electrical
            .rails
            .get_mut(&probe.rail)
            .expect("measure_component_diode: rail not found");

        let test_current: f64 = 0.002_f64;
        rail_state.state.current += test_current;

        // NODE-based baseline: gunakan rail expected nominal, lalu offset parasitik probe
        let mut forward_voltage: f64 = rail_state.diode_drop_nominal() + probe.diode_offset;

        // jenis komponen hanya mempengaruhi sedikit (parasitik), bukan nilai utama
        match probe.kind {
            ComponentKind::Inductor => forward_voltage -= 0.02_f64,
            ComponentKind::Trace => forward_voltage -= 0.01_f64,
            _ => {}
        }

        if state.stress.electrical > 0.7_f64 {
            forward_voltage *= 1.03_f64;
        }

        let noise: f64 =
            state.electrical.transient_noise * 0.08_f64 + state.stress.measurement * 0.015_f64;

        let jitter: f64 = (state.rng_f64() - 0.5_f64) * 0.01_f64;

        forward_voltage += noise + jitter;

        if forward_voltage.is_nan() {
            forward_voltage = 3.0_f64;
        }
        forward_voltage = forward_voltage.clamp(0.0_f64, 3.0_f64);

        state.measurements.history.push(MeasurementEvent {
            time: state.time,
            target: format!("DIODE({})", probe.id),
            observed_value: forward_voltage,
            noise,
            injected_energy: test_current,
            stress_added: 0.001_f64,
        });

        state.stress.measurement += 0.001_f64;

        apply_meta_effects(state);
        forward_voltage
    }

    fn measure_component_continuity(state: &mut PhoneState, probe: ComponentProbe) -> f64 {
        let rail_state = state
            .electrical
            .rails
            .get_mut(&probe.rail)
            .expect("measure_component_continuity: rail not found");

        let test_current: f64 = 0.003_f64;
        rail_state.state.current += test_current;

        let live_voltage: f64 = rail_state.state.voltage.abs();

        let mut resistance: f64 = if live_voltage > 0.2_f64 {
            1.0e9_f64
        } else {
            // continuity pada node rail: pakai R2G + parasitik probe kecil
            let mut r_eq: f64 = rail_state.health.resistance_to_ground.max(1e-6_f64);
            r_eq += probe.parasitic_ohm;
            r_eq += 0.2_f64;

            if test_current * r_eq > 2.0_f64 {
                1.0e9_f64
            } else {
                r_eq
            }
        };

        let threshold: f64 = rail_state.expected.continuity_beep_below_ohms.max(1.0_f64);
        if resistance > threshold {
            resistance = 1.0e9_f64;
        }

        let noise: f64 =
            state.electrical.transient_noise * 1.5_f64 + state.stress.measurement * 0.5_f64;

        let jitter: f64 = (state.rng_f64() - 0.5_f64) * 0.3_f64;

        resistance += noise + jitter;

        if resistance.is_nan() {
            resistance = 1.0e9_f64;
        }
        resistance = resistance.clamp(0.0_f64, 1.0e9_f64);

        state.measurements.history.push(MeasurementEvent {
            time: state.time,
            target: format!("CONT({})", probe.id),
            observed_value: resistance,
            noise,
            injected_energy: test_current,
            stress_added: test_current * 0.3_f64,
        });

        state.stress.measurement += test_current * 0.3_f64;

        apply_meta_effects(state);
        resistance
    }
}
