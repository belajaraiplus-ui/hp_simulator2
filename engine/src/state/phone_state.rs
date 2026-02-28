use crate::core::rng::SimRng;
use crate::fault::model::FaultInstance;
use crate::power::graph::DependencyGraph;
use crate::state::electrical::ElectricalState;
use crate::state::fatigue::MeasurementFatigue;
use crate::state::ids::{FaultId, RailId};
use crate::state::material::MaterialState;
pub use crate::state::measurement_log::{MeasurementEvent, MeasurementLog};
use crate::state::stress::StressState;
use crate::thermal::ThermalState;
use std::collections::HashMap;

#[derive(Debug, Default)]
pub struct FaultRegistry {
    pub active: HashMap<FaultId, FaultInstance>,
}

#[derive(Debug, Default)]
pub struct PhoneState {
    pub time: f64,
    pub electrical: ElectricalState,
    pub thermal: ThermalState,
    pub measurements: MeasurementLog,
    pub stress: StressState,
    pub fatigue: MeasurementFatigue,
    pub faults: FaultRegistry,
    pub last_voltage: HashMap<RailId, f64>,
    pub last_temperature: HashMap<String, f64>,
    pub material: MaterialState,
    pub rng: SimRng,
    pub power_graph: DependencyGraph,
}

impl PhoneState {
    /// Minimal bootstrap (tanpa rail / zona)
    /// Seed RNG DISET DI SINI
    pub fn minimal() -> Self {
        Self {
            time: 0.0,
            electrical: ElectricalState::default(),
            thermal: ThermalState::new(),
            measurements: MeasurementLog::new(),
            stress: StressState::new(),
            fatigue: MeasurementFatigue::new(),
            faults: FaultRegistry::default(),
            last_voltage: HashMap::new(),
            last_temperature: HashMap::new(),
            material: MaterialState {
                aging_map: HashMap::new(),
            },
            rng: SimRng::new(123_456_789), // deterministic seed
            power_graph: DependencyGraph::new(),
        }
    }

    /// RNG helper — jangan buat RNG lain
    #[inline]
    pub fn rng_f64(&mut self) -> f64 {
        self.rng.f64()
    }

    #[inline]
    pub fn rng_hit(&mut self, probability: f64) -> bool {
        self.rng.bernoulli(probability)
    }
}
