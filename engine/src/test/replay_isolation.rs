use hp_simulator::measurement::engine::MeasurementEngine;
use hp_simulator::measurement::injection::VoltageInjection;
use hp_simulator::postmortem::ground_truth::GroundTruthBuilder;
use hp_simulator::session::termination::SessionTermination;
use hp_simulator::state::bootstrap::bootstrap_state;

/// Jalankan satu sesi simulasi dengan urutan aksi tetap
fn run_session() -> (String, String, String) {
    let mut state = bootstrap_state();

    // === SCRIPT AKSI TEKNIS (DETERMINISTIK) ===
    MeasurementEngine::measure_voltage(&mut state, hp_simulator::state::ids::RailId::Vbat);
    state.time += 0.1;

    MeasurementEngine::measure_voltage(&mut state, hp_simulator::state::ids::RailId::Vbat);
    state.time += 0.1;

    MeasurementEngine::measure_temperature(&mut state, "soc".to_string());
    state.time += 0.1;

    VoltageInjection::inject_voltage(&mut state, hp_simulator::state::ids::RailId::Vbat, 4.2, 0.5);
    state.time += 0.5;

    MeasurementEngine::measure_voltage(&mut state, hp_simulator::state::ids::RailId::Vbat);

    // === TERMINATION CHECK ===
    let status = SessionTermination::evaluate(&state);
    let reason = status
        .reason
        .unwrap_or(hp_simulator::session::termination::TerminationReason::VoluntaryStop);

    // === CAPTURE OUTPUT ===

    let snapshot =
        serde_json::to_string(&hp_simulator::api::snapshot::build_snapshot(&state)).unwrap();

    let measurements = serde_json::to_string(&state.measurements.history).unwrap();

    let ground_truth = serde_json::to_string(&GroundTruthBuilder::build(&state, reason)).unwrap();

    (snapshot, measurements, ground_truth)
}

#[test]
fn paid_access_isolation_replay_test() {
    let (snap_a, meas_a, gt_a) = run_session();
    let (snap_b, meas_b, gt_b) = run_session();

    // === ASSERT IDENTICAL OUTPUT ===
    assert_eq!(snap_a, snap_b, "Snapshot mismatch between sessions");
    assert_eq!(meas_a, meas_b, "Measurement history mismatch");
    assert_eq!(gt_a, gt_b, "Ground truth mismatch");
}
