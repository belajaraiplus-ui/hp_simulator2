use crate::state::phone_state::PhoneState;
use crate::state::invariants::assert_invariants;

use crate::physics::electrical::step_electrical;
use crate::physics::thermal::step_thermal;

use crate::fault::engine::{step_faults, propagate_faults};

use crate::session::state::SessionState;
use crate::session::types::SessionStatus;
use crate::session::guard::check_termination;

pub struct Engine {
    pub dt: f64,
}

impl Engine {
    pub fn step(&self, state: &mut PhoneState, session: &mut SessionState) {
        if session.status != SessionStatus::Running {
            return;
        }

        // =======================
        // ELECTRICAL DOMAIN
        // =======================
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
