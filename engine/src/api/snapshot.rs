use serde_json::{json, Value};
use crate::state::phone_state::PhoneState;
use crate::state::ids::{RailId, ThermalZoneId};

/// Snapshot visual: gunakan last-seen measurements (proxy), bukan ground truth.
pub fn build_snapshot(state: &PhoneState) -> Value {
    // =======================
    // POWER RAILS (last observed only)
    // =======================

    let rails = state.electrical.rails.iter().map(|(id, _)| {
        let val = state
            .last_voltage
            .get(id)
            .cloned()
            .map(|v| json!(v))
            .unwrap_or(Value::Null);

        json!({
            "name": format!("{:?}", id),
            "voltage": val
        })
    }).collect::<Vec<_>>();

    // =======================
    // THERMALS (last observed only)
    // =======================

    let thermals = state.thermal.zones.iter().map(|(id, _)| {
        let val = state
            .last_temperature
            .get(id)
            .cloned()
            .map(|v| json!(v))
            .unwrap_or(Value::Null);

        json!({
            "zone": format!("{:?}", id),
            "temperature": val
        })
    }).collect::<Vec<_>>();

    // =======================
    // DISTRESS PROXY (OBSERVABLE-ONLY)
    // =======================
    // TIDAK membaca fault registry.
    // Dibangun dari stress, noise, dan measurement behavior.

    // measurement noise average (last N)
    let noise_avg = {
        let hist = &state.measurements.history;
        let n = std::cmp::min(10, hist.len());
        if n == 0 {
            0.0
        } else {
            hist.iter()
                .rev()
                .take(n)
                .map(|m| m.noise.abs())
                .sum::<f64>() / (n as f64)
        }
    };

    // observability penalty: seberapa banyak rail belum pernah diukur
    let total_rails = state.electrical.rails.len() as f64;
    let missing_rails = state
        .electrical
        .rails
        .keys()
        .filter(|id| !state.last_voltage.contains_key(id))
        .count() as f64;

    let observability_penalty = if total_rails > 0.0 {
        missing_rails / total_rails
    } else {
        0.0
    };

    // distress synthesis (proxy, noisy, imperfect)
    let mut distress =
        state.stress.electrical * 0.5 +
        state.stress.thermal * 0.3 +
        state.electrical.transient_noise * 0.2 +
        noise_avg * 0.4 +
        observability_penalty * 0.6;

    // clamp for UI sanity (NOT physical truth)
    if distress.is_nan() {
        distress = 0.0;
    }
    distress = distress.clamp(0.0, 1.0);

    // =======================
    // FINAL SNAPSHOT
    // =======================

    json!({
        "time": state.time,
        "rails": rails,
        "thermals": thermals,
        "distress": distress
    })
}
