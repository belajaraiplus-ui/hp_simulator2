use crate::state::phone_state::{MeasurementLog, StressState};

pub struct AnalysisInput<'a> {
    pub measurements: &'a MeasurementLog,
    pub stress: &'a StressState,
}