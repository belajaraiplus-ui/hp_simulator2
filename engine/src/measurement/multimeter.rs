use crate::measurement::engine::MeasurementEngine;
use crate::measurement::tool::MeasurementTool;
use crate::state::ids::RailId;
use crate::state::phone_state::PhoneState;

#[derive(Copy, Clone, Debug)]
pub enum MultimeterMode {
    Voltage,
    Resistance,
    Diode,
    Continuity,
}

pub struct Multimeter {
    pub mode: MultimeterMode,
    pub target_rail: RailId,
}

impl Multimeter {
    pub fn new(mode: MultimeterMode, target_rail: RailId) -> Self {
        Self { mode, target_rail }
    }
}

impl MeasurementTool for Multimeter {
    fn perform(&self, s: &mut PhoneState, _dt: f64) -> f64 {
        match self.mode {
            MultimeterMode::Voltage => MeasurementEngine::measure_voltage(s, self.target_rail),
            MultimeterMode::Resistance => {
                MeasurementEngine::measure_resistance(s, self.target_rail)
            }
            MultimeterMode::Diode => MeasurementEngine::measure_diode(s, self.target_rail),
            MultimeterMode::Continuity => {
                MeasurementEngine::measure_continuity(s, self.target_rail)
            }
        }
    }
}

pub struct VoltageMeter {
    pub target_rail: RailId,
}

impl VoltageMeter {
    pub fn new(target_rail: RailId) -> Self {
        Self { target_rail }
    }
}

impl MeasurementTool for VoltageMeter {
    fn perform(&self, s: &mut PhoneState, _dt: f64) -> f64 {
        MeasurementEngine::measure_voltage(s, self.target_rail)
    }
}
