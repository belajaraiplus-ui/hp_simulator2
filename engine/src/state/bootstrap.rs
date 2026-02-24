use std::collections::HashMap;

use crate::core::rng::SimRng;
use crate::power::graph::DependencyGraph;
use crate::power::rail::Rail;
use crate::state::electrical::{ElectricalState, PowerInput};
use crate::state::fatigue::MeasurementFatigue;
use crate::state::ids::{RailId, ThermalZoneId};
use crate::state::material::MaterialState;
use crate::state::phone_state::{FaultRegistry, MeasurementLog, PhoneState};
use crate::state::thermal::{ThermalState, ThermalZone};
use crate::state::StressState;

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
            temperature: 30.0,
            thermal_mass: 80.0,
            heat_generation: 0.0,
            heat_dissipation: 0.0,
            coupling: vec![],
        },
    );

    let mut power_graph = DependencyGraph::new();
    // VBUS_5V (Vchg) -> VBAT
    power_graph.add_regulator(RailId::Vchg, RailId::Vbat);
    // VBAT -> VCORE
    power_graph.add_regulator(RailId::Vbat, RailId::Vcore);

    PhoneState {
        time: 0.0,
        electrical: ElectricalState {
            rails,
            ground_integrity: 1.0,
            transient_noise: 0.01,
            extra_load_a: 0.0,
            input: PowerInput::new(),
        },
        thermal: ThermalState {
            ambient: 30.0,
            zones,
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
        rng: SimRng::new(123_456_789),
        power_graph,
    }
}
