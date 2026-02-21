use super::phone_state::PhoneState;

pub fn assert_invariants(s: &PhoneState) {
    // =======================
    // ELECTRICAL SANITY
    // =======================
    for (_id, r) in s.electrical.rails.iter() {
        assert!(r.health.capacitance > 0.0, "Capacitance must be > 0");
        assert!(r.health.esr >= 0.0, "ESR must be >= 0");
    }

    // =======================
    // TIME MUST MOVE FORWARD
    // =======================
    assert!(s.time >= 0.0, "Simulation time cannot be negative");

    // =======================
    // STRESS DOMAINS NON-NEGATIVE
    // =======================
    assert!(s.stress.electrical >= 0.0, "Electrical stress cannot be negative");
    assert!(s.stress.thermal >= 0.0, "Thermal stress cannot be negative");
    assert!(s.stress.measurement >= 0.0, "Measurement stress cannot be negative");

    // =======================
    // FAULT INTENSITY SANITY
    // =======================
    for (_id, f) in s.faults.active.iter() {
        assert!(f.intensity >= 0.0, "Fault intensity cannot be negative");
        assert!(f.intensity <= 1.0, "Fault intensity cannot exceed 1.0");
    }
}
