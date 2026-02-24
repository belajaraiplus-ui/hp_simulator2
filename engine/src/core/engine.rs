// engine/src/core/engine.rs
use crate::state::invariants::assert_invariants;
use crate::state::phone_state::PhoneState;

use crate::fault::apply::apply_faults;
use crate::physics::electrical::step_electrical;
use crate::physics::thermal::step_thermal;

use crate::fault::engine::{propagate_faults, step_faults};
use crate::power::evaluator::PowerEvaluator;
use crate::power::propagate::propagate_power;

use crate::session::guard::check_termination;
use crate::session::state::SessionState;
use crate::session::types::SessionStatus;

pub struct Engine {
    pub dt: f64,
}

impl Engine {
    /// Keep snapshot-facing observable caches in sync with latest physics state.
    /// Snapshot builder reads `last_voltage`/`last_temperature`; without this,
    /// `snapshot` can return null when no explicit measurement command is issued.
    fn sync_snapshot_observables(state: &mut PhoneState) {
        for (rail_id, rail) in state.electrical.rails.iter() {
            state.last_voltage.insert(*rail_id, rail.state.voltage);
        }

        for (zone_id, zone) in state.thermal.zones.iter() {
            state.last_temperature.insert(*zone_id, zone.temperature);
        }
    }

    pub fn step(&self, state: &mut PhoneState, session: &mut SessionState) {
        if session.status != SessionStatus::Running {
            return;
        }

        // =======================
        // ELECTRICAL DOMAIN
        // =======================

        // 1. Evaluasi Topologi (Logic Layer)
        // Menghitung target voltage berdasarkan graph dependency + root inputs (VCHG)
        PowerEvaluator::evaluate(&state.power_graph, &mut state.electrical);

        // 2. Propagasi daya (RC curve untuk voltage settling)
        propagate_power(&state.power_graph, &mut state.electrical, self.dt);

        // 3. Evaluasi Fisika (Physics Layer)
        // Menghitung thermal heating, noise, derating
        step_electrical(state, self.dt);

        // =======================
        // THERMAL DOMAIN
        // =======================
        step_thermal(state, self.dt);

        // =======================
        // FAULT EVOLUTION — FASE 10.1
        // =======================
        step_faults(state, self.dt);
        propagate_faults(state);

        // Keep UI snapshot values numeric and up-to-date on every simulation tick.
        Self::sync_snapshot_observables(state);

        // =======================
        // TIME ADVANCE
        // =======================
        state.time += self.dt;

        // =======================
        // SESSION / SAFETY
        // =======================
        check_termination(state, session);
        assert_invariants(state);
    }
}

pub fn sim_tick(state: &mut PhoneState, dt: f64) {
    // 1. Apply fault dulu (ubah health/status)
    apply_faults(state);

    // 2. Dependency causal layer
    // TODO: Need to add power_graph field to PhoneState
    // PowerEvaluator::evaluate(
    //     &state.power_graph,
    //     &mut state.electrical.rails,
    // );

    // 3. Physics layer
    step_electrical(state, dt);
}

#[cfg(test)]
mod tests {
    use super::Engine;
    use crate::api::snapshot::build_snapshot;
    use crate::session::state::SessionState;
    use crate::state::bootstrap::bootstrap_state;
    use serde_json::Value;

    #[test]
    fn step_multiple_times_populates_voltage_and_temperature_caches() {
        let engine = Engine { dt: 0.1 };
        let mut state = bootstrap_state();
        let mut session = SessionState::new();

        for _ in 0..5 {
            engine.step(&mut state, &mut session);
        }

        assert!(!state.last_voltage.is_empty());
        assert!(!state.last_temperature.is_empty());
    }

    #[test]
    fn snapshot_rails_and_thermals_are_numeric_after_steps() {
        let engine = Engine { dt: 0.1 };
        let mut state = bootstrap_state();
        let mut session = SessionState::new();

        for _ in 0..5 {
            engine.step(&mut state, &mut session);
        }

        let snapshot = build_snapshot(&state);
        let rails = snapshot
            .get("rails")
            .and_then(Value::as_array)
            .expect("snapshot.rails must be an array");
        let thermals = snapshot
            .get("thermals")
            .and_then(Value::as_array)
            .expect("snapshot.thermals must be an array");

        assert!(!rails.is_empty());
        assert!(!thermals.is_empty());
        assert!(rails
            .iter()
            .all(|r| { r.get("voltage").map(Value::is_number).unwrap_or(false) }));
        assert!(thermals
            .iter()
            .all(|z| { z.get("temperature").map(Value::is_number).unwrap_or(false) }));
    }
}
