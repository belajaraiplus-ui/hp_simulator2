use wasm_bindgen::prelude::*;
use serde_json::json;
use std::sync::Mutex;

mod api;
mod core;
mod state;
mod physics;
mod measurement;
mod fault;
mod session;
pub mod power;
mod analysis;
mod postmortem;
pub mod scenario_dsl;
pub mod scenario;
pub mod world;

use api::types::ActionRequest;
use api::context::WasmContext;
use api::snapshot::build_snapshot;
use crate::session::types::SessionEndReason;

static CTX: once_cell::sync::Lazy<Mutex<Option<WasmContext>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

#[wasm_bindgen]
pub fn init(dt: f64) {
    let mut guard = CTX.lock().unwrap();
    *guard = Some(WasmContext::new(dt));
}

#[wasm_bindgen]
pub fn dispatch(action_json: &str) -> String {

    // ===============================
    // Parse JSON
    // ===============================
    let req: ActionRequest = match serde_json::from_str(action_json) {
        Ok(v) => v,
        Err(e) => {
            return json!({
                "ok": false,
                "message": format!("Invalid JSON: {}", e)
            }).to_string()
        }
    };

    // ===============================
    // Acquire context
    // ===============================
    let mut guard = match CTX.lock() {
        Ok(g) => g,
        Err(_) => {
            return json!({
                "ok": false,
                "message": "Context lock failed"
            }).to_string()
        }
    };

    let ctx = match guard.as_mut() {
        Some(c) => c,
        None => {
            return json!({
                "ok": false,
                "message": "Engine not initialized"
            }).to_string()
        }
    };

    // ===============================
    // Validate allowed kinds
    // ===============================
    if !matches!(
        req.kind.as_str(),
        "step" | "measure" | "snapshot" | "stop" | "tool"
    ) {
        return json!({
            "ok": false,
            "message": "Invalid action kind"
        }).to_string();
    }

    // ===============================
    // Dispatch
    // ===============================
    match req.kind.as_str() {

        // --------------------------------
        // STEP
        // --------------------------------
        "step" => {
            ctx.engine.step(&mut ctx.phone, &mut ctx.session);
            json!({ "ok": true }).to_string()
        }

        // --------------------------------
        // MEASURE (Multimeter)
        // --------------------------------
        "measure" => {
            let m = ctx.measure(&req);
            json!({
                "ok": true,
                "measurement": m
            }).to_string()
        }

        // --------------------------------
        // SNAPSHOT
        // --------------------------------
        "snapshot" => {
            let s = build_snapshot(&ctx.phone);
            json!({
                "ok": true,
                "snapshot": s
            }).to_string()
        }

        // --------------------------------
        // STOP SESSION
        // --------------------------------
        "stop" => {
            ctx.session.terminate(SessionEndReason::UserStop);
            json!({ "ok": true }).to_string()
        }

        // --------------------------------
        // TOOL CONTROL (PSU etc.)
        // --------------------------------
        "tool" => {
            let result = ctx.apply_tool_action(&req);
            result.to_string()
        }

        _ => json!({
            "ok": false,
            "message": "Unhandled action"
        }).to_string(),
    }
}
