use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize)]
pub struct ActionRequest {
    pub kind: String,        // "step" | "measure" | "stop"
    pub tool: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ActionResult {
    pub ok: bool,
    pub message: String,
}
