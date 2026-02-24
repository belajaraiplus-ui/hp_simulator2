use crate::state::ids::RailId;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FaultKind {
    ShortToGnd { rail: RailId, r_ohms: f32 }, // mis. 0.5Ω–50Ω
    RailMissing { rail: RailId },             // enable/PMIC fail
}
