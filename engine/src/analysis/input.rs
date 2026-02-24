use crate::state::phone_state::MeasurementLog;
use crate::state::StressState;

pub struct AnalysisInput<'a> {
    pub measurements: &'a MeasurementLog,
    pub stress: &'a StressState,
}
