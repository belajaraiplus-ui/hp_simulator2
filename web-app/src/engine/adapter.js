import init, * as engine from "./wasm/engine.js";
import { measureRailVoltage } from "../power/runtime.js";

const API_VERSION = 1;
const DEFAULT_TIMEOUT = 5000;

let initialized = false;
let loadTopologyGraphSupported = true;
let warnedLoadTopologyGraphUnsupported = false;

class ApiError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

function validateVersion(payload) {
  if (payload.version === undefined || payload.version === null) {
    throw new ApiError(
      "ERR_INVALID_VERSION",
      "Missing required 'version' field. Supported: 1"
    );
  }
  if (payload.version !== API_VERSION) {
    throw new ApiError(
      "ERR_INVALID_VERSION",
      `Unsupported API version: ${payload.version}. Supported: ${API_VERSION}`
    );
  }
}

function validateResponse(response) {
  if (!response || typeof response !== "object") {
    throw new ApiError(
      "ERR_INVALID_RESPONSE",
      "Engine returned invalid response (not a valid JSON object)"
    );
  }
  if (response.ok === false) {
    throw new ApiError(
      response.code || "ERR_UNKNOWN",
      response.message || "Unknown error",
      response.details
    );
  }
  if (response.ok === undefined) {
    throw new ApiError(
      "ERR_INVALID_RESPONSE",
      "Engine response missing 'ok' field"
    );
  }
  return response;
}

function safeDispatch(payload, options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  
  validateVersion(payload);

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new ApiError(
        "ERR_TIMEOUT",
        `Operation timed out after ${timeout}ms`
      ));
    }, timeout);
  });

  const dispatchPromise = (() => {
    try {
      const raw = engine.dispatch(JSON.stringify(payload));
      return Promise.resolve(JSON.parse(raw));
    } catch (e) {
      return Promise.reject(new ApiError(
        "ERR_DISPATCH_FAILED",
        `Failed to dispatch: ${e.message}`
      ));
    }
  })();

  return Promise.race([dispatchPromise, timeoutPromise])
    .finally(() => clearTimeout(timeoutId))
    .then(validateResponse);
}

function dispatchJson(payload) {
  const raw = engine.dispatch(JSON.stringify(payload));
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("engine returned non-JSON", { raw, payload });
    throw new ApiError("ERR_INVALID_RESPONSE", "Engine returned non-JSON response");
  }
}

// Structured tool_action dispatch (keeps legacy APIs intact)
export function dispatchToolAction(tool_action) {
  try {
    const data = dispatchJson({ version: API_VERSION, kind: "tool", tool_action });
    if (!data?.ok) {
      console.error("tool_action failed", data);
      return data;
    }
    return data;
  } catch (e) {
    console.error("tool_action dispatch error", e);
    return { ok: false, message: e?.message || "tool_action dispatch failed" };
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

export async function step() {
  try {
    await safeDispatch({ version: API_VERSION, kind: "step" });
    return snapshot();
  } catch (e) {
    console.error("step failed:", e);
    throw e;
  }
}

export function dispatch(payload) {
  return engine.dispatch(payload);
}

export async function snapshot() {
  try {
    const data = await safeDispatch({ version: API_VERSION, kind: "snapshot" });
    return data.snapshot;
  } catch (e) {
    console.error("snapshot failed:", e);
    throw e;
  }
}

/**
 * Legacy measurement API (kept for backward compatibility).
 * Existing engine expects: { kind: "measure", tool: "vbat" }
 */
export async function measureTool(toolLabel) {
  try {
    const data = await safeDispatch({ 
      version: API_VERSION, 
      kind: "measure", 
      tool: toolLabel 
    });
    return data.measurement;
  } catch (e) {
    console.error("measurement failed:", e);
    return null;
  }
}

function normalizeMeterMode(mode) {
  const m = String(mode || "").toLowerCase();
  if (m === "voltage") return "voltage";
  if (m === "resistance" || m === "ohm") return "resistance";
  if (m === "continuity") return "continuity";
  if (m === "current" || m === "ampere") return "current";
  if (m === "temperature" || m === "temp") return "temperature";
  return null;
}

export async function multimeterMeasure({ mode, a, b = null }) {
  const normalizedMode = normalizeMeterMode(mode);
  if (!normalizedMode || !a) return null;

  // Step 9: runtime DAG power propagation (voltage only, single-ended)
  if (normalizedMode === "voltage" && a && (b === null || b === undefined)) {
    try {
      const v = measureRailVoltage(a);
      return { ok: true, v };
    } catch (e) {
      console.warn("runtime voltage measure failed, fallback to engine:", e);
    }
  }

  try {
    return await safeDispatch({
      version: API_VERSION,
      kind: "tool",
      tool_action: {
        MultimeterMeasure: {
          mode: normalizedMode,
          a,
          b,
        },
      },
    });
  } catch (e) {
    console.error("multimeter tool_action failed:", e);
    return null;
  }
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
export async function measureTarget(target, mode = "voltage", options = {}) {
  const req = {
    version: API_VERSION,
    kind: "measure",
    payload: {
      mode,
      target,
    },
  };

  try {
    const data = await safeDispatch(req);
    return data.measurement;
  } catch (e) {
    // Optional fallback to legacy tool labels while engine is being upgraded
    if (options.fallbackToolLabel) {
      console.warn("measureTarget failed, falling back to legacy:", e.message);
      return measureTool(options.fallbackToolLabel);
    }
    console.error("measurement (target) failed:", e);
    return null;
  }
}

/**
 * Convenience: measure rail by id.
 * Example: measureRail("VBAT") will try structured target first,
 * and can fallback to legacy "vbat" if you pass fallback mapping.
 */
export async function measureRail(railId, mode = "voltage", options = {}) {
  if (String(mode).toLowerCase() === "voltage" && typeof railId === "string") {
    const mm = await multimeterMeasure({ mode: "voltage", a: railId, b: null });
    if (mm && Number.isFinite(mm.v)) return mm.v;
  }

  const fallbackToolLabel =
    options.fallbackToolLabel ??
    (typeof railId === "string" ? railId.toLowerCase() : undefined);

  return measureTarget(
    { type: "rail", id: railId },
    mode,
    { ...options, fallbackToolLabel }
  );
}

/**
 * Convenience: measure component/point by id.
 */
export async function measureComponent(componentId, mode = "voltage", options = {}) {
  return measureTarget({ type: "component", id: componentId }, mode, options);
}

export async function applyPsuConfig({ voltage, currentLimit, enabled }) {
  try {
    const data = await safeDispatch({
      version: API_VERSION,
      kind: "tool",
      tool: "psu",
      params: {
        voltage,
        current_limit: currentLimit,
        enabled,
      },
    });
    return true;
  } catch (e) {
    console.error("psu config failed:", e);
    return false;
  }
}

export async function setPsuTargetRail(rail) {
  try {
    await safeDispatch({
      version: API_VERSION,
      kind: "tool",
      tool_action: {
        SetPSUTargetRail: { rail: rail ?? "" },
      },
    });
    return true;
  } catch (e) {
    console.error("psu target rail failed:", e);
    return false;
  }
}

export async function readPsu() {
  try {
    return await safeDispatch({
      version: API_VERSION,
      kind: "tool",
      tool_action: {
        ReadPSU: {},
      },
    });
  } catch (e) {
    console.error("read PSU failed:", e);
    return null;
  }
}

export async function applyTopologyGraph(topology) {
  if (!topology || typeof topology !== "object") {
    return false;
  }
  if (!loadTopologyGraphSupported) {
    return false;
  }

  try {
    await safeDispatch({
      version: API_VERSION,
      kind: "tool",
      tool_action: {
        LoadTopologyGraph: { topology: topology || {} },
      },
    });
    return true;
  } catch (e) {
    const msg = String(e?.message || "");
    if (msg.includes("unknown variant `LoadTopologyGraph`")) {
      loadTopologyGraphSupported = false;
      if (!warnedLoadTopologyGraphUnsupported) {
        warnedLoadTopologyGraphUnsupported = true;
        console.warn("LoadTopologyGraph is not supported by the current engine build; skipping topology sync.");
      }
      return false;
    }
    console.error("apply topology graph failed:", e);
    return false;
  }
}

export { ApiError };

// Optional convenience (legacy)
export const measureVbat = () => measureTool("vbat");
export const measureVcore = () => measureTool("vcore");
export const measureVio = () => measureTool("vio");
export const measureSocTemp = () => measureTool("soc temp");
export const measureBoardTemp = () => measureTool("board temp");
