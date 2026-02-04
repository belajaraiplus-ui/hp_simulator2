// engine/src/state/phone_state.rs
use std::collections::HashMap;

use crate::state::ids::{RailId, ThermalZoneId, ComponentId, FaultId};
use crate::fault::model::FaultInstance;

/// PHONE STATE — Single Source of Truth
///
/// File ini menyatukan representasi fisik & historis dari perangkat.
/// Jangan buat helper yang 'peek' ke internal state dari luar measurement engine.

// =======================
// ELECTRICAL
// =======================

/// Power rail model (non-ideal)
#[derive(Debug, Clone)]
pub struct PowerRail {
    pub voltage: f64,
    pub target_voltage: f64,

    pub load_current: f64,
    pub leakage_current: f64,

    pub capacitance: f64,
    pub esr: f64,

    pub ripple: f64,
    pub noise: f64,
}

#[derive(Debug, Clone)]
pub struct ElectricalState {
    pub rails: HashMap<RailId, PowerRail>,
    pub ground_integrity: f64,
    pub transient_noise: f64,
}

// =======================
// THERMAL
// =======================

#[derive(Clone)]
pub struct ThermalZone {
    pub temperature: f64,
    pub thermal_mass: f64,

    /// heat_generation harus diisi oleh electrical / fault engine setiap step
    pub heat_generation: f64,
    pub heat_dissipation: f64,

    /// coupling ke zona lain: (other_zone, coefficient)
    pub coupling: Vec<(ThermalZoneId, f64)>,
}

#[derive(Clone)]
pub struct ThermalState {
    pub ambient: f64,
    pub zones: HashMap<ThermalZoneId, ThermalZone>,
}

// =======================
// MATERIAL
// =======================

pub struct MaterialState {
    pub aging_map: HashMap<ComponentId, f64>,
}

// =======================
// MEASUREMENT LOG
// =======================

pub struct MeasurementEvent {
    pub time: f64,
    pub target: String,
    pub observed_value: f64,
    pub noise: f64,
    pub injected_energy: f64,
    pub stress_added: f64,
}

pub struct MeasurementLog {
    pub history: Vec<MeasurementEvent>,
}

// =======================
// STRESS STATE
// =======================

pub struct StressState {
    pub electrical: f64,
    pub thermal: f64,
    pub measurement: f64,
}

// =======================
// MEASUREMENT FATIGUE
// =======================

pub struct MeasurementFatigue {
    pub counts: HashMap<(String, String), u32>,
}

// =======================
// FAULT REGISTRY
// =======================

pub struct FaultRegistry {
    pub active: HashMap<FaultId, FaultInstance>,
}

// =======================
// PHONE STATE (ROOT)
// =======================

pub struct PhoneState {
    pub time: f64,

    pub electrical: ElectricalState,
    pub thermal: ThermalState,

    pub measurements: MeasurementLog,
    pub stress: StressState,

    pub fatigue: MeasurementFatigue,
    pub faults: FaultRegistry,

    // last observed values (UI proxy)
    pub last_voltage: HashMap<RailId, f64>,
    pub last_temperature: HashMap<ThermalZoneId, f64>,

    pub material: MaterialState,
}

// =======================
// SMALL HELPERS
// =======================

impl MeasurementLog {
    pub fn new() -> Self {
        Self { history: Vec::new() }
    }
}

impl MeasurementFatigue {
    pub fn new() -> Self {
        Self { counts: HashMap::new() }
    }
}

impl FaultRegistry {
    pub fn new() -> Self {
        Self { active: HashMap::new() }
    }
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

impl PhoneState {
    pub fn minimal() -> Self {
        Self {
            time: 0.0,
            electrical: ElectricalState {
                rails: HashMap::new(),
                ground_integrity: 1.0,
                transient_noise: 0.0,
            },
            thermal: ThermalState {
                ambient: 25.0,
                zones: HashMap::new(),
            },
            measurements: MeasurementLog::new(),
            stress: StressState::new(),
            fatigue: MeasurementFatigue::new(),
            faults: FaultRegistry::new(),
            last_voltage: HashMap::new(),
            last_temperature: HashMap::new(),
            material: MaterialState {
                aging_map: HashMap::new(),
            },
        }
    }
}

// =======================
// THERMAL HELPER (dipakai fault engine)
// =======================

impl ThermalState {
    /// Weighted average temperature across zones
    pub fn average(&self) -> f64 {
        if self.zones.is_empty() {
            return self.ambient;
        }

        let mut weighted = 0.0;
        let mut total_mass = 0.0;

        for z in self.zones.values() {
            let m = z.thermal_mass.max(1.0);
            weighted += z.temperature * m;
            total_mass += m;
        }

        if total_mass > 0.0 {
            weighted / total_mass
        } else {
            self.ambient
        }
    }
}

impl ElectricalState {
    /// Total instantaneous load across all rails
    /// Dipakai oleh fault + thermal coupling
    pub fn total_load(&self) -> f64 {
        self.rails
            .values()
            .map(|r| r.load_current + r.leakage_current)
            .sum()
    }
}

