use std::collections::HashMap;

use crate::state::phone_state::*;
use crate::state::ids::*;
use crate::core::rng::SimRng; // ⬅️ DITAMBAHKAN

pub fn bootstrap_state() -> PhoneState {
    // =======================
    // ELECTRICAL RAILS
    // =======================

    let mut rails = HashMap::new();

    // VBAT
    rails.insert(
        RailId::Vbat,
        PowerRail {
            voltage: 3.8,
            target_voltage: 3.8,
            load_current: 0.1,
            leakage_current: 0.01,
            capacitance: 0.01,
            esr: 0.05,
            ripple: 0.02,
            noise: 0.0,
        },
    );

    // VIO
    rails.insert(
        RailId::Vio,
        PowerRail {
            voltage: 1.8,
            target_voltage: 1.8,
            load_current: 0.03,
            leakage_current: 0.005,
            capacitance: 0.002,
            esr: 0.03,
            ripple: 0.01,
            noise: 0.0,
        },
    );

    // VCORE
    rails.insert(
        RailId::Vcore,
        PowerRail {
            voltage: 0.9,
            target_voltage: 1.0,
            load_current: 0.05,
            leakage_current: 0.01,
            capacitance: 0.001,
            esr: 0.02,
            ripple: 0.01,
            noise: 0.0,
        },
    );

    // =======================
    // THERMAL ZONES
    // =======================

    let mut zones = HashMap::new();

    zones.insert(
        ThermalZoneId::Soc,
        ThermalZone {
            temperature: 35.0,
            thermal_mass: 50.0,
            heat_generation: 0.0,
            heat_dissipation: 0.0,
            coupling: vec![(ThermalZoneId::Board, 0.15)],
        },
    );

    zones.insert(
        ThermalZoneId::Board,
        ThermalZone {
            temperature: 35.0,
            thermal_mass: 120.0,
            heat_generation: 0.0,
            heat_dissipation: 0.0,
            coupling: vec![(ThermalZoneId::Soc, 0.1)],
        },
    );

    // =======================
    // FINAL PHONE STATE
    // =======================

    PhoneState {
        time: 0.0,

        electrical: ElectricalState {
            rails,
            ground_integrity: 1.0,
            transient_noise: 0.01,
        },

        thermal: ThermalState {
            ambient: 30.0,
            zones,
        },

        measurements: MeasurementLog::new(),

        stress: StressState::new(),

        fatigue: MeasurementFatigue::new(),

        faults: FaultRegistry::new(),

        // last-seen measurement (UI proxy)
        last_voltage: HashMap::new(),
        last_temperature: HashMap::new(),

        material: MaterialState {
            aging_map: HashMap::new(),
        },

        // =======================
        // DETERMINISTIC RNG (WAJIB)
        // =======================
        rng: SimRng::new(123_456_789),
    }
}
