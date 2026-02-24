import init, * as engine from "./wasm/engine.js";

const API_VERSION = 1;
const DEFAULT_TIMEOUT = 5000;

let initialized = false;

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
  return measureTarget({ type: "rail", id: railId }, mode, options);
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

export { ApiError };

// Optional convenience (legacy)
export const measureVbat = () => measureTool("vbat");
export const measureVcore = () => measureTool("vcore");
export const measureVio = () => measureTool("vio");
export const measureSocTemp = () => measureTool("soc temp");
export const measureBoardTemp = () => measureTool("board temp");
