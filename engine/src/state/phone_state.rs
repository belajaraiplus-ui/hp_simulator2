use std::collections::HashMap;
use crate::state::ids::{RailId, ThermalZoneId, FaultId};
use crate::state::electrical::{ElectricalState, PowerInput};
use crate::state::thermal::ThermalState;
use crate::state::stress::StressState;
pub use crate::state::measurement_log::{MeasurementLog, MeasurementEvent};
use crate::state::fatigue::MeasurementFatigue;
use crate::fault::model::FaultInstance;
use crate::state::material::MaterialState;
use crate::core::rng::SimRng;

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
    pub last_temperature: HashMap<ThermalZoneId, f64>,
    pub material: MaterialState,
    pub rng: SimRng,
}

impl PhoneState {
    /// Minimal bootstrap (tanpa rail / zona)
    /// Seed RNG DISET DI SINI
    pub fn minimal() -> Self {
        Self {
            time: 0.0,
            electrical: ElectricalState {
                rails: HashMap::new(),
                ground_integrity: 1.0,
                transient_noise: 0.0,
                input: PowerInput::new(),
            },
            thermal: ThermalState {
                ambient: 25.0,
                zones: HashMap::new(),
            },
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
