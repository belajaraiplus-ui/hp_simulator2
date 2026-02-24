use std::fs;
use std::path::Path;

use crate::scenario::scenario::Scenario;
use crate::scenario_dsl::model::ScenarioDsl;
use crate::world::presets;

/// Load DSL scenario dari file JSON.
/// Tidak boleh gagal diam-diam.
pub fn load_scenario_from_json<P: AsRef<Path>>(path: P) -> Result<Scenario, String> {
    let raw =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read scenario file: {}", e))?;

    let dsl: ScenarioDsl =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid scenario DSL: {}", e))?;

    // =======================
    // WORLD PROFILE RESOLUTION
    // =======================
    let world = match dsl.world_profile.as_str() {
        "IDEAL_BENCH" => &presets::IDEAL_BENCH,
        "HOT_HUMID_WORKSHOP" => &presets::HOT_HUMID_WORKSHOP,
        "PREVIOUSLY_REPAIRED_DEVICE" => &presets::PREVIOUSLY_REPAIRED_DEVICE,
        _ => return Err(format!("Unknown world_profile: {}", dsl.world_profile)),
    };

    // =======================
    // BUILD SCENARIO (SAFE)
    // =======================
    Ok(Scenario {
        id: Box::leak(dsl.id.into_boxed_str()),
        title: Box::leak(dsl.title.into_boxed_str()),
        world,

        customer_complaint: Box::leak(dsl.customer_complaint.into_boxed_str()),
        background_story: Box::leak(dsl.background_story.into_boxed_str()),

        tool_limit: dsl
            .constraints
            .as_ref()
            .and_then(|c| c.tools.as_ref())
            .map(|s| Box::leak(s.clone().into_boxed_str()) as &'static str),

        time_pressure: dsl
            .constraints
            .as_ref()
            .and_then(|c| c.time_pressure.as_ref())
            .map(|s| Box::leak(s.clone().into_boxed_str()) as &'static str),

        notes: dsl
            .notes
            .map(|n| Box::leak(n.into_boxed_str()) as &'static str)
            .unwrap_or(""),
    })
}
