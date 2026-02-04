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

    /// Semua measurement HARUS lewat MeasurementEngine
    /// Return langsung ANGKA (agar kompatibel UI lama)
    pub fn measure(&mut self, req: &ActionRequest) -> Value {
        let raw = req.tool.as_deref().unwrap_or("");
        let t = Self::normalize(raw);

        // tolerant matching: terima "voltage" sebagai synonym umum
        let value: Option<f64> =
            if t.contains("vbat") || t.contains("battery") || t == "voltage" {
                Some(MeasurementEngine::measure_voltage(&mut self.phone, RailId::Vbat))

            } else if t.contains("vcore") || t.contains("core") {
                Some(MeasurementEngine::measure_voltage(&mut self.phone, RailId::Vcore))

            } else if t.contains("vio") || t == "vio" {
                Some(MeasurementEngine::measure_voltage(&mut self.phone, RailId::Vio))

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
}
