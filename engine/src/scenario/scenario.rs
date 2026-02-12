use crate::world::profile::WorldProfile;

/// Scenario = situasi bengkel nyata.
/// BUKAN teka-teki, BUKAN fault list.
#[derive(Clone)]
pub struct Scenario {
    pub id: &'static str,
    pub title: &'static str,

    // =======================
    // NARRATIVE CONTEXT
    // =======================
    pub customer_complaint: &'static str,
    pub background_story: &'static str,

    // =======================
    // WORLD CONTEXT
    // =======================
    pub world: &'static WorldProfile,

    // =======================
    // WORKSHOP CONSTRAINTS
    // =======================
    pub tool_limit: Option<&'static str>,
    pub time_pressure: Option<&'static str>,

    // =======================
    // META
    // =======================
    pub notes: &'static str,
}
