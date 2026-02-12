// =====================================================
// IMPORTS — WASM ENGINE (GENERATED)
// =====================================================
import init, * as engine from "./wasm/engine.js";

// =====================================================
// DOM REFERENCES
// =====================================================
const output = document.getElementById("output");
const btnStep = document.getElementById("stepBtn");
const btnReset = document.getElementById("btn-reset");

// =====================================================
// ENGINE SESSION (SINGLE SOURCE OF TRUTH)
// =====================================================
let session = null;

// =====================================================
// BOOTSTRAP
// =====================================================
async function boot() {
  // 1) Load & init WASM
  await init();

  // 2) Create a fresh engine session
  //    (scenario MUST be provided by engine or passed as raw data)
  session = engine.create_session(/* scenario payload */);

  log("Engine initialized");
  render(session.snapshot());

  // 3) Wire UI events (NO AUTO LOOP, NO TIME LOGIC)
  btnStep.onclick = stepOnce;
  btnReset.onclick = resetSession;
}

// =====================================================
// ACTIONS (UI TRIGGERS ONLY)
// =====================================================
function stepOnce() {
  // UI triggers EXACTLY ONE deterministic step
  // dt is explicit and constant
  session.step(1.0);

  render(session.snapshot());
}

function resetSession() {
  session = engine.create_session(/* same scenario payload */);
  log("Session reset");
  render(session.snapshot());
}

// =====================================================
// RENDERING (READ-ONLY)
// =====================================================
function render(snapshot) {
  // UI NEVER mutates snapshot
  // UI NEVER derives new state that feeds back to engine

  output.textContent = JSON.stringify(snapshot, null, 2);
}

// =====================================================
// LOGGING (UI ONLY)
// =====================================================
function log(msg) {
  output.textContent += msg + "\n";
  output.scrollTop = output.scrollHeight;
}

// =====================================================
// START
// =====================================================
boot();
