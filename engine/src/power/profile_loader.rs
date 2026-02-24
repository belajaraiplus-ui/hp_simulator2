use crate::power::rail::Rail;
use crate::state::ids::RailId;
use crate::state::phone_state::PhoneState;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct JsonRail {
    pub id: RailId, // langsung enum! no String
    pub expected: JsonExpected,
}

#[derive(Deserialize)]
pub struct JsonExpected {
    pub voltage_v: Range,
    pub diode_drop_v: Range,
    pub r2g_ohms: Nominal,
    pub continuity: Threshold,
}

#[derive(Deserialize)]
pub struct Range {
    pub min: f64,
    pub max: f64,
}

#[derive(Deserialize)]
pub struct Nominal {
    pub nominal: f64,
}

#[derive(Deserialize)]
pub struct Threshold {
    pub beep_below_ohms: f64,
}

/// rails.json → inject langsung ke PhoneState.electrical.rails
pub fn load_into_state(json_data: &str, state: &mut PhoneState) {
    let raw_rails: Vec<JsonRail> = serde_json::from_str(json_data).expect("Invalid rails.json");

    for r in raw_rails {
        let target_voltage = (r.expected.voltage_v.min + r.expected.voltage_v.max) / 2.0;

        let rail = state.electrical.rails.entry(r.id).or_insert_with(|| {
            let mut rail = Rail::new(r.id);
            rail.target_voltage = target_voltage;
            rail
        });

        rail.expected.v_min = r.expected.voltage_v.min;
        rail.expected.v_max = r.expected.voltage_v.max;
        rail.expected.diode_min = r.expected.diode_drop_v.min;
        rail.expected.diode_max = r.expected.diode_drop_v.max;
        rail.expected.continuity_beep_below_ohms = r.expected.continuity.beep_below_ohms;
        rail.health.resistance_to_ground = r.expected.r2g_ohms.nominal.max(1e-6_f64);
    }
}
