import initEngine from "../engine/pkg/engine.js";
import { runSequence } from "./sequence.js";
import fs from "fs";

async function run() {
  const engine = await initEngine();

  // PAID MODE:
  // UI boleh punya timer / payment
  // ENGINE TIDAK TAHU
  engine.start_session();

  const result = await runSequence(engine);

  fs.writeFileSync(
    "paid_result.json",
    JSON.stringify(result, null, 2)
  );

  console.log("PAID session finished");
}

run();
