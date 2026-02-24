use crate::state::phone_state::PhoneState;

pub fn repetition_factor(state: &mut PhoneState, tool: &str, target: &str) -> f64 {
    let key = (tool.to_string(), target.to_string());
    let counter = state.fatigue.counts.entry(key).or_insert(0);
    *counter += 1;

    // non-linear (kuadrat)
    (*counter as f64).powi(2).max(1.0)
}
