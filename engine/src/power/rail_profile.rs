use crate::power::rail::RailExpected;
use crate::state::ids::RailId;
use std::collections::HashMap;

/// Profile expected rail dari rails.json.
/// Ini hanya DTO → nanti langsung di-inject ke Rail.expected
#[derive(Debug, Clone)]
pub struct RailExpectedProfile {
    pub expected: RailExpected,

    /// Optional: baseline R2G untuk health default
    pub nominal_r2g: f64,
}

pub type RailProfileMap = HashMap<RailId, RailExpectedProfile>;
