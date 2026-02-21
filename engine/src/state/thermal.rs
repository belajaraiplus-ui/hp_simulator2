use crate::state::ids::ThermalZoneId;
use std::collections::HashMap;

#[derive(Debug)]
pub struct ThermalZone {
    pub temperature: f64,
    pub thermal_mass: f64,
    pub heat_generation: f64,
    pub heat_dissipation: f64,
    pub coupling: Vec<(ThermalZoneId, f64)>,
}

#[derive(Debug, Default)]
pub struct ThermalState {
    pub ambient: f64,
    pub zones: HashMap<ThermalZoneId, ThermalZone>,
}

impl ThermalState {
    pub fn average(&self) -> f64 {
        if self.zones.is_empty() {
            return self.ambient;
        }

        let sum: f64 = self.zones.values().map(|z| z.temperature).sum();
        sum / self.zones.len() as f64
    }
}