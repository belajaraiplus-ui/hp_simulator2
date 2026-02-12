use crate::state::bootstrap::bootstrap_state;
use crate::state::phone_state::PhoneState;

use crate::world::profile::{apply_world_profile, WorldProfile};

use crate::scenario::scenario::Scenario;
use crate::scenario_dsl::loader::load_scenario_from_json;

/// =======================================
/// CORE SESSION START (WORLD-ONLY)
/// =======================================
///
/// Digunakan oleh:
/// - test internal
/// - skenario hardcoded
/// - recovery / debug mode terbatas
///
/// Engine TIDAK tahu UI / payment / user.
pub fn start_new_session(profile: &WorldProfile) -> PhoneState {
    let mut state = bootstrap_state();

    // =======================
    // WORLD CONTEXT IS LOCKED HERE
    // =======================
    apply_world_profile(&mut state, profile);

    state
}

/// =======================================
/// SESSION START VIA SCENARIO DSL
/// =======================================
///
/// SATU-SATUNYA pintu sah untuk gameplay normal.
/// UI hanya memilih FILE.
/// Engine hanya menerima WorldProfile.
///
/// Tidak ada parsing DSL di engine loop.
pub fn start_session_from_scenario(
    scenario_path: &str,
) -> Result<(Scenario, PhoneState), String> {
    // =======================
    // LOAD & VALIDATE SCENARIO (DATA-ONLY)
    // =======================
    let scenario = load_scenario_from_json(scenario_path)?;

    // =======================
    // BOOTSTRAP + WORLD LOCK
    // =======================
    let state = start_new_session(scenario.world);

    Ok((scenario, state))
}
