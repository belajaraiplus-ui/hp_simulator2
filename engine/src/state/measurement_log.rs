#[derive(Debug)]
pub struct MeasurementEvent {
    pub time: f64,
    pub target: String,
    pub observed_value: f64,
    pub noise: f64,
    pub injected_energy: f64,
    pub stress_added: f64,
}

#[derive(Debug, Default)]
pub struct MeasurementLog {
    pub history: Vec<MeasurementEvent>,
}

impl MeasurementLog {
    pub fn new() -> Self { Self { history: Vec::new() } }
}