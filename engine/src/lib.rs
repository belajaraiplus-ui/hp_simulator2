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
mod analysis;
mod postmortem;
pub mod scenario_dsl;
pub mod scenario;
pub mod world;


use api::types::ActionRequest;
use api::context::WasmContext;
use api::snapshot::build_snapshot;
use crate::session::types::{SessionStatus, SessionEndReason};

static CTX: once_cell::sync::Lazy<Mutex<Option<WasmContext>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

#[wasm_bindgen]
pub fn init(dt: f64) {
    let mut guard = CTX.lock().unwrap();
    *guard = Some(WasmContext::new(dt));
}

#[wasm_bindgen]
pub fn dispatch(action_json: &str) -> String {
    let req: ActionRequest = match serde_json::from_str(action_json) {
        Ok(v) => v,
        Err(e) => return json!({ "ok": false, "message": e.to_string() }).to_string(),
    };

    let mut guard = match CTX.lock() {
        Ok(g) => g,
        Err(_) => return json!({ "ok": false }).to_string(),
    };

    let ctx = match guard.as_mut() {
        Some(c) => c,
        None => return json!({ "ok": false }).to_string(),
    };

    if !matches!(req.kind.as_str(), "step" | "measure" | "snapshot" | "stop") {
        return json!({ "ok": false }).to_string();
    }

    match req.kind.as_str() {

        "step" => {
            ctx.engine.step(&mut ctx.phone, &mut ctx.session);
            json!({ "ok": true }).to_string()
        }

        "measure" => {
            let m = ctx.measure(&req);
            json!({ "ok": true, "measurement": m }).to_string()
        }

        "snapshot" => {
            let s = build_snapshot(&ctx.phone);
            json!({ "ok": true, "snapshot": s }).to_string()
        }

        "stop" => {
            ctx.session.terminate(SessionEndReason::UserStop);
            json!({ "ok": true }).to_string()
        }

        _ => json!({ "ok": false }).to_string(),
    }
}
