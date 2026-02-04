use serde::Serialize;

#[derive(Serialize)]
pub struct PostMortem {
    pub root_cause_chain: Vec<String>,
    pub technician_errors: Vec<String>,
    pub irreversible_damage: Vec<String>,
    pub timeline_summary: String,
}
