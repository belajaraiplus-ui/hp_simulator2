use crate::session::state::SessionState;
use crate::session::types::{EventSeverity, SessionEndReason};
use crate::state::phone_state::PhoneState;

pub fn check_termination(state: &PhoneState, session: &mut SessionState) {
    // =======================
    // THERMAL RUNAWAY (langsung dari domain thermal)
    // =======================
    let max_temp = state
        .thermal
        .zones
        .values()
        .map(|z| z.temperature)
        .fold(f64::NEG_INFINITY, f64::max);

    if max_temp > 120.0 {
        session.emit(
            state.time,
            "Thermal instability detected",
            EventSeverity::Critical,
        );
        session.terminate(SessionEndReason::ThermalRunaway);
        return;
    }

    // =======================
    // PERMANENT DAMAGE (agregat multi-domain)
    // =======================
    let total_stress = state.stress.electrical + state.stress.thermal + state.stress.measurement;

    if total_stress > 50.0 {
        session.emit(
            state.time,
            "Combined electrical / thermal degradation exceeded recovery margin",
            EventSeverity::Critical,
        );
        session.terminate(SessionEndReason::PermanentDamage);
    }
}
