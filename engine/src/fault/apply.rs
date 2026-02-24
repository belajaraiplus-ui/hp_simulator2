use crate::state::phone_state::PhoneState;

/// Apply fault effects ke Rail model.
/// Dipanggil tiap tick sebelum evaluator.
pub fn apply_faults(state: &mut PhoneState) {
    for (_fault_id, _fault) in state.faults.active.iter() {
        // Untuk sekarang, fault engine mengelola intensity & phase
        // Health effects akan diinjeksi nanti di propagate_faults
        // atau bisa langsung di sini jika perlu.
        // (Placeholder untuk architecture consistency)
    }
}
