use serde_json::{json, Value};
use crate::state::phone_state::PhoneState;

pub trait MeasurementTool {
    fn perform(&self, s: &mut PhoneState, dt: f64) -> f64;
}

pub struct MeasurementDispatcher;

impl MeasurementDispatcher {

    pub fn dispatch(tool: &str, _phone: &mut PhoneState) -> Value {
        match tool {
            "multimeter" => Self::multimeter(),
            "psu" => Self::psu(),
            "scope" => Self::scope(),
            _ => json!({ "error": "unknown measurement tool" }),
        }
    }

    fn multimeter() -> Value {
        json!({
            "tool": "multimeter",
            "voltage": 3.8,
            "current": 0.42
        })
    }

    fn psu() -> Value {
        json!({
            "tool": "psu",
            "enabled": true,
            "limit": 2.0
        })
    }

    fn scope() -> Value {
        json!({
            "tool": "scope",
            "signal": "stable"
        })
    }
}
