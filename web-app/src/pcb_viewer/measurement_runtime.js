import { measureRailVoltage, measureRailResistance, measureContinuity } from "../power/runtime.js";

const DEFAULT_CONTINUITY = {
  beep_below_ohms: 50,
  open_above_ohms: 200,
};

function logDiagnostic(level, message, details = null) {
  const prefix = `[multimeter:${level}] ${message}`;
  if (level === "error") console.error(prefix, details || "");
  else if (level === "warn") console.warn(prefix, details || "");
  else console.log(prefix, details || "");
}

export function normalizeMode(mode) {
  const value = String(mode || "").trim().toLowerCase();
  if (value === "resistance") return "ohm";
  if (value === "voltage" || value === "ohm" || value === "diode" || value === "continuity") return value;
  return "voltage";
}

function formatVoltage(value) {
  return `${Number(value).toFixed(Math.abs(value) >= 10 ? 2 : 3)} V`;
}

function formatOhms(value) {
  if (!Number.isFinite(value)) return "OL";
  if (value >= 1.0e8) return "OL";
  if (value >= 1.0e6) return `${(value / 1.0e6).toFixed(2)} MOhm`;
  if (value >= 1.0e3) return `${(value / 1.0e3).toFixed(2)} kOhm`;
  return `${value.toFixed(value >= 100 ? 1 : 2)} Ohm`;
}

function midpoint(range) {
  if (!range || typeof range !== "object") return null;
  const min = Number(range.min);
  const max = Number(range.max);
  if (Number.isFinite(min) && Number.isFinite(max)) return (min + max) / 2;
  return null;
}

function resolveRuntimeRailId(boardRuntime, railId) {
  const raw = String(railId || "").trim();
  if (!raw) return null;
  if (boardRuntime?.railsById?.[raw]) return raw;
  const wanted = raw.toLowerCase();
  return Object.keys(boardRuntime?.railsById || {}).find((candidate) => candidate.toLowerCase() === wanted) || null;
}

function firstRailId(target, boardRuntime) {
  if (!target) return null;
  if (target.railId) return resolveRuntimeRailId(boardRuntime, target.railId);
  if (target.type === "component") {
    const component = boardRuntime?.componentsById?.[target.componentId];
    const refs = component?.rails || target.rails || [];
    return refs.map((railId) => resolveRuntimeRailId(boardRuntime, railId)).find(Boolean) || null;
  }
  if (target.type === "node" && target.railId) {
    return resolveRuntimeRailId(boardRuntime, target.railId);
  }
  return null;
}

function secondRailId(target, boardRuntime, reference = null) {
  if (reference?.railId) return resolveRuntimeRailId(boardRuntime, reference.railId);
  if (target?.type === "component") {
    const component = boardRuntime?.componentsById?.[target.componentId];
    const rails = component?.rails || target.rails || [];
    const primary = firstRailId(target, boardRuntime);
    return rails
      .map((railId) => resolveRuntimeRailId(boardRuntime, railId))
      .find((railId) => railId && railId !== primary) || null;
  }
  return null;
}

function continuityConfig(target, boardRuntime) {
  const railId = firstRailId(target, boardRuntime);
  const rail = railId ? boardRuntime?.railsById?.[railId] : null;
  return rail?.continuity || boardRuntime?.defaults?.continuity || DEFAULT_CONTINUITY;
}

function resolveComponent(boardRuntime, target) {
  if (target?.type !== "component") return null;
  return boardRuntime?.componentsById?.[target.componentId] || null;
}

function targetLabel(target, boardRuntime) {
  if (!target) return "None";
  if (target.type === "component") {
    const component = resolveComponent(boardRuntime, target);
    return component?.refdes || component?.label || target.componentId;
  }
  if (target.type === "probe") {
    return target.probeId || target.label || target.id;
  }
  if (target.type === "rail") {
    const rail = boardRuntime?.railsById?.[target.railId];
    return rail?.label || target.railId;
  }
  if (target.type === "node") {
    return target.nodeId || target.label || target.id;
  }
  return target.label || target.id || "Unknown";
}

function makeResult({ ok, mode, target, boardRuntime, value = null, units = "", displayValue = "--", status = "ok", helpText = "", diagnostic = "", beep = false }) {
  const label = targetLabel(target, boardRuntime);
  const result = {
    ok,
    mode,
    target,
    targetLabel: label,
    targetType: target?.type || "unknown",
    value,
    units,
    displayValue,
    status,
    helpText,
    diagnostic,
    beep,
    summary: `Mode: ${mode} | Target: ${label} | Result: ${displayValue}`,
    historyTarget: `${mode.toUpperCase()} ${label}`,
    historyValue: Number.isFinite(value) ? value : null,
  };

  if (!ok) {
    logDiagnostic(status === "error" ? "error" : "warn", diagnostic || helpText || "Measurement failed", { mode, target });
  }
  return result;
}

function resolveDiodeValue(target, boardRuntime) {
  const railId = firstRailId(target, boardRuntime);
  const rail = railId ? boardRuntime?.railsById?.[railId] : null;
  const component = resolveComponent(boardRuntime, target);

  const explicitDrop = Number(component?.electricalProperties?.diodeDrop ?? component?.electricalProperties?.forward_voltage);
  if (Number.isFinite(explicitDrop)) return explicitDrop;

  const expected = midpoint(rail?.expected?.diode_drop_v);
  if (Number.isFinite(expected)) return expected;

  const kind = String(component?.kind || "").toLowerCase();
  const tags = (component?.tags || []).map((tag) => String(tag).toLowerCase());
  const semiconductor = kind.includes("ic") || kind.includes("diode") || kind.includes("mos") || tags.includes("pmic") || tags.includes("power");
  if (semiconductor && railId) {
    const railVoltage = measureRailVoltage(railId);
    if (railVoltage <= 0.05) return 0.08;
    return Math.min(0.85, Math.max(0.18, railVoltage * 0.08));
  }

  return null;
}

function resolveComponentResistance(target, boardRuntime, reference = null) {
  const component = resolveComponent(boardRuntime, target);
  const explicit = Number(component?.electricalProperties?.ohm ?? component?.electricalProperties?.resistance_ohm);
  if (Number.isFinite(explicit)) return explicit;

  const railA = firstRailId(target, boardRuntime);
  const railB = secondRailId(target, boardRuntime, reference);
  if (railA) return measureRailResistance(railA, railB);
  return Number.NaN;
}

function componentSupportsDiode(component) {
  const kind = String(component?.kind || "").toLowerCase();
  const ref = String(component?.refdes || component?.id || "").toLowerCase();
  const tags = (component?.tags || []).map((tag) => String(tag).toLowerCase());
  if (kind.includes("diode") || ref.startsWith("d")) return true;
  if (kind.includes("ic") || kind.includes("mos") || kind.includes("transistor")) return true;
  if (tags.includes("pmic") || tags.includes("power")) return true;
  return false;
}

function measureVoltage(target, boardRuntime) {
  const railId = firstRailId(target, boardRuntime);
  if (!railId) {
    return makeResult({
      ok: false,
      mode: "voltage",
      target,
      boardRuntime,
      status: "warning",
      helpText: "Selected target has no rail mapping for voltage measurement.",
      diagnostic: "missing rail mapping for voltage",
    });
  }

  const value = measureRailVoltage(railId);
  return makeResult({
    ok: true,
    mode: "voltage",
    target,
    boardRuntime,
    value,
    units: "V",
    displayValue: formatVoltage(value),
    helpText: `Resolved through rail ${railId}.`,
    diagnostic: `voltage measured on ${railId}`,
  });
}

function measureOhm(target, boardRuntime, reference = null) {
  let value = Number.NaN;
  if (target?.type === "component") {
    value = resolveComponentResistance(target, boardRuntime, reference);
  } else {
    const railA = firstRailId(target, boardRuntime);
    const railB = secondRailId(target, boardRuntime, reference) || reference?.railId || null;
    if (railA) value = measureRailResistance(railA, railB);
  }

  if (!Number.isFinite(value)) {
    return makeResult({
      ok: false,
      mode: "ohm",
      target,
      boardRuntime,
      status: "warning",
      helpText: "Selected target is not measurable in ohm mode with current board data.",
      diagnostic: "missing resistance mapping",
    });
  }

  return makeResult({
    ok: true,
    mode: "ohm",
    target,
    boardRuntime,
    value,
    units: "Ohm",
    displayValue: formatOhms(value),
    helpText: reference?.railId ? `Measured between ${targetLabel(target, boardRuntime)} and ${reference.railId}.` : "Measured against ground/reference path.",
    diagnostic: "resistance measurement resolved",
  });
}

function measureDiode(target, boardRuntime) {
  const component = resolveComponent(boardRuntime, target);
  if (component && !componentSupportsDiode(component)) {
    return makeResult({
      ok: false,
      mode: "diode",
      target,
      boardRuntime,
      status: "warning",
      helpText: `${component.refdes || component.id} is not a suitable diode-mode target yet.`,
      diagnostic: "component not suitable for diode mode",
    });
  }

  const value = resolveDiodeValue(target, boardRuntime);
  if (!Number.isFinite(value)) {
    return makeResult({
      ok: false,
      mode: "diode",
      target,
      boardRuntime,
      status: "warning",
      helpText: "No diode path could be derived from the selected target.",
      diagnostic: "missing diode mapping",
    });
  }

  return makeResult({
    ok: true,
    mode: "diode",
    target,
    boardRuntime,
    value,
    units: "V",
    displayValue: `${value.toFixed(2)} V`,
    helpText: "Forward drop estimated from board rail/component metadata.",
    diagnostic: "diode measurement resolved",
  });
}

function measureContinuityMode(target, boardRuntime, reference = null) {
  const ohmResult = measureOhm(target, boardRuntime, reference);
  if (!ohmResult.ok || !Number.isFinite(ohmResult.value)) {
    return makeResult({
      ok: false,
      mode: "continuity",
      target,
      boardRuntime,
      status: "warning",
      helpText: ohmResult.helpText || "Continuity could not be resolved.",
      diagnostic: ohmResult.diagnostic || "continuity missing resistance mapping",
    });
  }

  const cfg = continuityConfig(target, boardRuntime);
  const threshold = Number(cfg?.beep_below_ohms);
  const beep = Number.isFinite(threshold) ? ohmResult.value <= threshold : measureContinuity(firstRailId(target, boardRuntime), reference?.railId || null) === 1;
  const displayValue = beep ? `Continuity: YES (${formatOhms(ohmResult.value)})` : `Continuity: NO (${formatOhms(ohmResult.value)})`;

  return makeResult({
    ok: true,
    mode: "continuity",
    target,
    boardRuntime,
    value: ohmResult.value,
    units: "Ohm",
    displayValue,
    helpText: beep ? "Path is below continuity threshold." : "Path is above continuity threshold.",
    diagnostic: "continuity measurement resolved",
    beep,
  });
}

export async function measureTarget({ mode, target, reference = null, boardRuntime }) {
  const normalizedMode = normalizeMode(mode);
  if (!boardRuntime) {
    return makeResult({
      ok: false,
      mode: normalizedMode,
      target,
      boardRuntime,
      status: "error",
      helpText: "Board runtime is not ready yet.",
      diagnostic: "board runtime missing",
    });
  }

  if (!target || typeof target !== "object") {
    return makeResult({
      ok: false,
      mode: normalizedMode,
      target,
      boardRuntime,
      status: "error",
      helpText: "No measurement target selected.",
      diagnostic: "measurement target missing",
    });
  }

  try {
    if (normalizedMode === "voltage") return measureVoltage(target, boardRuntime);
    if (normalizedMode === "ohm") return measureOhm(target, boardRuntime, reference);
    if (normalizedMode === "diode") return measureDiode(target, boardRuntime);
    if (normalizedMode === "continuity") return measureContinuityMode(target, boardRuntime, reference);

    return makeResult({
      ok: false,
      mode: normalizedMode,
      target,
      boardRuntime,
      status: "warning",
      helpText: `Mode ${normalizedMode} is not supported by the motherboard multimeter runtime.`,
      diagnostic: "unsupported mode",
    });
  } catch (error) {
    return makeResult({
      ok: false,
      mode: normalizedMode,
      target,
      boardRuntime,
      status: "error",
      helpText: error?.message || "Unexpected multimeter failure.",
      diagnostic: "measurement runtime exception",
    });
  }
}
