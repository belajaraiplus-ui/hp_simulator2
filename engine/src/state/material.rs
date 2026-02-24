use crate::state::ids::ComponentId;
use std::collections::HashMap;

#[derive(Debug, Default)]
pub struct MaterialState {
    pub aging_map: HashMap<ComponentId, f64>,
}
