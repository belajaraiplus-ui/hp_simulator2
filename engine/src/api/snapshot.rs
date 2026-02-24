use crate::measurement::board_profile;
use crate::state::phone_state::PhoneState;
use serde_json::{json, Value};

/// Build a snapshot JSON value from the internal PhoneState.
/// Snapshot visual: gunakan last-seen measurements (proxy), bukan ground truth.
pub fn build_snapshot(state: &PhoneState) -> Value {
    // =======================
    // POWER RAILS (last observed only)
    // =======================

    let rails = state
        .electrical
        .rails
        .iter()
        .map(|(id, _)| {
            let val = state
                .last_voltage
                .get(id)
                .cloned()
                .or_else(|| state.electrical.rails.get(id).map(|r| r.state.voltage))
                .map(|v| json!(v))
                .unwrap_or(Value::Null);

            json!({
                "name": format!("{:?}", id),
                "voltage": val
            })
        })
        .collect::<Vec<_>>();

    // =======================
    // THERMALS (last observed only)
    // =======================

    let thermals = state
        .thermal
        .zones
        .iter()
        .map(|(id, _)| {
            let val = state
                .last_temperature
                .get(id)
                .cloned()
                .or_else(|| state.thermal.zones.get(id).map(|z| z.temperature))
                .map(|v| json!(v))
                .unwrap_or(Value::Null);

            json!({
                "zone": format!("{:?}", id),
                "temperature": val
            })
        })
        .collect::<Vec<_>>();

    // =======================
    // MEASUREMENT HISTORY (observable effects only)
    // =======================

    let measurements = state
        .measurements
        .history
        .iter()
        .map(|m| {
            json!({
                "time": m.time,
                "target": m.target,
                "observed_value": m.observed_value,
                "noise": m.noise,
                "injected_energy": m.injected_energy,
                "stress_added": m.stress_added
            })
        })
        .collect::<Vec<_>>();

    // =======================
    // PSU SNAPSHOT (observable tool state)
    // =======================

    let power_input = json!({
        "enabled": state.electrical.input.enabled,
        "voltage": state.electrical.input.voltage,
        "current_limit": state.electrical.input.current_limit,
        "measured_current": state.electrical.input.measured_current
    });

    // =======================
    // DISTRESS PROXY (OBSERVABLE-ONLY)
    // =======================

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
                .sum::<f64>()
                / (n as f64)
        }
    };

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

    let mut distress = state.stress.electrical * 0.5
        + state.stress.thermal * 0.3
        + state.electrical.transient_noise * 0.2
        + noise_avg * 0.4
        + observability_penalty * 0.6;

    if distress.is_nan() {
        distress = 0.0;
    }

    distress = distress.clamp(0.0, 1.0);

    // =======================
    // FINAL SNAPSHOT
    // =======================

    let profile = board_profile::active_profile();
    let component_catalog = profile
        .components
        .iter()
        .map(|c| {
            json!({
                "id": c.id,
                "label": c.label,
                "rail": format!("{:?}", c.rail)
            })
        })
        .collect::<Vec<_>>();

    json!({
        "time": state.time,
        "board_profile": {
            "id": profile.id,
            "display_name": profile.display_name
        },
        "component_catalog": component_catalog,
        "rails": rails,
        "thermals": thermals,
        "measurements": measurements,
        "power_input": power_input,
        "distress": distress
    })
}
