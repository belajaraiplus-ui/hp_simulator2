use crate::fault::model::FaultInstance;
use crate::state::ids::FaultId;
use std::collections::HashMap;

#[derive(Debug, Default)]
pub struct FaultRegistry {
    pub active: HashMap<FaultId, FaultInstance>,
}

impl FaultRegistry {
    pub fn new() -> Self { Self { active: HashMap::new() } }
}