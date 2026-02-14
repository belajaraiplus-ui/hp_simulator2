use crate::core::engine::Engine;
use crate::measurement::multimeter::VoltageMeter;
use crate::measurement::tool::MeasurementTool;
use crate::state::bootstrap::bootstrap_state;
use crate::session::state::SessionState;

pub fn run() {
    // =======================
    // INIT STATE
    // =======================
    let mut phone_state = bootstrap_state();
    let mut session_state = SessionState::new();

    let engine = Engine { dt: 0.01 };
    let meter = VoltageMeter::new(crate::state::ids::RailId::Vbat);

    // =======================
    // SIMULATION LOOP
    // =======================
    for _ in 0..1000 {
        engine.step(&mut phone_state, &mut session_state);

        // jika sesi sudah berhenti → keluar loop
        if session_state.status != crate::session::types::SessionStatus::Running {
            break;
        }

        let _v = meter.perform(&mut phone_state, 0.0);
    }
}
