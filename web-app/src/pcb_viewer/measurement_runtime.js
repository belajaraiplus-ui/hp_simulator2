import { measureRailVoltage, measureRailResistance, measureContinuity } from "../power/runtime.js";

const DEFAULT_CONTINUITY = {
  beep_below_ohms: 50,
};

function normalizeRail(boardRuntime, railId) {
  const raw = String(railId || "").trim();
  if (!raw) return null;
  if (boardRuntime?.railsById?.[raw]) return raw;
  const wanted = raw.toLowerCase();
  return Object.keys(boardRuntime?.railsById || {}).find((candidate) => candidate.toLowerCase() === wanted) || null;
}

function normalizeMode(mode) {
  const value = String(mode || "").trim().toLowerCase();
  if (value === "resistance") return "ohm";
  if (["voltage", "ohm", "diode", "continuity"].includes(value)) return value;
  return "voltage";
}

function componentByTarget(boardRuntime, target) {
  if (!target) return null;
  if (target.type !== "component" && target.type !== "component-pin") return null;
  return boardRuntime?.componentsById?.[target.componentId] || null;
}

function collectComponentContacts(component) {
  const pins = Array.isArray(component?.pins) ? component.pins : [];
  const pads = Array.isArray(component?.pads) ? component.pads : [];
  return [...pins, ...pads].map((entry, idx) => ({
    id: String(entry?.id || `PIN_${idx + 1}`),
    node: entry?.node || null,
    railId: entry?.railId || entry?.rail || null,
    raw: entry,
  }));
}

function firstUsableContact(component, boardRuntime) {
  return collectComponentContacts(component).find((entry) => normalizeRail(boardRuntime, entry.railId) || entry.node) || null;
}

function firstRailId(target, boardRuntime) {
  if (!target) return null;
  if (target.type === "probe" || target.type === "rail") return normalizeRail(boardRuntime, target.railId);
  if (target.type === "node") return normalizeRail(boardRuntime, target.railId);

  const component = componentByTarget(boardRuntime, target);
  if (!component) return null;

  if (target.type === "component-pin") {
    const railFromPin = normalizeRail(boardRuntime, target.railId);
    if (railFromPin) return railFromPin;
    const found = collectComponentContacts(component).find((pin) => pin.id === target.pinId);
    const pinRail = normalizeRail(boardRuntime, found?.railId);
    if (pinRail) return pinRail;
  }

  const declared = [
    target.railId,
    ...(Array.isArray(component?.rails) ? component.rails : []),
    ...(Array.isArray(component?.hints?.rails) ? component.hints.rails : []),
  ];
  for (const candidate of declared) {
    const railId = normalizeRail(boardRuntime, candidate);
    if (railId) return railId;
  }

  const contact = firstUsableContact(component, boardRuntime);
  return normalizeRail(boardRuntime, contact?.railId);
}

function secondRailId(target, boardRuntime, reference = null) {
  const refRail = normalizeRail(boardRuntime, reference?.railId);
  if (refRail) return refRail;

  const component = componentByTarget(boardRuntime, target);
  if (!component) return null;
  const primary = firstRailId(target, boardRuntime);

  const candidates = [
    ...(Array.isArray(component?.rails) ? component.rails : []),
    ...(Array.isArray(component?.hints?.rails) ? component.hints.rails : []),
    ...collectComponentContacts(component).map((pin) => pin.railId),
  ];

  for (const candidate of candidates) {
    const railId = normalizeRail(boardRuntime, candidate);
    if (railId && railId !== primary) return railId;
  }

  return null;
}

function targetLabel(target, boardRuntime) {
  if (!target) return "None";
  if (target.type === "component-pin") {
    const component = componentByTarget(boardRuntime, target);
    const base = component?.refdes || component?.id || target.componentId;
    return `${base} (pin ${target.pinId})`;
  }
  if (target.type === "component") {
    const component = componentByTarget(boardRuntime, target);
    return component?.refdes || component?.id || target.componentId;
  }
  if (target.type === "rail") return target.railId || target.id;
  if (target.type === "probe") return target.label || target.probeId || target.id;
  if (target.type === "node") return target.node || target.id;
  return target.label || target.id || "Unknown";
}

function formatOhms(value) {
  if (!Number.isFinite(value)) return "OL";
  if (value >= 1.0e8) return "OL";
  if (value >= 1.0e6) return `${(value / 1.0e6).toFixed(2)} MΩ`;
  if (value >= 1.0e3) return `${(value / 1.0e3).toFixed(1)} kΩ`;
  return `${value.toFixed(value >= 100 ? 1 : 2)} Ω`;
}

function createResult({ ok, mode, target, boardRuntime, value = null, unit = "", display = "--", message = "", code = "", beep = false }) {
  const label = targetLabel(target, boardRuntime);
  return {
    ok,
    mode,
    code: ok ? undefined : code || "MEASUREMENT_FAILED",
    message: ok ? undefined : message,
    target,
    targetLabel: label,
    value,
    unit,
    display,
    displayValue: display,
    status: ok ? "ok" : "warning",
    helpText: message || (ok ? "Measurement complete." : "Measurement failed."),
    summary: `Mode: ${mode} | Target: ${label} | Result: ${display}`,
    historyTarget: `${mode.toUpperCase()} ${label}`,
    historyValue: Number.isFinite(value) ? value : null,
    beep,
  };
}

function componentNotMeasurable(mode, target, boardRuntime, reason) {
  return createResult({
    ok: false,
    mode,
    target,
    boardRuntime,
    code: "COMPONENT_NOT_MEASURABLE",
    message: reason,
    display: reason,
  });
}

function measureVoltage(target, boardRuntime) {
  const railId = firstRailId(target, boardRuntime);
  if (!railId) {
    return componentNotMeasurable(
      "voltage",
      target,
      boardRuntime,
      "Selected component is visible but does not yet have pins/pads/electrical mapping for voltage mode."
    );
  }

  const value = measureRailVoltage(railId);
  return createResult({
    ok: true,
    mode: "voltage",
    target,
    boardRuntime,
    value,
    unit: "V",
    display: `${Number(value).toFixed(Math.abs(value) >= 10 ? 2 : 3)} V`,
  });
}

function measureOhm(target, boardRuntime, reference) {
  const component = componentByTarget(boardRuntime, target);
  let value = Number.NaN;

  if (component) {
    const explicit = Number(component?.electricalProperties?.ohm ?? component?.electricalProperties?.resistance_ohm);
    if (Number.isFinite(explicit)) value = explicit;
    else {
      const railA = firstRailId(target, boardRuntime);
      const railB = secondRailId(target, boardRuntime, reference);
      if (railA && railB) value = measureRailResistance(railA, railB);
    }
  } else {
    const railA = firstRailId(target, boardRuntime);
    const railB = secondRailId(target, boardRuntime, reference);
    if (railA) value = measureRailResistance(railA, railB);
  }

  if (!Number.isFinite(value)) {
    return componentNotMeasurable(
      "ohm",
      target,
      boardRuntime,
      "Selected component has no pins, pads, node mapping, or electrical properties for ohm mode."
    );
  }

  return createResult({ ok: true, mode: "ohm", target, boardRuntime, value, unit: "ohm", display: formatOhms(value) });
}

function measureDiode(target, boardRuntime) {
  const component = componentByTarget(boardRuntime, target);
  const diode = Number(component?.electricalProperties?.diodeDrop ?? component?.electricalProperties?.forward_voltage);

  if (!Number.isFinite(diode)) {
    return componentNotMeasurable(
      "diode",
      target,
      boardRuntime,
      "Selected component is visible but does not yet have pins/pads/electrical mapping for diode mode."
    );
  }

  return createResult({ ok: true, mode: "diode", target, boardRuntime, value: diode, unit: "V", display: `${diode.toFixed(2)} V` });
}

function measureContinuityMode(target, boardRuntime, reference) {
  const component = componentByTarget(boardRuntime, target);
  const explicit = component?.electricalProperties?.continuity;
  let yes = null;
  let ohm = Number.NaN;

  if (typeof explicit === "boolean") {
    yes = explicit;
    ohm = explicit ? 0.2 : 1.0e9;
  } else {
    const ohmResult = measureOhm(target, boardRuntime, reference);
    if (ohmResult.ok && Number.isFinite(ohmResult.value)) {
      ohm = ohmResult.value;
      const threshold = Number(boardRuntime?.defaults?.continuity?.beep_below_ohms ?? DEFAULT_CONTINUITY.beep_below_ohms);
      yes = ohm <= threshold;
    } else {
      const railA = firstRailId(target, boardRuntime);
      const railB = secondRailId(target, boardRuntime, reference);
      if (railA) {
        const c = measureContinuity(railA, railB);
        if (c === 0 || c === 1) {
          yes = c === 1;
          ohm = yes ? 0.2 : 1.0e9;
        }
      }
    }
  }

  if (yes === null) {
    return componentNotMeasurable(
      "continuity",
      target,
      boardRuntime,
      "Selected component has no continuity property and no two-point mapping for continuity mode."
    );
  }

  return createResult({
    ok: true,
    mode: "continuity",
    target,
    boardRuntime,
    value: ohm,
    unit: "ohm",
    display: `Continuity: ${yes ? "YES" : "NO"}`,
    beep: Boolean(yes),
  });
}

export async function measureTarget({ mode, target, reference = null, boardRuntime }) {
  const normalizedMode = normalizeMode(mode);
  if (!boardRuntime) {
    return createResult({
      ok: false,
      mode: normalizedMode,
      target,
      boardRuntime,
      code: "BOARD_RUNTIME_MISSING",
      message: "Board runtime is not ready yet.",
      display: "Board runtime is not ready yet.",
    });
  }
  if (!target || typeof target !== "object") {
    return createResult({
      ok: false,
      mode: normalizedMode,
      target,
      boardRuntime,
      code: "TARGET_MISSING",
      message: "No measurement target selected.",
      display: "No measurement target selected.",
    });
  }

  if (normalizedMode === "voltage") return measureVoltage(target, boardRuntime);
  if (normalizedMode === "ohm") return measureOhm(target, boardRuntime, reference);
  if (normalizedMode === "diode") return measureDiode(target, boardRuntime);
  if (normalizedMode === "continuity") return measureContinuityMode(target, boardRuntime, reference);

  return createResult({
    ok: false,
    mode: normalizedMode,
    target,
    boardRuntime,
    code: "MODE_UNSUPPORTED",
    message: `Mode ${normalizedMode} is not supported by the motherboard multimeter runtime.`,
    display: `Mode ${normalizedMode} not supported.`,
  });
}

export { normalizeMode };
