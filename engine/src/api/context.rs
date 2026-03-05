#![allow(dead_code)]

use crate::core::engine::Engine as CoreEngine;
use crate::session::state::SessionState;
use crate::state::bootstrap::bootstrap_state;
use crate::state::phone_state::PhoneState;
use crate::world::presets::get_profile_by_scenario;
use crate::world::profile::apply_world_profile;

use crate::measurement::engine::MeasurementEngine;
use crate::power::multimeter::Multimeter;
use crate::power::profile_loader;
use crate::state::ids::RailId;
use crate::util::rng::XorShift64;

use crate::api::types::{ActionRequest, MeterMode, ToolAction};
use crate::pedagogy::evidence_graph::{EvidenceEdgeKind, EvidenceGraph, EvidenceNodeKind};
use crate::pedagogy::risk_model::{
    ActionEvent, ActionMetadata, ConsequenceLevel, RiskContext, RiskModel, TrainingMode,
};
use crate::replay::audit_log::{AuditLog, AuditLogEntry};
use serde_json::{Value, json};

pub struct WasmContext {
    pub engine: CoreEngine,
    pub phone: PhoneState,
    pub session: SessionState,
    pub current_scenario: String,
    pub training_mode: TrainingMode,
    pub seed: u64,
    pub audit_log: AuditLog,
    pub evidence_graph: EvidenceGraph,
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
            training_mode: TrainingMode::Standard,
            seed: 0xC0DEC0DE,
            audit_log: AuditLog::default(),
            evidence_graph: EvidenceGraph::default(),
        }
    }

    fn evaluate_and_record_consequence(&mut self, action: ActionEvent) {
        let context = RiskContext {
            thermal_stress: self.phone.stress.thermal,
            electrical_stress: self.phone.stress.electrical,
            active_faults: self
                .phone
                .faults
                .active
                .keys()
                .map(|k| format!("{:?}", k))
                .collect(),
            world_profile: self.current_scenario.clone(),
            has_stable_ground_reference: self.phone.electrical.ground_integrity > 0.75,
            current_a: self.phone.electrical.input.measured_current,
            voltage_v: self.phone.electrical.input.voltage,
            charger_negotiation_valid: self.phone.electrical.input.vchg_enabled,
            protection_bypassed: false,
            measurement_noise: self.phone.electrical.transient_noise,
        };
        let consequence = RiskModel::evaluate(&action, &context, self.training_mode);
        let state_delta_hash = format!(
            "{:016x}",
            Self::hash_label_64(&format!(
                "{}:{}:{}",
                action.tool, action.target, consequence.reason_code
            ))
        );
        self.audit_log.append(AuditLogEntry {
            tick: action.at_tick,
            wall_timestamp_ms: None,
            seed: self.seed,
            action: action.clone(),
            consequence: consequence.clone(),
            state_delta_hash,
            notes: None,
        });
        let node_id = format!("justification:{}", action.at_tick);
        self.evidence_graph.add_node(
            node_id.clone(),
            EvidenceNodeKind::Justification,
            format!("{} {}", action.tool, action.target),
            action.at_tick,
        );
        if consequence.level != ConsequenceLevel::Safe {
            self.evidence_graph.add_edge(
                node_id,
                format!("risk:{}", consequence.reason_code),
                EvidenceEdgeKind::RiskIntroduced,
                action.at_tick,
            );
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

    pub fn record_action(&mut self, tool: &str, target: &str, setting: Option<String>) {
        self.evaluate_and_record_consequence(ActionEvent {
            tool: tool.to_string(),
            setting,
            target: target.to_string(),
            at_tick: self.phone.electrical.tick,
            metadata: ActionMetadata::default(),
        });
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
                "soc".to_string(),
            ))
        } else if t.contains("board") && (t.contains("temp") || t == "board") {
            Some(MeasurementEngine::measure_temperature(
                &mut self.phone,
                "board".to_string(),
            ))
        } else if t.is_empty() {
            return json!({ "error": "Empty measurement target" });
        } else {
            None
        };

        let response = match value {
            Some(v) => json!(v),
            None => json!({
                "error": "Unknown measurement target",
                "target": raw
            }),
        };
        self.record_action("multimeter", raw, req.tool.clone());
        response
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
                    let noisy_i = (i
                        + i * rng.uniform(-0.01_f64, 0.01_f64)
                        + rng.uniform(-0.005_f64, 0.005_f64))
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
                        None => {
                            json!({ "ok": false, "message": format!("Unknown rail id: {}", trimmed) })
                        }
                    };
                }
                ToolAction::ClearPSUTargetRail {} => {
                    self.phone.electrical.input.target_rail = None;
                    return json!({ "ok": true });
                }
                ToolAction::SetPSUMode { mode } => {
                    let psu_mode = match mode.as_str() {
                        "cv" => crate::state::electrical::PsuMode::CV,
                        "cc" => crate::state::electrical::PsuMode::CC,
                        "off" => crate::state::electrical::PsuMode::Off,
                        _ => crate::state::electrical::PsuMode::CV,
                    };
                    self.phone.electrical.set_psu_mode(psu_mode);
                    return json!({ "ok": true, "mode": mode });
                }
                ToolAction::SetPSUOVP { threshold } => {
                    self.phone.electrical.set_psu_ovp(*threshold);
                    return json!({ "ok": true, "ovp_threshold": threshold });
                }
                ToolAction::SetPSUUVP { threshold } => {
                    self.phone.electrical.set_psu_uvp(*threshold);
                    return json!({ "ok": true, "uvp_threshold": threshold });
                }
                ToolAction::SetPSURipple { ripple_vpp } => {
                    self.phone.electrical.set_psu_ripple(*ripple_vpp);
                    return json!({ "ok": true, "ripple_vpp": ripple_vpp });
                }
                ToolAction::ResetPSUFault {} => {
                    self.phone.electrical.input.psu_mode = crate::state::electrical::PsuMode::CV;
                    self.phone.electrical.input.enabled = true;
                    return json!({ "ok": true, "mode": "cv" });
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
                    let rail_id = match RailId::from_str(a.as_str()) {
                        Some(r) => r,
                        None => {
                            return json!({
                                "ok": false,
                                "message": "Unknown measurement point",
                                "point": a
                            });
                        }
                    };

                    // Hitung stress PSU untuk jitter (0.0 - 1.0)
                    let ilim = self.phone.electrical.input.current_limit.max(0.1);
                    let stress =
                        (self.phone.electrical.input.measured_current / ilim).clamp(0.0, 1.0);
                    let rail = self.phone.electrical.rails.get(&rail_id);

                    let mode_salt = match mode {
                        MeterMode::Voltage => 0xA5A5_0000u64,
                        MeterMode::Resistance => 0x55AA_0000u64,
                        MeterMode::Continuity => 0xC0DE_0000u64,
                        MeterMode::Diode => 0xD10D_0000u64,
                        MeterMode::Current => 0xC0FF_0000u64,
                        MeterMode::Temperature => 0xDEAD_0000u64,
                    };
                    let base_seed = self.phone.electrical.tick
                        ^ mode_salt
                        ^ Self::hash_label_64(a.as_str()).rotate_left(11);

                    match mode {
                        MeterMode::Voltage => {
                            let true_v_a = rail.map(|r| r.state.voltage).unwrap_or(0.0);

                            let true_v = if let Some(b_point) = b {
                                if let Some(b_id) = RailId::from_str(b_point.as_str()) {
                                    if let Some(rail_b) = self.phone.electrical.rails.get(&b_id) {
                                        let true_v_b = rail_b.state.voltage;
                                        true_v_a - true_v_b
                                    } else {
                                        true_v_a
                                    }
                                } else {
                                    true_v_a
                                }
                            } else {
                                true_v_a
                            };

                            let res = Multimeter::voltage_resolution(true_v.abs());
                            let mut rng = XorShift64::new(base_seed);

                            let offset = rng.uniform(-2.0 * res, 2.0 * res);
                            let jitter_span = (3.0 + 17.0 * stress) * res;
                            let jitter = rng.uniform(-jitter_span, jitter_span);

                            let v = Multimeter::quantize(true_v + offset + jitter, res);
                            return json!({ "ok": true, "mode": "voltage", "v": v, "b": b });
                        }
                        MeterMode::Resistance => {
                            let raw_r = rail.map(|r| r.r2g_ohms()).unwrap_or(1e9);
                            let res = Multimeter::ohm_resolution(raw_r);
                            let mut rng = XorShift64::new(base_seed);

                            let noise_multiplier = (raw_r / 2000.0).max(1.0).min(100.0);
                            let offset = rng.uniform(-1.0 * res, 1.0 * res);
                            let jitter_span = (2.0 * noise_multiplier) * res;
                            let jitter = rng.uniform(-jitter_span, jitter_span);

                            let val = Multimeter::quantize((raw_r + offset + jitter).max(0.0), res);
                            let display = if val > Multimeter::OHM_LIMIT {
                                json!("OL")
                            } else {
                                json!(val)
                            };
                            return json!({ "ok": true, "mode": "resistance", "ohm": display, "b": b });
                        }
                        MeterMode::Continuity => {
                            let raw_r = rail.map(|r| r.r2g_ohms()).unwrap_or(1e9);
                            let beep = rail.map(|r| r.continuity_beep()).unwrap_or(false);
                            let mut rng = XorShift64::new(base_seed);

                            let jitter = rng.uniform(-2.0, 2.0);
                            let val = Multimeter::quantize((raw_r + jitter).max(0.0), 0.1);
                            let display = if val > Multimeter::OHM_LIMIT {
                                json!("OL")
                            } else {
                                json!(val)
                            };
                            return json!({ "ok": true, "mode": "continuity", "beep": beep, "ohm": display, "b": b });
                        }
                        MeterMode::Diode => {
                            let raw_v = rail.map(|r| r.state.voltage).unwrap_or(0.0);
                            let status = rail
                                .map(|r| r.status)
                                .unwrap_or(crate::power::rail::RailStatus::Off);
                            let mut rng = XorShift64::new(base_seed);

                            let base = if status == crate::power::rail::RailStatus::ShortToGnd {
                                0.005
                            } else if raw_v.abs() < 0.3 {
                                0.55
                            } else {
                                1.20
                            };

                            let jitter_range = 0.02 + 0.08 * stress;
                            let jitter = rng.uniform(-jitter_range, jitter_range);
                            let vf = Multimeter::quantize((base + jitter).max(0.0), 0.001);
                            return json!({ "ok": true, "mode": "diode", "vf": vf, "b": b });
                        }
                        MeterMode::Current => {
                            let raw_i = rail.map(|r| r.state.current).unwrap_or(0.0);
                            let res = Multimeter::current_resolution(raw_i);
                            let mut rng = XorShift64::new(base_seed);

                            let burden_v = raw_i * 0.1;
                            let burden_error = burden_v * 0.02;

                            let offset = rng.uniform(-burden_error, burden_error);
                            let jitter_span = (0.5 + 2.0 * stress) * res;
                            let jitter = rng.uniform(-jitter_span, jitter_span);

                            let val = Multimeter::quantize(raw_i + offset + jitter, res);
                            let display = if val < 0.0 { json!("OL") } else { json!(val) };
                            return json!({ "ok": true, "mode": "current", "a": display });
                        }
                        MeterMode::Temperature => {
                            let zone_id = format!("{:?}", rail_id);
                            let raw_t_a = self
                                .phone
                                .thermal
                                .zones
                                .get(&zone_id)
                                .map(|z| z.temp_c)
                                .unwrap_or(self.phone.thermal.average());

                            let raw_t = if let Some(b_point) = b {
                                if let Some(b_id) = RailId::from_str(b_point.as_str()) {
                                    let b_zone_id = format!("{:?}", b_id);
                                    if let Some(zone_b) = self.phone.thermal.zones.get(&b_zone_id) {
                                        raw_t_a - zone_b.temp_c
                                    } else {
                                        raw_t_a
                                    }
                                } else {
                                    raw_t_a
                                }
                            } else {
                                raw_t_a
                            };

                            let res = Multimeter::temperature_resolution(raw_t.abs());
                            let mut rng = XorShift64::new(base_seed);

                            let cjc_error = rng.uniform(-1.5, 1.5);
                            let noise = rng.uniform(-0.3, 0.3);
                            let drift = (self.phone.electrical.tick as f64 * 0.001).sin() * 0.2;

                            let val = Multimeter::quantize(raw_t + cjc_error + noise + drift, res);
                            return json!({ "ok": true, "mode": "temperature", "c": val, "b": b });
                        }
                    }
                }
                ToolAction::SetAmbientTemp { ambient_c } => {
                    self.phone.thermal.ambient_c = *ambient_c;
                    return json!({ "ok": true });
                }
                ToolAction::UpsertThermalZone {
                    id,
                    thermal_mass,
                    heat_dissipation,
                } => {
                    if let Some(zone) = self.phone.thermal.zones.get_mut(id) {
                        zone.thermal_mass = *thermal_mass;
                        zone.heat_dissipation = *heat_dissipation;
                    } else {
                        self.phone.thermal.zones.insert(
                            id.clone(),
                            crate::thermal::ThermalZone {
                                id: id.clone(),
                                temp_c: self.phone.thermal.ambient_c,
                                thermal_mass: *thermal_mass,
                                heat_dissipation: *heat_dissipation,
                                convection_coefficient: 0.05,
                                surface_area: 0.001,
                                is_heatsink: false,
                                throttling_threshold: 85.0,
                            },
                        );
                    }
                    return json!({ "ok": true });
                }
                ToolAction::SetThermalLinks { links } => {
                    self.phone.thermal.links = links
                        .iter()
                        .map(|(a, b, g)| crate::thermal::ThermalLink {
                            a: a.clone(),
                            b: b.clone(),
                            conductance: *g,
                        })
                        .collect();
                    return json!({ "ok": true });
                }
                ToolAction::SetRailThermalZone { rail, zone } => {
                    self.phone
                        .thermal
                        .rail_zone
                        .insert(rail.clone(), zone.clone());
                    return json!({ "ok": true });
                }
                ToolAction::SetCPULoad { load } => {
                    self.phone.electrical.dynamic_load.base_cpu_load = load.max(0.0).min(2.0);
                    return json!({ "ok": true, "cpu_load": load });
                }
                ToolAction::SetCharging { charging } => {
                    self.phone.electrical.set_charging_load(*charging);
                    return json!({ "ok": true, "charging": charging });
                }
                ToolAction::SetRailFuse { rail, rating_a } => {
                    if let Some(rail_id) = RailId::from_str(rail.as_str()) {
                        if let Some(r) = self.phone.electrical.rails.get_mut(&rail_id) {
                            r.health.fuse_rating_a = *rating_a;
                            return json!({ "ok": true, "rail": rail, "fuse_rating_a": rating_a });
                        }
                    }
                    return json!({ "ok": false, "message": "Rail not found" });
                }
                ToolAction::SetRailOCP {
                    rail,
                    threshold_a,
                    delay_s,
                } => {
                    if let Some(rail_id) = RailId::from_str(rail.as_str()) {
                        if let Some(r) = self.phone.electrical.rails.get_mut(&rail_id) {
                            r.health.ocp_threshold_a = *threshold_a;
                            r.health.ocp_delay_s = *delay_s;
                            return json!({ "ok": true, "rail": rail, "ocp_threshold_a": threshold_a, "ocp_delay_s": delay_s });
                        }
                    }
                    return json!({ "ok": false, "message": "Rail not found" });
                }
                ToolAction::BlowRailFuse { rail } => {
                    if let Some(rail_id) = RailId::from_str(rail.as_str()) {
                        if let Some(r) = self.phone.electrical.rails.get_mut(&rail_id) {
                            r.blow_fuse();
                            return json!({ "ok": true, "rail": rail, "fuse_blown": true });
                        }
                    }
                    return json!({ "ok": false, "message": "Rail not found" });
                }
                ToolAction::ResetRailFuse { rail } => {
                    if let Some(rail_id) = RailId::from_str(rail.as_str()) {
                        if let Some(r) = self.phone.electrical.rails.get_mut(&rail_id) {
                            r.reset_fuse();
                            return json!({ "ok": true, "rail": rail, "fuse_blown": false });
                        }
                    }
                    return json!({ "ok": false, "message": "Rail not found" });
                }
                ToolAction::AddParallelRegulator {
                    target,
                    source,
                    current_limit_a,
                } => {
                    if let Some(target_id) = RailId::from_str(target.as_str()) {
                        if let Some(source_id) = RailId::from_str(source.as_str()) {
                            self.phone.power_graph.add_regulator_with_limit(
                                source_id,
                                target_id,
                                *current_limit_a,
                            );
                            return json!({ "ok": true, "target": target, "source": source, "current_limit_a": current_limit_a });
                        }
                    }
                    return json!({ "ok": false, "message": "Invalid rail ID" });
                }
                ToolAction::SetFanSpeed { speed } => {
                    self.phone.thermal.set_fan_speed(*speed);
                    return json!({ "ok": true, "fan_speed": speed });
                }
                ToolAction::SetZoneThrottling { zone, threshold_c } => {
                    if let Some(z) = self.phone.thermal.zones.get_mut(zone) {
                        z.throttling_threshold = *threshold_c;
                        return json!({ "ok": true, "zone": zone, "throttling_threshold": threshold_c });
                    }
                    return json!({ "ok": false, "message": "Thermal zone not found" });
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
                    let enabled = params
                        .get("enabled")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true);

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
