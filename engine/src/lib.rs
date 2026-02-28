use std::sync::Mutex;
use wasm_bindgen::prelude::*;

mod analysis;
mod api;
mod core;
pub mod fault;
mod measurement;
pub mod physics;
mod postmortem;
pub mod power;
pub mod scenario;
pub mod scenario_dsl;
pub mod session;
pub mod state;
pub mod thermal;
mod util;
pub mod world;

use crate::session::types::SessionEndReason;
use api::context::WasmContext;
use api::contract::ApiContract;
use api::snapshot::build_snapshot;
use api::types::{ActionKind, ApiError, ApiResponse};

static CTX: once_cell::sync::Lazy<Mutex<Option<WasmContext>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

#[wasm_bindgen]
pub fn init(dt: f64) {
    let mut guard = CTX.lock().unwrap();
    *guard = Some(WasmContext::new(dt));
}

#[wasm_bindgen]
pub fn dispatch(action_json: &str) -> String {
    let req = match ApiContract::validate_request(action_json) {
        Ok(r) => r,
        Err(e) => return e.to_json_string(),
    };

    let mut guard = match CTX.lock() {
        Ok(g) => g,
        Err(_) => {
            return ApiError::lock_failed().to_json_string();
        }
    };

    let ctx = match guard.as_mut() {
        Some(c) => c,
        None => {
            return ApiError::not_initialized().to_json_string();
        }
    };

    let kind = match ActionKind::from_str(&req.kind) {
        Some(k) => k,
        None => {
            return ApiError::invalid_kind(&req.kind).to_json_string();
        }
    };

    match kind {
        ActionKind::Step => {
            let dt = ctx.engine.dt;
            ctx.engine.step(&mut ctx.phone, &mut ctx.session);

            // Thermal Step Integration: Kumpulkan power per zone
            let mut p_zone: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
            ctx.phone.thermal.ensure_zone("board");

            for (rail_id, rail) in ctx.phone.electrical.rails.iter() {
                let v = rail.state.voltage;
                let r2g = rail.health.resistance_to_ground.max(0.01);
                let p = (v * v) / r2g; // P = V^2 / R (Leakage power)

                let rid = format!("{:?}", rail_id);
                let zone = ctx.phone.thermal.rail_zone.get(&rid).cloned().unwrap_or_else(|| "board".to_string());
                ctx.phone.thermal.add_power(&zone, p, &mut p_zone);
            }

            // edge path heating (kalau kamu simpan edge_flow)
            // for (parent, child, i, r) in edge_flow { ... split to zones ... }

            let stress_delta = ctx.phone.thermal.step(dt, &p_zone);
            ctx.phone.stress.thermal += stress_delta;

            ApiResponse::ok().to_json_string()
        }

        ActionKind::Measure => {
            let m = ctx.measure(&req);
            ApiResponse::ok().with_measurement(m).to_json_string()
        }

        ActionKind::Snapshot => {
            let s = build_snapshot(&ctx.phone);
            ApiResponse::ok().with_snapshot(s).to_json_string()
        }

        ActionKind::Stop => {
            ctx.session.terminate(SessionEndReason::UserStop);
            ApiResponse::ok()
                .with_message("Session stopped")
                .to_json_string()
        }

        ActionKind::Tool => {
            let result = ctx.apply_tool_action(&req);
            result.to_string()
        }

        ActionKind::Scenario => {
            let scenario_id = req.scenario.as_deref().unwrap_or("default");
            let result = ctx.load_scenario(scenario_id);
            result.to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn test_propagate_power_integration() {
        // 1. Initialize Engine (dt = 0.1s)
        init(0.1);

        // 2. Enable VCHG (USB Charger)
        let enable_vchg = json!({
            "version": 1,
            "kind": "tool",
            "tool_action": {
                "ToggleVCHG": { "enabled": true }
            }
        })
        .to_string();
        dispatch(&enable_vchg);

        // 3. Set Voltage to 5.0V
        let set_voltage = json!({
            "version": 1,
            "kind": "tool",
            "tool_action": {
                "SetVCHGVoltage": { "voltage": 5.0 }
            }
        })
        .to_string();
        dispatch(&set_voltage);

        // 4. Step simulation multiple times
        // propagate_power menggunakan kurva RC, jadi butuh beberapa tick untuk naik
        let step_req = json!({ "version": 1, "kind": "step" }).to_string();
        for _ in 0..10 {
            dispatch(&step_req);
        }

        // 5. Snapshot to verify voltage
        let snap_req = json!({ "version": 1, "kind": "snapshot" }).to_string();
        let snap_res = dispatch(&snap_req);
        let snap_json: Value = serde_json::from_str(&snap_res).unwrap();

        // 6. Find Vchg rail & Verify
        let rails = snap_json["snapshot"]["rails"]
            .as_array()
            .expect("Rails not found");
        let vchg = rails
            .iter()
            .find(|r| r["name"] == "Vchg")
            .expect("Vchg missing");
        let voltage = vchg["voltage"].as_f64().expect("Voltage invalid");

        println!("VCHG Voltage: {}", voltage);
        assert!(
            voltage > 4.0,
            "VCHG voltage should rise near 5.0V, got {}",
            voltage
        );
    }
}
