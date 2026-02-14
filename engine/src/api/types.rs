use serde::{Serialize, Deserialize};
use serde_json::Value;

#[derive(Serialize, Deserialize)]
pub struct ActionRequest {
    pub kind: String,            // "step" | "measure" | "snapshot" | "stop" | "tool"
    pub tool: Option<String>,    // e.g. "vbat", "vcore", "psu"
    pub params: Option<Value>,   // optional parameters (for PSU etc.)
}

#[derive(Serialize, Deserialize)]
pub struct ActionResult {
    pub ok: bool,
    pub message: String,
}
