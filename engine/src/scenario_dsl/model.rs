use serde::Deserialize;

/// Representasi DSL Scenario (data-only).
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioDsl {
    pub id: String,
    pub title: String,

    pub world_profile: String,

    pub customer_complaint: String,
    pub background_story: String,

    pub constraints: Option<ConstraintsDsl>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConstraintsDsl {
    pub tools: Option<String>,
    pub time_pressure: Option<String>,
}
