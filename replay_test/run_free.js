import initEngine from "../engine/pkg/engine.js";
import { runSequence } from "./sequence.js";
//import fs from "fs"; DISABLE SEMENTARA

async function run() {
  const engine = await initEngine();

  // FREE MODE:
  // UI boleh beda, engine SAMA
  engine.start_session();

  const result = await runSequence(engine);

  //fs.writeFileSync(
  //  "free_result.json",
  //  JSON.stringify(result, null, 2)
 // );

  console.log("FREE session finished");
}

run();
