export async function runSequence(engine) {
  const out = [];

  function snap(label) {
    const s = engine.build_snapshot();
    out.push({ label, snapshot: s });
  }

  engine.measure_voltage("Vbat");
  engine.step(0.1);
  snap("after_measure_1");

  engine.measure_voltage("Vbat");
  engine.step(0.1);
  snap("after_measure_2");

  engine.measure_temperature("Soc");
  engine.step(0.1);
  snap("after_temp");

  engine.inject_voltage("Vbat", 4.2, 0.5);
  engine.step(0.5);
  snap("after_injection");

  engine.measure_voltage("Vbat");
  snap("final");

  return {
    snapshots: out,
    measurements: engine.export_measurements(),
    ground_truth: engine.export_ground_truth(),
  };
}
