use crate::core::engine::Engine as CoreEngine;
use crate::session::state::SessionState;
use crate::state::bootstrap::bootstrap_state;
use crate::state::phone_state::PhoneState;
use crate::world::presets::get_profile_by_scenario;
use crate::world::profile::apply_world_profile;

use crate::measurement::engine::MeasurementEngine;
use crate::power::profile_loader;
use crate::state::ids::{RailId, ThermalZoneId};
use crate::util::rng::XorShift64;

use crate::api::types::{ActionRequest, MeterMode, ToolAction};
use serde_json::{json, Value};

pub struct WasmContext {
    pub engine: CoreEngine,
    pub phone: PhoneState,
    pub session: SessionState,
    pub current_scenario: String,
}

impl WasmContext {
    #[inline]
    fn quantize(x: f64, step: f64) -> f64 {
        if step <= 0.0_f64 {
            return x;
        }
        (x / step).round() * step
    }

    fn hash_label_64(label: &str) -> u64 {
        let mut h = 1469598103934665603u64;
        for b in label.as_bytes() {
            h ^= *b as u64;
            h = h.wrapping_mul(1099511628211u64);
        }
        h
    }

    fn measure_voltage_with_noise(true_v: f64, measured_current: f64, seed: u64) -> f64 {
        let mut rng = XorShift64::new(seed);
        let abs_v = true_v.abs();
        let (range, step) = if abs_v < 6.0_f64 {
            (6.0_f64, 0.001_f64)
        } else if abs_v < 60.0_f64 {
            (60.0_f64, 0.01_f64)
        } else {
            (600.0_f64, 0.1_f64)
        };

        let current_factor = (measured_current.abs() / 3.0_f64).clamp(0.0_f64, 1.0_f64);
        let offset = rng.uniform(-1.0_f64, 1.0_f64) * step * (0.5_f64 + 1.5_f64 * current_factor);
        let jitter = rng.uniform(-1.0_f64, 1.0_f64) * step * (1.0_f64 + 3.0_f64 * current_factor);
        let v = true_v + offset + jitter;
        Self::quantize(v, step).clamp(-range, range)
    }

    pub fn new(dt: f64) -> Self {
        Self {
            engine: CoreEngine { dt },
            phone: bootstrap_state(),
            session: SessionState::new(),
            current_scenario: "default".to_string(),
        }
    }

    pub fn load_scenario(&mut self, scenario_id: &str) -> Value {
        let profile = get_profile_by_scenario(scenario_id);
        apply_world_profile(&mut self.phone, profile);
        self.current_scenario = scenario_id.to_string();

        json!({
            "ok": true,
            "message": format!("Scenario '{}' loaded. World: {}", scenario_id, profile.name),
            "profile": {
                "name": profile.name,
                "ambient_temperature": profile.ambient_temperature,
                "humidity_factor": profile.humidity_factor,
                "emi_noise_floor": profile.emi_noise_floor,
                "device_age_factor": profile.device_age_factor,
                "prior_repair_factor": profile.prior_repair_factor,
                "psu_quality": profile.psu_quality,
                "ground_integrity": profile.ground_integrity,
                "thermal_dissipation": profile.thermal_dissipation,
                "thermal_coupling": profile.thermal_coupling,
                "measurement_bias": profile.measurement_bias,
            }
        })
    }

    // Normalisasi label dari UI (contoh: "VBAT (Battery)" atau "voltage")
    fn normalize(label: &str) -> String {
        label.trim().to_lowercase()
    }

    fn resolve_rail(label: &str) -> RailId {
        if label.contains("vcore") || label.contains("core") {
            RailId::Vcore
        } else if label.contains("vio") || label == "vio" {
            RailId::Vio
        } else if label.contains("vbat") || label.contains("battery") {
            RailId::Vbat
        } else {
            RailId::Vbat
        }
    }

    fn parse_component_query(label: &str) -> Option<(String, String)> {
        let marker = "comp:";
        let idx = label.find(marker)?;
        let mode = label[..idx].trim().to_string();
        let component = label[idx + marker.len()..].trim().to_string();
        if component.is_empty() {
            return None;
        }
        Some((mode, component))
    }

    /// Semua measurement HARUS lewat MeasurementEngine
    /// Return langsung ANGKA (agar kompatibel UI lama)
    pub fn measure(&mut self, req: &ActionRequest) -> Value {
        let raw = req.tool.as_deref().unwrap_or("");
        let t = Self::normalize(raw);
        let rail = Self::resolve_rail(&t);

        // tolerant matching: terima "voltage" sebagai synonym umum
        let value: Option<f64> = if let Some((mode, component)) = Self::parse_component_query(&t) {
            MeasurementEngine::measure_component(&mut self.phone, &mode, &component)
        } else if t.contains("diode") {
            const DIODE_INJECT_A: f64 = 0.006;
            const DIODE_NOISE_BUMP: f64 = 0.05;
            if let Some(r) = self.phone.electrical.rails.get_mut(&rail) {
                r.state.extra_load_a += DIODE_INJECT_A;
            }
            self.phone.electrical.transient_noise += DIODE_NOISE_BUMP;
            self.phone.stress.electrical += 0.003;
            Some(MeasurementEngine::measure_diode(&mut self.phone, rail))
        } else if t.contains("ohm") || t.contains("resistance") {
            Some(MeasurementEngine::measure_resistance(&mut self.phone, rail))
        } else if t.contains("continuity") || t.contains("beep") {
            const CONTINUITY_INJECT_A: f64 = 0.08;
            const CONTINUITY_NOISE_BUMP: f64 = 0.15;
            if let Some(r) = self.phone.electrical.rails.get_mut(&rail) {
                r.state.extra_load_a += CONTINUITY_INJECT_A;
            }
            self.phone.electrical.transient_noise += CONTINUITY_NOISE_BUMP;
            self.phone.stress.electrical += 0.01;
            Some(MeasurementEngine::measure_continuity(&mut self.phone, rail))
        } else if t.contains("vbat") || t.contains("battery") || t == "voltage" {
            Some(MeasurementEngine::measure_voltage(&mut self.phone, rail))
        } else if t.contains("vcore") || t.contains("core") {
            Some(MeasurementEngine::measure_voltage(&mut self.phone, rail))
        } else if t.contains("vio") || t == "vio" {
            Some(MeasurementEngine::measure_voltage(&mut self.phone, rail))
        } else if t.contains("soc") && (t.contains("temp") || t == "soc") {
            Some(MeasurementEngine::measure_temperature(
                &mut self.phone,
                ThermalZoneId::Soc,
            ))
        } else if t.contains("board") && (t.contains("temp") || t == "board") {
            Some(MeasurementEngine::measure_temperature(
                &mut self.phone,
                ThermalZoneId::Board,
            ))
        } else if t.is_empty() {
            return json!({ "error": "Empty measurement target" });
        } else {
            None
        };

        match value {
            // UI lama mengharapkan: measurement = <angka>
            Some(v) => json!(v),

            None => json!({
                "error": "Unknown measurement target",
                "target": raw
            }),
        }
    }

    // ============================================
    // TOOL CONTROL (PSU etc.)
    // ============================================
    pub fn apply_tool_action(&mut self, req: &ActionRequest) -> Value {
        if let Some(action) = &req.tool_action {
            match action {
                ToolAction::TogglePSU { enabled } => {
                    self.phone.electrical.input.enabled = *enabled;
                    return json!({ "ok": true });
                }
                ToolAction::ToggleVCHG { enabled } => {
                    self.phone.electrical.input.vchg_enabled = *enabled;
                    return json!({ "ok": true });
                }
                ToolAction::SetVCHGVoltage { voltage } => {
                    self.phone.electrical.input.vchg_voltage = *voltage;
                    return json!({ "ok": true });
                }
                ToolAction::SetPSUVoltage { voltage } => {
                    self.phone.electrical.input.voltage = *voltage;
                    return json!({ "ok": true });
                }
                ToolAction::SetPSUCurrent { current } => {
                    self.phone.electrical.input.current_limit = *current;
                    return json!({ "ok": true });
                }
                ToolAction::ReadPSU {} => {
                    let seed = self.phone.electrical.tick ^ 0xBEEF_1234u64;
                    let mut rng = XorShift64::new(seed);

                    let i = self.phone.electrical.input.measured_current;
                    let noisy_i =
                        (i + i * rng.uniform(-0.01_f64, 0.01_f64) + rng.uniform(-0.005_f64, 0.005_f64))
                            .max(0.0_f64);

                    return json!({
                        "ok": true,
                        "enabled": self.phone.electrical.input.enabled,
                        "v_set": self.phone.electrical.input.voltage,
                        "i_limit": self.phone.electrical.input.current_limit,
                        "i_meas": Self::quantize(noisy_i, 0.001_f64)
                    });
                }
                ToolAction::LoadTopologyGraph { topology } => {
                    return match serde_json::to_string(topology) {
                        Ok(json_text) => {
                            profile_loader::load_topology_into_graph(&json_text, &mut self.phone);
                            json!({ "ok": true })
                        }
                        Err(e) => json!({
                            "ok": false,
                            "message": format!("Invalid topology payload: {}", e)
                        }),
                    };
                }
                ToolAction::SetPSUTargetRail { rail } => {
                    let trimmed = rail.trim();
                    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("none") {
                        self.phone.electrical.input.target_rail = None;
                        return json!({ "ok": true });
                    }

                    return match RailId::from_str(trimmed) {
                        Some(id) => {
                            self.phone.electrical.input.target_rail = Some(id);
                            json!({ "ok": true })
                        }
                        None => json!({ "ok": false, "message": format!("Unknown rail id: {}", trimmed) }),
                    };
                }
                ToolAction::ClearPSUTargetRail {} => {
                    self.phone.electrical.input.target_rail = None;
                    return json!({ "ok": true });
                }
                ToolAction::MultimeterAttach { mode, point } => {
                    let id = RailId::from_str(point.as_str());
                    if id.is_none() {
                        return json!({
                            "ok": false,
                            "message": "Unknown measurement point",
                            "point": point
                        });
                    }
                    self.phone.electrical.meter_attached = true;
                    self.phone.electrical.meter_mode = Some(*mode);
                    self.phone.electrical.meter_target = id;
                    return json!({ "ok": true });
                }
                ToolAction::MultimeterDetach {} => {
                    self.phone.electrical.meter_attached = false;
                    self.phone.electrical.meter_mode = None;
                    self.phone.electrical.meter_target = None;
                    return json!({ "ok": true });
                }
                ToolAction::MultimeterMeasure { mode, a, b } => {
                    let rail_a = match RailId::from_str(a.as_str()) {
                        Some(r) => r,
                        None => {
                            return json!({
                                "ok": false,
                                "message": "Unknown measurement point",
                                "point": a
                            });
                        }
                    };

                    let mode_salt = match mode {
                        MeterMode::Voltage => 0xA5A5_0000u64,
                        MeterMode::Resistance => 0x55AA_0000u64,
                        MeterMode::Continuity => 0xC0DE_0000u64,
                        MeterMode::Diode => 0xD10D_0000u64,
                    };
                    let base_seed = self.phone.electrical.tick
                        ^ mode_salt
                        ^ Self::hash_label_64(a.as_str()).rotate_left(11);

                    match mode {
                        MeterMode::Voltage => {
                            let true_v = self
                                .phone
                                .electrical
                                .rails
                                .get(&rail_a)
                                .map(|r| r.state.voltage)
                                .unwrap_or(0.0_f64);
                            let current = self.phone.electrical.input.measured_current;
                            let v = Self::measure_voltage_with_noise(true_v, current, base_seed);
                            return json!({ "ok": true, "mode": "voltage", "v": v });
                        }
                        MeterMode::Resistance => {
                            let r_true = self
                                .phone
                                .electrical
                                .rails
                                .get(&rail_a)
                                .map(|r| r.health.resistance_to_ground)
                                .unwrap_or(1.0e9_f64);
                            let mut rng = XorShift64::new(base_seed);
                            let current_factor =
                                (self.phone.electrical.input.measured_current.abs() / 3.0_f64).clamp(0.0_f64, 1.0_f64);
                            let scale = 1.0_f64 + current_factor;
                            let noise = r_true * rng.uniform(-0.01_f64, 0.01_f64) * scale
                                + rng.uniform(-0.2_f64, 0.2_f64) * scale;
                            let r = Self::quantize((r_true + noise).max(0.0_f64), 0.1_f64);
                            return json!({ "ok": true, "mode": "resistance", "ohm": r, "b": b });
                        }
                        MeterMode::Continuity => {
                            let r_true = self
                                .phone
                                .electrical
                                .rails
                                .get(&rail_a)
                                .map(|r| r.health.resistance_to_ground)
                                .unwrap_or(1.0e9_f64);
                            let mut rng = XorShift64::new(base_seed);
                            let thr = 30.0_f64 + rng.uniform(-5.0_f64, 5.0_f64);
                            let beep = r_true <= thr;
                            return json!({ "ok": true, "mode": "continuity", "beep": beep, "b": b });
                        }
                        MeterMode::Diode => {
                            let v = self
                                .phone
                                .electrical
                                .rails
                                .get(&rail_a)
                                .map(|r| (0.18_f64 + r.health.esr * 0.2_f64).clamp(0.0_f64, 1.2_f64))
                                .unwrap_or(0.6_f64);
                            return json!({ "ok": true, "mode": "diode", "vf": Self::quantize(v, 0.001_f64), "b": b });
                        }
                    }
                }
            }
        }

        let tool = req.tool.as_deref().unwrap_or("");
        match tool {
            // ----------------------------------------
            // PSU CONTROL
            // ----------------------------------------
            "psu" => {
                if let Some(params) = &req.params {
                    let voltage = params
                        .get("voltage")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(4.2);
                    let current_limit = params
                        .get("current_limit")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(2.0);
                    let enabled = params.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);

                    // Sesuaikan field ini dengan struktur PhoneState Anda
                    self.phone
                        .electrical
                        .apply_psu_config(voltage, current_limit, enabled);

                    return json!({ "ok": true });
                }
                json!({
                    "ok": false,
                    "message": "Missing PSU parameters"
                })
            }
            _ => json!({
                "ok": false,
                "message": "Unknown tool"
            }),
        }
    }
}
