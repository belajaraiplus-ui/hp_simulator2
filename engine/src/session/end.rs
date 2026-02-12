use crate::state::phone_state::PhoneState;
use crate::session::termination::SessionTermination;
use crate::outcome::classify::classify_outcome;
use crate::outcome::taxonomy::SessionOutcome;
use crate::outcome::narrative::{build_narrative, OutcomeNarrative};

/// Satu-satunya pintu evaluasi akhir sesi.
/// Dipanggil SETELAH simulasi berhenti.
/// 
/// Kontrak keras:
/// - termination dievaluasi sekali
/// - outcome dan narrative selalu konsisten
/// - tidak ada versi parsial
pub fn end_session(state: &PhoneState) -> (SessionOutcome, OutcomeNarrative) {
    let status = SessionTermination::evaluate(state);

    let outcome = classify_outcome(state, &status);

    let narrative = build_narrative(state, &outcome);

    (outcome, narrative)
}
