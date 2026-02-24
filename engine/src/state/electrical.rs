use crate::power::rail::Rail;
use crate::state::ids::RailId;
use std::collections::HashMap;

#[derive(Debug, Default)]
pub struct PowerInput {
    pub voltage: f64,
    pub current_limit: f64,
    pub enabled: bool,
    pub measured_current: f64,
    pub vchg_enabled: bool,
    pub vchg_voltage: f64,
}

impl PowerInput {
    pub fn new() -> Self {
        Self {
            voltage: 0.0,
            current_limit: 0.0,
            enabled: false,
            measured_current: 0.0,
            vchg_enabled: false,
            vchg_voltage: 5.0,
        }
    }
}

#[derive(Debug)]
pub struct ElectricalState {
    pub rails: HashMap<RailId, Rail>,
    pub ground_integrity: f64,
    pub transient_noise: f64,
    pub extra_load_a: f64,
    pub input: PowerInput,
}

impl ElectricalState {
    pub fn ensure_rail(&mut self, id: RailId) -> &mut Rail {
        self.rails.entry(id).or_insert_with(|| Rail::new(id))
    }

    pub fn total_load(&self) -> f64 {
        self.rails.values().map(|r| r.state.current).sum()
    }

    pub fn set_input_measured_current(&mut self, current: f64) {
        self.input.measured_current = current;
    }

    pub fn apply_psu_config(&mut self, voltage: f64, current_limit: f64, enabled: bool) {
        self.input.voltage = voltage;
        self.input.current_limit = current_limit;
        self.input.enabled = enabled;
    }
}

impl Default for ElectricalState {
    fn default() -> Self {
        Self {
            rails: HashMap::new(),
            ground_integrity: 1.0,
            transient_noise: 0.0,
            extra_load_a: 0.0,
            input: PowerInput::new(),
        }
    }
}
