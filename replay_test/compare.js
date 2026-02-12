import fs from "fs";

const free = JSON.parse(fs.readFileSync("free_result.json"));
const paid = JSON.parse(fs.readFileSync("paid_result.json"));

function assertEqual(a, b, path) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error("❌ MISMATCH at", path);
    process.exit(1);
  }
}

assertEqual(free.snapshots, paid.snapshots, "snapshots");
assertEqual(free.measurements, paid.measurements, "measurements");
assertEqual(free.ground_truth, paid.ground_truth, "ground_truth");

console.log("✅ REPLAY TEST PASSED: FREE === PAID");
