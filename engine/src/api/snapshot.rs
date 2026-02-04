use serde_json::{json, Value};
use crate::state::phone_state::PhoneState;
use crate::state::ids::{RailId, ThermalZoneId};
use serde_json::Value::Null;

/// Snapshot visual: gunakan last-seen measurements (proxy), bukan ground truth.
pub fn build_snapshot(state: &PhoneState) -> Value {
    // Power rails: tampilkan last observed kalau ada, else null
    let rails = state.electrical.rails.iter().map(|(id, _)| {
        let val = state.last_voltage.get(id).cloned().map(|v| json!(v)).unwrap_or(Value::Null);
        json!({
            "name": format!("{:?}", id),
            "voltage": val
        })
    }).collect::<Vec<_>>();

    // Thermals: last observed temperature
    let thermals = state.thermal.zones.iter().map(|(id, _)| {
        let val = state.last_temperature.get(id).cloned().map(|v| json!(v)).unwrap_or(Value::Null);
        json!({
            "zone": format!("{:?}", id),
            "temperature": val
        })
    }).collect::<Vec<_>>();

    // Distress proxy (sum of fault intensities)
    let distress: f64 = state.faults.active
        .values()
        .map(|f| f.intensity)
        .sum();

    json!({
        "time": state.time,
        "rails": rails,
        "thermals": thermals,
        "distress": distress
    })
}
