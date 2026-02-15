import init, * as engine from "../wasm/engine.js";

let initialized = false;

/**
 * Safe JSON dispatch:
 * - Accepts JS object
 * - Returns parsed JSON (or throws with context if invalid)
 */
function dispatchJson(payload) {
  const raw = engine.dispatch(JSON.stringify(payload));
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("engine returned non-JSON", { raw, payload });
    throw e;
  }
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
  dispatchJson({ version: 1, kind: "step" });
  return snapshot();
}

export function snapshot() {
  const data = dispatchJson({ version: 1, kind: "snapshot" });
  return data.snapshot;
}

/**
 * Legacy measurement API (kept for backward compatibility).
 * Existing engine expects: { kind: "measure", tool: "vbat" }
 */
export function measureTool(toolLabel) {
  const data = dispatchJson({ version: 1, kind: "measure", tool: toolLabel });
  if (!data?.ok) {
    console.error("measurement failed", data);
    return null;
  }
  return data.measurement;
}

/**
 * New measurement API for PCB Viewer.
 * Recommended request:
 * {
 *   version: 1,
 *   kind: "measure",
 *   payload: {
 *     mode: "voltage" | "ohm" | "diode" | "temp" | ...,
 *     target: { type: "rail" | "component", id: "VBAT" }
 *   }
 * }
 *
 * Backward compatible behavior:
 * - If engine doesn't support payload/target yet, this will likely return ok:false.
 * - In that case, you can optionally fallback to legacy mapping via options.fallbackToolLabel.
 */
export function measureTarget(target, mode = "voltage", options = {}) {
  const req = {
    version: 1,
    kind: "measure",
    payload: {
      mode,
      target,
    },
  };

  const data = dispatchJson(req);

  if (data?.ok) return data.measurement;

  // Optional fallback to legacy tool labels while engine is being upgraded
  if (options.fallbackToolLabel) {
    return measureTool(options.fallbackToolLabel);
  }

  console.error("measurement (target) failed", { data, req });
  return null;
}

/**
 * Convenience: measure rail by id.
 * Example: measureRail("VBAT") will try structured target first,
 * and can fallback to legacy "vbat" if you pass fallback mapping.
 */
export function measureRail(railId, mode = "voltage", options = {}) {
  return measureTarget({ type: "rail", id: railId }, mode, options);
}

/**
 * Convenience: measure component/point by id.
 */
export function measureComponent(componentId, mode = "voltage", options = {}) {
  return measureTarget({ type: "component", id: componentId }, mode, options);
}

export function applyPsuConfig({ voltage, currentLimit, enabled }) {
  const data = dispatchJson({
    version: 1,
    kind: "tool",
    tool: "psu",
    params: {
      voltage,
      current_limit: currentLimit,
      enabled,
    },
  });

  if (!data?.ok) {
    console.error("psu config failed", data);
    return false;
  }

  return true;
}

// Optional convenience (legacy)
export const measureVbat = () => measureTool("vbat");
export const measureVcore = () => measureTool("vcore");
export const measureVio = () => measureTool("vio");
export const measureSocTemp = () => measureTool("soc temp");
export const measureBoardTemp = () => measureTool("board temp");
