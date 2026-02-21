use std::collections::HashMap;

#[derive(Debug, Default)]
pub struct MeasurementFatigue {
    pub counts: HashMap<(String, String), usize>,
}

impl MeasurementFatigue {
    pub fn new() -> Self { Self { counts: HashMap::new() } }
}