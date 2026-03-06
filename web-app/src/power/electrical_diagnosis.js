import { getRailRuntime, measureRailResistance, measureRailVoltage } from "./runtime.js";

const state = {
  boardId: null,
  railsById: {},
  topology: null,
  thermal: null,
  graph: null,
  componentsById: {},
  faults: [],
  lastSelection: null,
  lastMeasurement: null,
};

const COMPONENT_DEFAULTS = {
  resistor: { ohm: 1000, continuityBehavior: "resistive" },
  capacitor: { ohm: 200000, continuityBehavior: "open", nominalVoltage: 1.8 },
  diode: { diodeDrop: 0.58, polarity: "anode_to_cathode", continuityBehavior: "one_way" },
  fuse: { ohm: 0.2, continuityBehavior: "closed" },
  coil: { ohm: 0.6, continuityBehavior: "closed" },
  mosfet: { ohm: 40000, continuityBehavior: "gate_controlled" },
  ic: { ohm: 1200, continuityBehavior: "mixed" },
  testpoint: { ohm: 0.1, continuityBehavior: "closed" },
  unknown: { ohm: 5000, continuityBehavior: "mixed" },
};

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function classifyComponentType(component) {
  const hintType = String(component?.type || component?.kind || "").toLowerCase();
  const id = String(component?.id || "").toLowerCase();
  if (hintType.includes("res") || id.startsWith("r")) return "resistor";
  if (hintType.includes("cap") || id.startsWith("c")) return "capacitor";
  if (hintType.includes("dio") || id.startsWith("d")) return "diode";
  if (hintType.includes("fuse") || id.startsWith("f")) return "fuse";
  if (hintType.includes("coil") || id.startsWith("l")) return "coil";
  if (hintType.includes("mos") || id.startsWith("q")) return "mosfet";
  if (hintType.includes("ic") || id.startsWith("u")) return "ic";
  if (hintType.includes("tp") || id.startsWith("tp")) return "testpoint";
  return "unknown";
}

function normalizeComponentRuntime(component, railsById) {
  const railsFromHints = asArray(component?.hints?.rails).filter((r) => typeof r === "string");
  const pins = asArray(component?.pins);
  const pads = asArray(component?.pads);
  const nodes = new Set();
  const rails = new Set(railsFromHints);

  for (const pin of pins) {
    if (typeof pin?.node === "string") nodes.add(pin.node);
    if (typeof pin?.rail === "string") rails.add(pin.rail);
  }
  for (const pad of pads) {
    if (typeof pad?.node === "string") nodes.add(pad.node);
    if (typeof pad?.rail === "string") rails.add(pad.rail);
  }
  for (const railId of railsFromHints) {
    if (railsById[railId]) nodes.add(railId);
  }

  const type = classifyComponentType(component);
  const defaults = COMPONENT_DEFAULTS[type] || COMPONENT_DEFAULTS.unknown;

  return {
    id: component?.id || "",
    refdes: component?.refdes || component?.id || "",
    type,
    pins,
    pads,
    rails: [...rails],
    nodes: [...nodes],
    electricalProperties: {
      ohm: Number(component?.electrical?.ohm ?? defaults.ohm),
      diodeDrop: Number(component?.electrical?.diodeDrop ?? defaults.diodeDrop),
      continuityBehavior: component?.electrical?.continuityBehavior || defaults.continuityBehavior,
      polarity: component?.electrical?.polarity || defaults.polarity,
      nominalVoltage: Number(component?.electrical?.nominalVoltage ?? defaults.nominalVoltage),
    },
    geometry: component?.bbox || component?.shape || null,
    incomplete:
      !pins.length && !pads.length && railsFromHints.length === 0 && asArray(component?.nodes).length === 0,
  };
}

function buildGraph({ rails = [], topology = null, components = [] }) {
  const railsById = Object.fromEntries(rails.map((r) => [r.id, r]));
  const edges = [];
  const upstream = {};
  const downstream = {};

  for (const rail of rails) {
    upstream[rail.id] = [];
    downstream[rail.id] = [];
    for (const dep of asArray(rail?.depends_on)) {
      if (!railsById[dep]) continue;
      edges.push({ from: dep, to: rail.id, kind: "depends_on" });
      upstream[rail.id].push(dep);
      downstream[dep].push(rail.id);
    }
  }

  for (const edge of asArray(topology?.edges)) {
    if (!railsById[edge?.from] || !railsById[edge?.to]) continue;
    edges.push({ from: edge.from, to: edge.to, kind: edge.kind || "topology" });
    upstream[edge.to].push(edge.from);
    downstream[edge.from].push(edge.to);
  }

  const componentsById = {};
  for (const comp of components) {
    const runtime = normalizeComponentRuntime(comp, railsById);
    componentsById[runtime.id] = runtime;
  }

  return {
    rails: rails.map((r) => r.id),
    nodes: asArray(topology?.nodes),
    components: componentsById,
    connections: edges,
    upstream,
    downstream,
  };
}

export function initElectricalDiagnosis({ boardId, rails = [], topology = null, components = [], thermal = null }) {
  state.boardId = boardId || null;
  state.railsById = Object.fromEntries((rails || []).map((r) => [r.id, r]));
  state.topology = topology;
  state.thermal = thermal;
  state.graph = buildGraph({ rails, topology, components });
  state.componentsById = state.graph.components;
  state.faults = [];
  state.lastSelection = null;
  state.lastMeasurement = null;
  return state.graph;
}

export function getElectricalGraph() {
  return state.graph;
}

function normalizeFault(fault) {
  if (!fault || typeof fault !== "object") return null;
  const targetType = String(fault.targetType || "rail");
  const targetId = String(fault.targetId || "");
  const type = String(fault.type || "").toLowerCase();
  if (!targetId) return null;
  const allowed = new Set(["short_gnd", "open_line", "leaky_path", "diode_failure", "fuse_blown", "rail_collapse", "intermittent"]);
  if (!allowed.has(type)) return null;
  return {
    id: fault.id || `${targetType}:${targetId}:${type}`,
    type,
    targetType,
    targetId,
    severity: Number.isFinite(fault.severity) ? fault.severity : 1,
    params: fault.params || {},
  };
}

export function setFault(fault) {
  const normalized = normalizeFault(fault);
  if (!normalized) return false;
  state.faults = state.faults.filter((f) => f.id !== normalized.id);
  state.faults.push(normalized);
  return true;
}

export function clearFaultsForTarget(targetType, targetId) {
  state.faults = state.faults.filter((f) => !(f.targetType === targetType && f.targetId === targetId));
}

export function getActiveFaults(targetType = null, targetId = null) {
  if (!targetType || !targetId) return [...state.faults];
  return state.faults.filter((f) => f.targetType === targetType && f.targetId === targetId);
}

function pickComponentRail(componentRuntime) {
  return componentRuntime?.rails?.find((railId) => state.railsById[railId]) || null;
}

function getThermalStressForRail(railId) {
  if (!state.thermal || !railId) return 0;
  const rail = state.railsById[railId];
  const zoneId = rail?.thermal_zone;
  if (!zoneId) return 0;
  const zone = asArray(state.thermal?.zones).find((z) => z.id === zoneId);
  if (!zone) return 0;
  const mass = Number(zone.thermal_mass || 1);
  return 1 / Math.max(0.2, mass);
}

function applyFaultModifiers(base, mode, faults, context = {}) {
  let value = base;
  const explanations = [];
  for (const fault of faults) {
    const sev = Math.max(0.1, Number(fault.severity || 1));
    if (mode === "voltage") {
      if (fault.type === "short_gnd") {
        value = Math.min(value, 0.05 * sev);
        explanations.push("Short-to-ground collapses measured voltage.");
      } else if (fault.type === "rail_collapse") {
        value = Math.max(0, value * 0.35 / sev);
        explanations.push("Rail collapse reduces output significantly.");
      } else if (fault.type === "open_line") {
        value = Math.min(value, 0.12);
        explanations.push("Open line causes floating/near-zero voltage.");
      } else if (fault.type === "intermittent") {
        value = Math.random() < 0.45 ? value : value * 0.15;
        explanations.push("Intermittent fault causes unstable reading.");
      }
    }

    if (mode === "resistance" || mode === "continuity") {
      if (fault.type === "short_gnd") {
        value = Math.min(value, 0.5 + Math.random());
        explanations.push("Short fault pulls resistance toward near-short.");
      } else if (fault.type === "open_line" || fault.type === "fuse_blown") {
        value = 1.0e8;
        explanations.push("Open path produces OL/high resistance.");
      } else if (fault.type === "leaky_path") {
        value = Math.min(value, 200 + 300 * sev);
        explanations.push("Leaky path lowers resistance unexpectedly.");
      }
    }

    if (mode === "diode") {
      if (fault.type === "diode_failure") {
        value = Math.random() < 0.5 ? 0.02 : 1.2;
        explanations.push("Diode failure shows short/open diode drop.");
      } else if (fault.type === "open_line") {
        value = 1.0e8;
        explanations.push("Open line makes diode test OL.");
      }
    }
  }

  const thermalStress = getThermalStressForRail(context.railId);
  if (thermalStress > 0 && Number.isFinite(value) && mode === "voltage") {
    value = Math.max(0, value * (1 - Math.min(0.15, thermalStress * 0.05)));
    explanations.push("Thermal stress slightly droops rail voltage.");
  }

  return { value, explanations };
}

function defaultDiodeDropForRail(rail) {
  const min = Number(rail?.expected?.diode_drop_v?.min);
  const max = Number(rail?.expected?.diode_drop_v?.max);
  if (Number.isFinite(min) && Number.isFinite(max)) return (min + max) / 2;
  return 0.58;
}

export function resolveSelection(targetType, targetId) {
  if (targetType === "component") {
    const component = state.componentsById[targetId] || null;
    const railId = pickComponentRail(component);
    const rail = railId ? state.railsById[railId] : null;
    const upstream = railId ? (state.graph?.upstream?.[railId] || []) : [];
    const downstream = railId ? (state.graph?.downstream?.[railId] || []) : [];
    const faults = getActiveFaults("component", targetId);
    const warnings = [];
    if (!component) warnings.push("Component not found in runtime map.");
    if (component?.incomplete) warnings.push("Component electrical structure is incomplete.");
    if (!railId) warnings.push("No connected rail detected for this component.");

    const selection = {
      targetType,
      targetId,
      component,
      rail,
      railId,
      nodeIds: component?.nodes || [],
      upstream,
      downstream,
      faults,
      warnings,
    };
    state.lastSelection = selection;
    return selection;
  }

  const rail = state.railsById[targetId] || null;
  const warnings = [];
  if (!rail) warnings.push("Rail not found in board data.");
  const selection = {
    targetType: "rail",
    targetId,
    rail,
    railId: rail?.id || targetId,
    nodeIds: [rail?.id || targetId],
    upstream: state.graph?.upstream?.[targetId] || [],
    downstream: state.graph?.downstream?.[targetId] || [],
    faults: getActiveFaults("rail", targetId),
    warnings,
  };
  state.lastSelection = selection;
  return selection;
}

export function measureSelection({ mode, targetType, targetId, railB = null }) {
  const m = String(mode || "voltage").toLowerCase();
  const selection = resolveSelection(targetType, targetId);
  const railId = selection.railId;
  const railFaults = getActiveFaults("rail", railId);
  const mergedFaults = [...railFaults, ...(selection.faults || [])];

  let baseValue = Number.NaN;
  if (m === "voltage") {
    baseValue = measureRailVoltage(railId);
  } else if (m === "resistance" || m === "ohm" || m === "continuity") {
    baseValue = measureRailResistance(railId, railB || null);
  } else if (m === "diode") {
    if (targetType === "component" && selection.component?.type === "diode") {
      baseValue = selection.component.electricalProperties.diodeDrop || 0.58;
    } else {
      baseValue = defaultDiodeDropForRail(selection.rail);
    }
  }

  const { value, explanations } = applyFaultModifiers(baseValue, m === "ohm" ? "resistance" : m, mergedFaults, { railId });

  let finalValue = value;
  if (m === "continuity") {
    const threshold = Number(selection.rail?.expected?.continuity?.beep_below_ohms ?? 10);
    finalValue = Number.isFinite(value) && value <= threshold ? 1 : 0;
  }

  if (targetType === "component" && selection.component) {
    if ((m === "resistance" || m === "ohm") && Number.isFinite(selection.component.electricalProperties.ohm)) {
      finalValue = Math.min(Number(finalValue), selection.component.electricalProperties.ohm);
    }
    if (m === "diode" && selection.component.type !== "diode") {
      explanations.push("Selected component is not diode-like; diode value is inferred.");
    }
  }

  if (selection.upstream.length) {
    const blocked = selection.upstream.find((up) => {
      const rt = getRailRuntime(up);
      return rt && rt.status !== "ON";
    });
    if (blocked && m === "voltage") {
      finalValue = Math.min(finalValue, 0.04);
      explanations.push(`Upstream rail ${blocked} is not ON, downstream collapses.`);
    }
  }

  const result = {
    mode: m,
    value: finalValue,
    selection,
    faults: mergedFaults,
    explanation: explanations,
  };
  state.lastMeasurement = result;
  return result;
}

export function getDiagnosisState() {
  return {
    boardId: state.boardId,
    graph: state.graph,
    faults: [...state.faults],
    lastSelection: state.lastSelection,
    lastMeasurement: state.lastMeasurement,
  };
}

export function debugRail(railId) {
  return {
    rail: state.railsById[railId] || null,
    runtime: getRailRuntime(railId),
    upstream: state.graph?.upstream?.[railId] || [],
    downstream: state.graph?.downstream?.[railId] || [],
    faults: getActiveFaults("rail", railId),
  };
}

export function debugComponent(componentId) {
  const component = state.componentsById[componentId] || null;
  return {
    component,
    connectedRail: pickComponentRail(component),
    faults: getActiveFaults("component", componentId),
  };
}
