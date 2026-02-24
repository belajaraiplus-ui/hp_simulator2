#[derive(Debug, Default)]
pub struct StressState {
    pub electrical: f64,
    pub thermal: f64,
    pub measurement: f64,
}

impl StressState {
    pub fn new() -> Self {
        Self {
            electrical: 0.0,
            thermal: 0.0,
            measurement: 0.0,
        }
    }
}
