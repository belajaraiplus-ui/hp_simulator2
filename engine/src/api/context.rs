use crate::core::engine::Engine as CoreEngine;
use crate::state::phone_state::PhoneState;
use crate::state::bootstrap::bootstrap_state;
use crate::session::state::SessionState;

use crate::measurement::engine::MeasurementEngine;
use crate::state::ids::{RailId, ThermalZoneId};

use crate::api::types::ActionRequest;
use serde_json::{json, Value};

pub struct WasmContext {
    pub engine: CoreEngine,
    pub phone: PhoneState,
    pub session: SessionState,
}

impl WasmContext {

    pub fn new(dt: f64) -> Self {
        Self {
            engine: CoreEngine { dt },
            phone: bootstrap_state(),
            session: SessionState::new(),
        }
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
        let value: Option<f64> =
            if let Some((mode, component)) = Self::parse_component_query(&t) {
                MeasurementEngine::measure_component(&mut self.phone, &mode, &component)

            } else if t.contains("diode") {
                Some(MeasurementEngine::measure_diode(&mut self.phone, rail))

            } else if t.contains("ohm") || t.contains("resistance") {
                Some(MeasurementEngine::measure_resistance(&mut self.phone, rail))

            } else if t.contains("continuity") || t.contains("beep") {
                Some(MeasurementEngine::measure_continuity(&mut self.phone, rail))

            } else if t.contains("vbat") || t.contains("battery") || t == "voltage" {
                Some(MeasurementEngine::measure_voltage(&mut self.phone, rail))

            } else if t.contains("vcore") || t.contains("core") {
                Some(MeasurementEngine::measure_voltage(&mut self.phone, rail))

            } else if t.contains("vio") || t == "vio" {
                Some(MeasurementEngine::measure_voltage(&mut self.phone, rail))

            } else if t.contains("soc") && (t.contains("temp") || t == "soc") {
                Some(MeasurementEngine::measure_temperature(&mut self.phone, ThermalZoneId::Soc))

            } else if t.contains("board") && (t.contains("temp") || t == "board") {
                Some(MeasurementEngine::measure_temperature(&mut self.phone, ThermalZoneId::Board))

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
