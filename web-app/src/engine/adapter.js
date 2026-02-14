import init, * as engine from "../wasm/engine.js";

let initialized = false;

function dispatchJson(payload) {
  const raw = engine.dispatch(JSON.stringify(payload));
  return JSON.parse(raw);
}

export async function bootEngine() {
  if (!initialized) {
    await init();
    engine.init(0.01);
    initialized = true;
  }
  return snapshot();
}

export function step() {
  dispatchJson({ kind: "step" });
  return snapshot();
}

export function snapshot() {
  const data = dispatchJson({ kind: "snapshot" });
  return data.snapshot;
}

export function measureTool(toolLabel) {
  const data = dispatchJson({ kind: "measure", tool: toolLabel });
  if (!data.ok) {
    console.error("measurement failed", data);
    return null;
  }
  return data.measurement;
}

export function applyPsuConfig({ voltage, currentLimit, enabled }) {
  const data = dispatchJson({
    kind: "tool",
    tool: "psu",
    params: {
      voltage,
      current_limit: currentLimit,
      enabled,
    },
  });

  if (!data.ok) {
    console.error("psu config failed", data);
    return false;
  }

  return true;
}

// optional convenience
export const measureVbat = () => measureTool("vbat");
export const measureVcore = () => measureTool("vcore");
export const measureVio = () => measureTool("vio");
export const measureSocTemp = () => measureTool("soc temp");
export const measureBoardTemp = () => measureTool("board temp");
