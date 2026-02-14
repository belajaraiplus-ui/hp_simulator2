use std::collections::HashMap;

use crate::state::ids::{RailId, ThermalZoneId, ComponentId, FaultId};
use crate::fault::model::FaultInstance;
use crate::core::rng::SimRng;

/// PHONE STATE — Single Source of Truth
/// Semua representasi fisik & historis perangkat ada di sini.
/// Jangan expose ground-truth ke UI. Snapshot hanya boleh proxy.

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

/// External bench PSU representation
#[derive(Debug, Clone)]
pub struct PowerInput {
    pub enabled: bool,
    pub voltage: f64,
    pub current_limit: f64,
    pub measured_current: f64,
}

impl PowerInput {
    pub fn new() -> Self {
        Self {
            enabled: false,
            voltage: 0.0,
            current_limit: 0.0,
            measured_current: 0.0,
        }
    }

    pub fn apply_config(&mut self, voltage: f64, current_limit: f64, enabled: bool) {
        self.enabled = enabled;
        self.voltage = voltage;
        self.current_limit = current_limit;
    }

    pub fn set_measured_current(&mut self, current: f64) {
        self.measured_current = current;
    }
}

#[derive(Debug, Clone)]
pub struct ElectricalState {
    pub rails: HashMap<RailId, PowerRail>,
    pub ground_integrity: f64,
    pub transient_noise: f64,

    /// External power source (bench PSU)
    pub input: PowerInput,
}

impl ElectricalState {
    /// Total instantaneous load across all rails
    pub fn total_load(&self) -> f64 {
        self.rails
            .values()
            .map(|r| r.load_current + r.leakage_current)
            .sum()
    }

    pub fn apply_psu_config(&mut self, voltage: f64, current_limit: f64, enabled: bool) {
        self.input.apply_config(voltage, current_limit, enabled);
    }

    pub fn set_input_measured_current(&mut self, current: f64) {
        self.input.set_measured_current(current);
    }
}

// =======================
// THERMAL
// =======================

#[derive(Clone)]
pub struct ThermalZone {
    pub temperature: f64,
    pub thermal_mass: f64,

    /// Diisi oleh electrical / fault engine setiap step
    pub heat_generation: f64,
    pub heat_dissipation: f64,

    /// Coupling antar zona
    pub coupling: Vec<(ThermalZoneId, f64)>,
}

#[derive(Clone)]
pub struct ThermalState {
    pub ambient: f64,
    pub zones: HashMap<ThermalZoneId, ThermalZone>,
}

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

impl MeasurementLog {
    pub fn new() -> Self {
        Self { history: Vec::new() }
    }
}

// =======================
// STRESS STATE
// =======================

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

// =======================
// MEASUREMENT FATIGUE
// =======================

pub struct MeasurementFatigue {
    pub counts: HashMap<(String, String), u32>,
}

impl MeasurementFatigue {
    pub fn new() -> Self {
        Self { counts: HashMap::new() }
    }
}

// =======================
// FAULT REGISTRY
// =======================

pub struct FaultRegistry {
    pub active: HashMap<FaultId, FaultInstance>,
}

impl FaultRegistry {
    pub fn new() -> Self {
        Self { active: HashMap::new() }
    }
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

    /// Proxy-only (untuk UI)
    pub last_voltage: HashMap<RailId, f64>,
    pub last_temperature: HashMap<ThermalZoneId, f64>,

    pub material: MaterialState,

    /// DETERMINISTIC RNG
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
            faults: FaultRegistry::new(),
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
