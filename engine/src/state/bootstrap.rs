use std::collections::HashMap;

use crate::core::rng::SimRng;
use crate::power::graph::DependencyGraph;
use crate::power::rail::Rail;
use crate::state::electrical::ElectricalState;
use crate::state::fatigue::MeasurementFatigue;
use crate::state::ids::RailId;
use crate::state::material::MaterialState;
use crate::state::phone_state::{FaultRegistry, MeasurementLog, PhoneState};
use crate::state::StressState;
use crate::thermal::{ThermalLink, ThermalState, ThermalZone};

pub fn bootstrap_state() -> PhoneState {
    let mut rails = HashMap::new();

    let mut vbat = Rail::new(RailId::Vbat);
    vbat.state.voltage = 3.8;
    vbat.target_voltage = 3.8;
    vbat.state.current = 0.1;
    vbat.leakage_current = 0.01;
    rails.insert(RailId::Vbat, vbat);

    let mut vcore = Rail::new(RailId::Vcore);
    vcore.state.voltage = 0.9;
    vcore.target_voltage = 0.9;
    vcore.state.current = 0.05;
    vcore.leakage_current = 0.005;
    rails.insert(RailId::Vcore, vcore);

    let mut vio = Rail::new(RailId::Vio);
    vio.state.voltage = 1.8;
    vio.target_voltage = 1.8;
    vio.state.current = 0.02;
    vio.leakage_current = 0.001;
    rails.insert(RailId::Vio, vio);

    // VCHG (USB Input) - Default Off
    let vchg = Rail::new(RailId::Vchg);
    rails.insert(RailId::Vchg, vchg);

    let mut thermal = ThermalState::new();
    thermal.ambient_c = 30.0;

    thermal.zones.insert(
        "soc".to_string(),
        ThermalZone {
            id: "soc".to_string(),
            temp_c: 35.0,
            thermal_mass: 50.0,
            heat_dissipation: 0.1,
            convection_coefficient: 0.05,
            surface_area: 0.001,
            is_heatsink: false,
            throttling_threshold: 85.0,
        },
    );

    thermal.zones.insert(
        "board".to_string(),
        ThermalZone {
            id: "board".to_string(),
            temp_c: 30.0,
            thermal_mass: 80.0,
            heat_dissipation: 0.05,
            convection_coefficient: 0.03,
            surface_area: 0.01,
            is_heatsink: false,
            throttling_threshold: 100.0,
        },
    );

    thermal.zones.insert(
        "pmic_zone".to_string(),
        ThermalZone {
            id: "pmic_zone".to_string(),
            temp_c: 30.0,
            thermal_mass: 0.7,
            heat_dissipation: 0.4,
            convection_coefficient: 0.1,
            surface_area: 0.0001,
            is_heatsink: false,
            throttling_threshold: 90.0,
        },
    );

    thermal.links.push(ThermalLink {
        a: "soc".into(),
        b: "board".into(),
        conductance: 0.15,
    });

    thermal.links.push(ThermalLink {
        a: "pmic_zone".into(),
        b: "board".into(),
        conductance: 0.25,
    });

    let mut power_graph = DependencyGraph::new();
    // VBUS_5V (Vchg) -> VBAT
    power_graph.add_regulator_with_limit(RailId::Vchg, RailId::Vbat, 3.0_f64);
    // VBAT -> VCORE
    power_graph.add_regulator_with_limit(RailId::Vbat, RailId::Vcore, 6.0_f64);

    PhoneState {
        time: 0.0,
        electrical: ElectricalState {
            rails,
            transient_noise: 0.01,
            ..ElectricalState::default()
        },
        thermal,
        measurements: MeasurementLog::new(),
        stress: StressState::new(),
        fatigue: MeasurementFatigue::new(),
        faults: FaultRegistry::default(),
        last_voltage: HashMap::new(),
        last_temperature: HashMap::new(),
        material: MaterialState {
            aging_map: HashMap::new(),
        },
        rng: SimRng::new(123_456_789),
        power_graph,
    }
}
