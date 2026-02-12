import init, * as engine from "../wasm/engine.js";

let initialized = false;

export async function bootEngine() {
  if (!initialized) {
    await init();
    engine.init(0.01); // sesuai API Rust kamu
    initialized = true;
  }
  return snapshot();
}

export function step() {
  engine.dispatch(JSON.stringify({ kind: "step" }));
  return snapshot();
}

export function snapshot() {
  const res = engine.dispatch(JSON.stringify({ kind: "snapshot" }));
  const data = JSON.parse(res);
  return data.snapshot;
}
