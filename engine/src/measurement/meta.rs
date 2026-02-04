use crate::state::phone_state::PhoneState;

pub fn apply_meta_effects(state: &mut PhoneState, repetition: f64) {
    let factor = repetition.min(10.0);

    // noise sistemik meningkat
    state.electrical.transient_noise *= 1.0 + 0.05 * factor;

    // panas naik perlahan (false stability)
    for (_id, zone) in state.thermal.zones.iter_mut() {
        zone.heat_generation *= 1.0 + 0.02 * factor;
    }
}
