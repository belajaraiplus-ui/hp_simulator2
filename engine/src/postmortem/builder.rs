use crate::state::phone_state::PhoneState;
use crate::session::state::SessionState;
use crate::postmortem::types::PostMortem;

/// Postmortem adalah forensik.
/// Di sinilah ground truth boleh muncul.
pub fn build_postmortem(
    state: &PhoneState,
    session: &SessionState,
) -> PostMortem {
    let mut causes = Vec::new();
    let mut errors = Vec::new();
    let mut damage = Vec::new();

    // =======================
    // ROOT CAUSE CHAIN
    // =======================
    for (_fid, inst) in state.faults.active.iter() {
        if inst.intensity > 0.5 {
            causes.push(format!(
                "Fault {:?} reached {:?} phase with intensity {:.2}",
                _fid,
                inst.phase,
                inst.intensity
            ));
        }
    }

    // =======================
    // TECHNICIAN ERRORS
    // =======================
    if state.stress.measurement > 5.0 {
        errors.push("Repeated measurements accumulated significant system stress".to_string());
    }

    if state.measurements.history.len() > 25 {
        errors.push("High measurement frequency reduced diagnostic margin".to_string());
    }

    // =======================
    // IRREVERSIBLE DAMAGE (heuristik awal)
    // =======================
    let total_stress =
        state.stress.electrical +
        state.stress.thermal +
        state.stress.measurement;

    if total_stress > 30.0 {
        damage.push("Combined electrical and thermal degradation became irreversible".to_string());
    }

    // =======================
    // TIMELINE
    // =======================
    let timeline = format!(
        "Session ended at t={:.2}s with reason {:?}",
        state.time,
        session.end_reason
    );

    PostMortem {
        root_cause_chain: causes,
        technician_errors: errors,
        irreversible_damage: damage,
        timeline_summary: timeline,
    }
}
