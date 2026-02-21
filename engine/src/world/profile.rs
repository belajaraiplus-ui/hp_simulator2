use crate::state::phone_state::*;

/// World Profile = kondisi dunia kerja.
/// BUKAN difficulty. BUKAN mode.
#[derive(Clone)]
pub struct WorldProfile {
    pub name: &'static str,

    // =======================
    // ENVIRONMENT
    // =======================
    pub ambient_temperature: f64,
    pub humidity_factor: f64,          // affects leakage & corrosion
    pub emi_noise_floor: f64,

    // =======================
    // DEVICE HISTORY
    // =======================
    pub device_age_factor: f64,         // material aging baseline
    pub prior_repair_factor: f64,       // solder / pad fatigue

    // =======================
    // ELECTRICAL QUALITY
    // =======================
    pub psu_quality: f64,               // <1.0 = noisy / unstable
    pub ground_integrity: f64,

    // =======================
    // THERMAL CHARACTERISTICS
    // =======================
    pub thermal_dissipation: f64,        // <1.0 = worse cooling
    pub thermal_coupling: f64,           // >1.0 = heat spreads faster

    // =======================
    // OBSERVABILITY BIAS
    // =======================
    pub measurement_bias: f64,           // baseline distortion
}

/// =======================
/// APPLY WORLD PROFILE
/// =======================

pub fn apply_world_profile(state: &mut PhoneState, profile: &WorldProfile) {
    // ---------- ENVIRONMENT ----------
    state.thermal.ambient = profile.ambient_temperature;
    state.electrical.transient_noise += profile.emi_noise_floor;

    // ---------- ELECTRICAL ----------
    state.electrical.ground_integrity *= profile.ground_integrity;

    for (_id, rail) in state.electrical.rails.iter_mut() {
        rail.noise += (1.0 - profile.psu_quality).max(0.0) * 0.05;
        rail.leakage_current *= 1.0 + profile.humidity_factor * 0.1;
    }

    // ---------- THERMAL ----------
    for (_id, zone) in state.thermal.zones.iter_mut() {
        zone.heat_dissipation *= profile.thermal_dissipation;

        for (_, coeff) in zone.coupling.iter_mut() {
            *coeff *= profile.thermal_coupling;
        }
    }

    // ---------- MATERIAL / HISTORY ----------
    for (_comp, aging) in state.material.aging_map.iter_mut() {
        *aging += profile.device_age_factor * 0.2;
        *aging += profile.prior_repair_factor * 0.2;
    }

    // ---------- OBSERVABILITY ----------
    state.stress.measurement += profile.measurement_bias;
}
