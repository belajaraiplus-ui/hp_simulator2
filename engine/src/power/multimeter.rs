use crate::api::types::MeterMode;
use crate::state::phone_state::PhoneState;
use crate::util::rng::XorShift64;

/// Represents a digital multimeter (DMM) with its own internal state and logic.
pub struct Multimeter;

impl Multimeter {
    /// Batas maksimal pembacaan resistansi (40 MOhm) sebelum Overload (OL).
    pub const OHM_LIMIT: f64 = 40_000_000.0;

    /// Membulatkan nilai ke step terdekat.
    pub fn quantize(x: f64, step: f64) -> f64 {
        if step <= 0.0 {
            return x;
        }
        (x / step).round() * step
    }

    /// Menentukan resolusi (step terkecil) berdasarkan magnitude tegangan (Auto-Range).
    pub fn voltage_resolution(v: f64) -> f64 {
        let a = v.abs().max(0.0);
        if a <= 2.0 {
            0.001
        }
        // Range 2V   -> 1 mV
        else if a <= 20.0 {
            0.01
        }
        // Range 20V  -> 10 mV
        else if a <= 200.0 {
            0.1
        }
        // Range 200V -> 100 mV
        else {
            1.0
        } // Range 600V+ -> 1 V
    }

    /// Menentukan resolusi untuk mode Resistansi (Ohm) berdasarkan magnitude.
    pub fn ohm_resolution(r: f64) -> f64 {
        let a = r.abs().max(0.0);
        if a <= 200.0 {
            0.1
        } else if a <= 2_000.0 {
            1.0
        } else if a <= 20_000.0 {
            10.0
        } else if a <= 200_000.0 {
            100.0
        } else {
            1000.0
        }
    }

    /// Menentukan resolusi untuk mode Arus (Current) berdasarkan magnitude.
    pub fn current_resolution(i: f64) -> f64 {
        let a = i.abs().max(0.0);
        if a <= 0.2 {
            0.0001
        }
        // Range 200mA  -> 0.1 mA
        else if a <= 2.0 {
            0.001
        }
        // Range 2A     -> 1 mA
        else if a <= 10.0 {
            0.01
        }
        // Range 10A    -> 10 mA
        else {
            0.1
        } // Range >10A   -> 100 mA
    }

    /// Menentukan resolusi untuk mode Suhu (Temperature) dalam Celsius.
    pub fn temperature_resolution(t: f64) -> f64 {
        let a = t.abs().max(0.0);
        if a <= 200.0 {
            0.1
        }
        // Range rendah -> 0.1°C
        else {
            1.0
        } // Range tinggi -> 1°C
    }

    /// Menghitung pembacaan alat ukur dengan noise dan kuantisasi.
    pub fn update_reading(state: &mut PhoneState) {
        let electrical = &mut state.electrical;
        electrical.meter_beep = false;
        if !electrical.meter_attached {
            electrical.meter_reading = 0.0;
            electrical.meter_resolution = 0.0;
            return;
        }

        let Some(mode) = electrical.meter_mode else {
            return;
        };
        let Some(target_id) = electrical.meter_target else {
            return;
        };
        let Some(rail) = electrical.rails.get(&target_id) else {
            return;
        };

        match mode {
            MeterMode::Voltage => {
                let raw_v = rail.state.voltage;
                let res = Self::voltage_resolution(raw_v);

                let seed = electrical.tick ^ 0x5EED_BA5E_0000_0000;
                let mut rng = XorShift64::new(seed);

                let ilim = electrical.input.current_limit.max(0.1);
                let stress = (electrical.input.measured_current / ilim).clamp(0.0, 1.0);

                let offset = rng.uniform(-2.0 * res, 2.0 * res);
                let jitter_span = (3.0 + 17.0 * stress) * res;
                let jitter = rng.uniform(-jitter_span, jitter_span);

                electrical.meter_reading = Self::quantize(raw_v + offset + jitter, res);
                electrical.meter_resolution = res;
            }

            MeterMode::Resistance => {
                let raw_r = rail.r2g_ohms();
                let res = Self::ohm_resolution(raw_r);

                let seed = electrical.tick ^ 0x0111_0000_0000_0000;
                let mut rng = XorShift64::new(seed);

                let noise_multiplier = (raw_r / 2000.0).max(1.0).min(100.0);
                let offset = rng.uniform(-1.0 * res, 1.0 * res);
                let jitter_span = (2.0 * noise_multiplier) * res;
                let jitter = rng.uniform(-jitter_span, jitter_span);

                let val = Self::quantize((raw_r + offset + jitter).max(0.0), res);
                if val > Self::OHM_LIMIT {
                    electrical.meter_reading = f64::INFINITY;
                } else {
                    electrical.meter_reading = val;
                }
                electrical.meter_resolution = res;
            }

            MeterMode::Diode => {
                let raw_v = rail.state.voltage;
                let res = 0.001;

                let seed = electrical.tick ^ 0xD10D_0000_0000_0000;
                let mut rng = XorShift64::new(seed);

                let ilim = electrical.input.current_limit.max(0.1);
                let stress = (electrical.input.measured_current / ilim).clamp(0.0, 1.0);

                let base = if rail.status == crate::power::rail::RailStatus::ShortToGnd {
                    0.005
                } else if raw_v.abs() < 0.3 {
                    0.55
                } else {
                    1.20
                };

                let jitter_range = 0.02 + 0.08 * stress;
                let jitter = rng.uniform(-jitter_range, jitter_range);

                electrical.meter_reading = Self::quantize((base + jitter).max(0.0), res);
                electrical.meter_resolution = res;
            }

            MeterMode::Continuity => {
                let raw_r = rail.r2g_ohms();
                let res = 0.1;

                let seed = electrical.tick ^ 0xBEEB_0000_0000_0000;
                let mut rng = XorShift64::new(seed);

                electrical.meter_beep = rail.continuity_beep();

                let jitter = rng.uniform(-2.0, 2.0);
                let val = Self::quantize((raw_r + jitter).max(0.0), res);
                if val > Self::OHM_LIMIT {
                    electrical.meter_reading = f64::INFINITY;
                } else {
                    electrical.meter_reading = val;
                }
                electrical.meter_resolution = res;
            }

            MeterMode::Current => {
                let raw_i = rail.state.current;
                let res = Self::current_resolution(raw_i);

                let seed = electrical.tick ^ 0xC0FF_0000_0000u64;
                let mut rng = XorShift64::new(seed);

                let burden_v = raw_i * 0.1;
                let burden_error = burden_v * 0.02;

                let ilim = electrical.input.current_limit.max(0.1);
                let stress = (electrical.input.measured_current / ilim).clamp(0.0, 1.0);

                let offset = rng.uniform(-burden_error, burden_error);
                let jitter_span = (0.5 + 2.0 * stress) * res;
                let jitter = rng.uniform(-jitter_span, jitter_span);

                let val = Self::quantize(raw_i + offset + jitter, res);
                if val < 0.0 {
                    electrical.meter_reading = f64::INFINITY;
                } else {
                    electrical.meter_reading = val;
                }
                electrical.meter_resolution = res;
            }

            MeterMode::Temperature => {
                let zone_id = format!("{:?}", target_id);
                let raw_t = state
                    .thermal
                    .zones
                    .get(&zone_id)
                    .map(|z| z.temp_c)
                    .unwrap_or(state.thermal.average());
                let res = Self::temperature_resolution(raw_t);

                let seed = electrical.tick ^ 0xDEAD_0000_0000u64;
                let mut rng = XorShift64::new(seed);

                let cjc_error = rng.uniform(-1.5, 1.5);
                let noise = rng.uniform(-0.3, 0.3);
                let drift = (electrical.tick as f64 * 0.001).sin() * 0.2;

                let val = Self::quantize(raw_t + cjc_error + noise + drift, res);
                electrical.meter_reading = val;
                electrical.meter_resolution = res;
            }
        }
    }
}
