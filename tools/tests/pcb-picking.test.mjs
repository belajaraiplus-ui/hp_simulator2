import assert from "node:assert/strict";
import { buildBoardRuntime } from "../../web-app/src/pcb_viewer/viewer/spatial_index.js";
import { pickBoardTarget, resolveMeasurementTarget } from "../../web-app/src/pcb_viewer/viewer/picking.js";

const runtime = buildBoardRuntime({
  board: {
    id: "test_board",
    image: { full_width_px: 1000, full_height_px: 1000 },
    data_space: { width_px: 1000, height_px: 1000 },
  },
  rails: [
    {
      id: "VBAT",
      label: "VBAT",
      type: "power",
      expected: { voltage_v: { min: 4.0, max: 4.2 } },
      overlay: { type: "multi_poly", polys: [[[100, 100], [300, 100], [300, 300], [100, 300]]] },
      probe_points: [{ id: "TP_VBAT", x: 140, y: 140, label: "TP_VBAT" }],
    },
  ],
  components: [
    {
      id: "U100",
      refdes: "U100",
      kind: "IC",
      bbox: { x: 120, y: 120, w: 90, h: 70 },
      shape: { type: "poly", points: [[120, 120], [210, 120], [210, 190], [120, 190]] },
      hints: { rails: ["MISSING_RAIL"] },
    },
  ],
  topology: { nodes: ["VBAT"], edges: [] },
  railFile: { defaults: { continuity: { beep_below_ohms: 50, open_above_ohms: 200 } } },
});

const probePick = pickBoardTarget(runtime, {
  board: { x: 140, y: 140 },
  image: { x: 140, y: 140 },
});
assert.equal(probePick.type, "probe", "probe should win over overlapping component and rail");
assert.equal(resolveMeasurementTarget(probePick).railId, "VBAT");

const componentPick = pickBoardTarget(runtime, {
  board: { x: 160, y: 170 },
  image: { x: 160, y: 170 },
});
assert.equal(componentPick.type, "component", "component should win over rail when no probe is hit");
assert.equal(resolveMeasurementTarget(componentPick).componentId, "U100");
assert.deepEqual(runtime.componentsById.U100.rails, ["VBAT"], "component should derive nearest valid rail when hints are invalid");

const railPick = pickBoardTarget(runtime, {
  board: { x: 260, y: 260 },
  image: { x: 260, y: 260 },
});
assert.equal(railPick.type, "rail", "rail should be returned when only overlay is hit");
assert.equal(resolveMeasurementTarget(railPick).railId, "VBAT");

const missPick = pickBoardTarget(runtime, {
  board: { x: 900, y: 900 },
  image: { x: 900, y: 900 },
});
assert.equal(missPick, null, "pick should return null outside measurable geometry");

console.log("pcb picking tests: OK");
