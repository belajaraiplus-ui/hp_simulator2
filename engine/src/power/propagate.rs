use crate::power::graph::DependencyGraph;
use crate::state::electrical::ElectricalState;
use crate::state::ids::RailId;

/// Propagate voltages through the power dependency graph.
pub fn propagate_power(graph: &DependencyGraph, electrical: &mut ElectricalState, dt: f64) {
    // STEP 1 — PSU masuk ke VCHG
    if electrical.input.vchg_enabled {
        if let Some(vchg) = electrical.rails.get_mut(&RailId::Vchg) {
            let dv = (electrical.input.vchg_voltage - vchg.state.voltage) * dt / 0.15;

            vchg.state.voltage += dv;
        }
    }

    // STEP 2 — propagate dependency
    for (target, source) in &graph.parents {
        let parent_v = electrical
            .rails
            .get(source)
            .map(|r| r.state.voltage)
            .unwrap_or(0.0);

        if let Some(child) = electrical.rails.get_mut(target) {
            let dv = (parent_v - child.state.voltage) * dt / 0.15;

            child.state.voltage += dv;
        }
    }
}
