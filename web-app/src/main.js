// src/main.js
import { bootEngine, snapshot, step, applyTopologyGraph, dispatchToolAction } from "./engine/adapter.js";
import { initPcbViewerPanel, setPsuTargetRail as setPsuTargetRailOverlay } from "./pcb_viewer/panel.js";
import { MAX_POINTS, TARGET_FPS, ENGINE_BASE_INTERVAL_MS } from "./config.js";
import { clamp01, toNumber, trim, lastValue, formatNumber, debounce } from "./utils.js";
import {
  State,
  voltageHistory, voltageSmoothed,
  thermalHistory, thermalSmoothed,
  distressHistory, diagnosticHistory,
  railVisibility,
  smoothingAlpha,
  resetBoardState,
} from "./state.js";
import { computeDiagnostic } from "./analysis.js";
import {
  createOffscreenCanvas,
  resizeCanvasToDisplaySize,
  syncOffscreen,
  drawVoltageChart,
  drawThermalChart,
  drawDistressChart
} from "./ui/charts.js";
import {
  createMultimeterUiState,
  normalizeMode as normalizeMultimeterMode,
  playContinuityBeep,
  renderMultimeterPanel,
} from "./ui/multimeter.js";
import { showAIPanel } from "./ai/panel.js";
import { initScenarioSelector, setScenario, updateScenarioDisplay } from "./ui/scenario_selector.js";
import { initExportReport } from "./export/report.js";
import { getTimelineSnapshots, initTimeline, saveSnapshot } from "./ui/timeline.js";
import { applyRestoredSession, consumePendingRestore, initSaveLoad } from "./persistence/storage.js";
import { showOutcomeModal } from "./outcome/display.js";
import { showOscilloscope, toggleOscilloscope } from "./ui/oscilloscope.js";
import { createToolDispatcher } from "./tools/dispatch.js";
import { injectFault, clearFault, setSystemMode, debugDumpPower } from "./power/runtime.js";
import { setFault as setDiagnosisFault, clearFaultsForTarget, debugComponent as diagnosisDebugComponent, debugRail as diagnosisDebugRail } from "./power/electrical_diagnosis.js";
import { measureTarget as measureBoardTarget } from "./pcb_viewer/measurement_runtime.js";
import { installPcbViewerDevApi } from "./pcb_viewer/api.js";

const Tools = createToolDispatcher();

/* ==========================================================
   DOM REFERENCES
   ========================================================== */
const out = document.getElementById("output");
const stepBtn = document.getElementById("stepBtn");
const resetBtn = document.getElementById("btn-reset");
const runBtn = document.getElementById("run");
const pauseBtn = document.getElementById("pause");
const statusEl = document.getElementById("status");
const speedSelect = document.getElementById("speed");
const distressFill = document.getElementById("distressFill");

const voltageCanvas = document.getElementById("voltageCanvas");
const thermalCanvas = document.getElementById("thermalCanvas");
const distressCanvas = document.getElementById("distressCanvas");

const manualMeasureBtn = document.getElementById("manualMeasure");
const multimeterModeEl = document.getElementById("multimeterMode");
const multimeterTargetTypeEl = document.getElementById("multimeterTargetType");
const multimeterRailEl = document.getElementById("multimeterRail");
const multimeterRailBEl = document.getElementById("multimeterRailB");
const multimeterProbePositiveBtn = document.getElementById("multimeterProbePositive");
const multimeterProbeNegativeBtn = document.getElementById("multimeterProbeNegative");
const multimeterComponentEl = document.getElementById("multimeterComponent");
const multimeterResultEl = document.getElementById("multimeterResult");
const diagnosticTargetEl = document.getElementById("diagnosticTarget");
const diagnosticRailEl = document.getElementById("diagnosticRail");
const diagnosticNodesEl = document.getElementById("diagnosticNodes");
const diagnosticFaultsEl = document.getElementById("diagnosticFaults");
const diagnosticStateEl = document.getElementById("diagnosticState");
const diagnosticExplainEl = document.getElementById("diagnosticExplain");
const multimeterModeLabelEl = document.getElementById("multimeterModeLabel");
const multimeterTargetLabelEl = document.getElementById("multimeterTargetLabel");
const multimeterStatusEl = document.getElementById("multimeterStatus");
const multimeterHelpEl = document.getElementById("multimeterHelp");
const boardProfileLabelEl = document.getElementById("boardProfileLabel");

const psuEnableEl = document.getElementById("psuEnable");
const psuVoltageEl = document.getElementById("psuVoltage");
const psuCurrentLimitEl = document.getElementById("psuCurrentLimit");
const psuApplyBtn = document.getElementById("psuApply");
const psuStatusEl = document.getElementById("psuStatus");
const psuCurrentEl = document.getElementById("psuMeasuredCurrent");
const psuTargetRailEl = document.getElementById("psuTargetRail");
const psuTargetStatusEl = document.getElementById("psuTargetStatus");

const diagnosticText = document.getElementById("diagnosticText");
const diagnosticConfidence = document.getElementById("diagnosticConfidence");
const railTogglePanel = document.getElementById("railTogglePanel");

/* ==========================================================
   MEASUREMENT HISTORY
   ========================================================== */
let measurementHistoryData = [];
let currentBoardRuntime = null;
let currentMeasurementSelection = null;
let latestMultimeterUiState = createMultimeterUiState();
let activeProbePolarity = "positive";
const probeTargets = {
  positive: null,
  negative: null,
};


function renderDiagnosisInfo(diagnosis) {
  if (!diagnosis) return;
  const selection = diagnosis.selection || {};
  const faults = diagnosis.faults || [];
  const warnings = selection.warnings || [];

  if (diagnosticTargetEl) {
    diagnosticTargetEl.textContent = `${selection.targetType || "target"}: ${selection.targetId || "-"}`;
  }
  if (diagnosticRailEl) {
    diagnosticRailEl.textContent = selection.railId || selection.rail?.id || "unresolved";
  }
  if (diagnosticNodesEl) {
    const nodes = Array.isArray(selection.nodeIds) ? selection.nodeIds : [];
    diagnosticNodesEl.textContent = nodes.length ? nodes.join(", ") : "none";
  }
  if (diagnosticFaultsEl) {
    diagnosticFaultsEl.textContent = faults.length
      ? faults.map((f) => `${f.type}@${f.targetId}`).join(", ")
      : "none";
  }
  if (diagnosticStateEl) {
    const up = Array.isArray(selection.upstream) ? selection.upstream.join(", ") : "";
    const down = Array.isArray(selection.downstream) ? selection.downstream.join(", ") : "";
    diagnosticStateEl.textContent = `upstream=[${up}] downstream=[${down}]`;
  }
  if (diagnosticExplainEl) {
    const explain = Array.isArray(diagnosis.explanation) ? diagnosis.explanation : [];
    const text = [...explain, ...warnings].filter(Boolean).join(" ");
    diagnosticExplainEl.textContent = text || "Reading within nominal simulation assumptions.";
  }
}

function renderDiagnosisForTarget(target) {
  if (!target) return;

  let targetType = null;
  let targetId = null;

  if (target.type === "component" && target.componentId) {
    targetType = "component";
    targetId = target.componentId;
  } else if ((target.type === "rail" || target.type === "probe" || target.type === "node") && target.railId) {
    targetType = "rail";
    targetId = target.railId;
  } else if (target.type === "node" && target.componentId) {
    targetType = "component";
    targetId = target.componentId;
  }

  if (!targetType || !targetId) return;

  const selection = Tools.inspectTarget(targetType, targetId);
  const faults = Tools.getDiagnosisSnapshot()?.faults || selection?.faults || [];
  renderDiagnosisInfo({ selection, faults, explanation: [] });
}

function formatTime(t) {
  if (t == null) return "0.0s";
  return t.toFixed(1) + "s";
}

function formatValue(val, mode) {
  if (val == null) return "---";
  if (mode?.includes("continuity")) {
    return val > 0 ? "BEEP" : "OL";
  }
  if (mode?.includes("diode")) {
    return val > 0 ? val.toFixed(3) + "V" : "OL";
  }
  if (mode?.includes("ohm") || mode?.includes("resistance")) {
    return val > 1000000 ? "OL" : val.toFixed(1) + "Ω";
  }
  return val.toFixed(3) + "V";
}

function renderMeasurementHistory() {
  const container = document.getElementById("measurementHistory");
  if (!container) return;

  if (!measurementHistoryData || measurementHistoryData.length === 0) {
    container.innerHTML = '<div class="measEmpty">No measurements yet</div>';
    return;
  }

  const recent = measurementHistoryData.slice(-20).reverse();
  
  container.innerHTML = `
    <div class="measHeader">
      <span>Time</span>
      <span>Target</span>
      <span>Value</span>
    </div>
    ${recent.map(m => `
      <div class="measItem">
        <span class="measTime">${formatTime(m.time)}</span>
        <span class="measTarget">${m.target || "?"}</span>
        <span class="measValue">${m.display_value || formatValue(m.observed_value, m.target)}</span>
        ${(m.noise > 0 || m.stress_added > 0) ? `
          <div class="measMeta">
            ${m.noise > 0 ? `<span class="measNoise">±${m.noise.toFixed(3)}</span>` : ""}
            ${m.stress_added > 0 ? `<span class="measStress">⚡${(m.stress_added * 100).toFixed(1)}%</span>` : ""}
          </div>
        ` : ""}
      </div>
    `).join("")}
  `;
}

function toProbeNumeric(measurement) {
  if (Number.isFinite(measurement)) return measurement;
  if (measurement && typeof measurement === "object") {
    const candidates = [
      measurement.observed_value,
      measurement.value,
      measurement.measurement,
      measurement.voltage,
      measurement.v,
      measurement.ohm,
    ];
    for (const c of candidates) {
      const n = Number(c);
      if (Number.isFinite(n)) return n;
    }
  }
  const n = Number(measurement);
  return Number.isFinite(n) ? n : NaN;
}

/* ==========================================================
   SMALL HELPERS
   ========================================================== */
// Robust number parse: accepts number or numeric string.
function toNumberFlex(v) {
  const n = toNumber(v);
  if (n != null) return n;
  if (typeof v === "string") {
    const p = Number.parseFloat(v);
    return Number.isFinite(p) ? p : null;
  }
  return null;
}

function renderMultimeterFeedback(result) {
  latestMultimeterUiState = result || createMultimeterUiState();
  renderMultimeterPanel({
    resultEl: multimeterResultEl,
    modeEl: multimeterModeLabelEl,
    targetEl: multimeterTargetLabelEl,
    statusEl: multimeterStatusEl,
    helpEl: multimeterHelpEl,
  }, latestMultimeterUiState);
}

function appendMeasurementHistoryEntry(result) {
  if (!result?.ok) return;
  measurementHistoryData.push({
    time: State.snapshot?.time ?? 0,
    target: result.historyTarget || result.targetLabel || "?",
    observed_value: result.historyValue,
    display_value: result.displayValue,
    noise: 0,
    stress_added: 0,
  });
  if (measurementHistoryData.length > 200) {
    measurementHistoryData = measurementHistoryData.slice(-200);
  }
  renderMeasurementHistory();
}

function targetDisplayLabel(target, fallback = "") {
  if (!target) return fallback;
  if (target.type === "component-pin") return target.label || `${target.componentId}:${target.pinId}`;
  if (target.type === "component") return target.label || target.componentId || fallback;
  if (target.type === "probe") {
    const railHint = target.railId ? ` [${target.railId}]` : "";
    return `${target.label || target.probeId || "Probe"}${railHint}`;
  }
  if (target.type === "rail") return target.label || target.railId || fallback;
  if (target.type === "node") return target.label || target.node || target.id || fallback;
  return target.label || target.id || fallback;
}

function cloneMeasurementTarget(target) {
  if (!target || typeof target !== "object") return null;
  return {
    ...target,
    rails: Array.isArray(target.rails) ? [...target.rails] : target.rails,
    pins: Array.isArray(target.pins) ? [...target.pins] : target.pins,
  };
}

function writeProbeInput(inputEl, target, placeholder) {
  if (!inputEl) return;
  inputEl.value = targetDisplayLabel(target, "");
  inputEl.placeholder = placeholder;
  inputEl.dataset.targetType = target?.type || "";
  inputEl.dataset.targetId = target?.id || "";
  inputEl.dataset.railId = resolveTargetRailHint(target);
  inputEl.title = target ? targetDisplayLabel(target) : placeholder;
}

function syncProbeInputFields() {
  writeProbeInput(multimeterRailEl, probeTargets.positive, "Touch red probe on PCB");
  writeProbeInput(multimeterRailBEl, probeTargets.negative, "Touch black probe on PCB");
}

function measurementPairLabel() {
  if (probeTargets.positive && probeTargets.negative) {
    return `${targetDisplayLabel(probeTargets.positive)} -> ${targetDisplayLabel(probeTargets.negative)}`;
  }
  if (probeTargets.positive) return targetDisplayLabel(probeTargets.positive);
  return "None";
}

function probePlacementHelp(mode = normalizeMultimeterMode(multimeterModeEl?.value || "voltage")) {
  const redReady = Boolean(probeTargets.positive);
  const blackReady = Boolean(probeTargets.negative);
  if (!redReady && !blackReady) return "Arm RED or BLACK, then click measurable points on the PCB.";
  if (!redReady) return "Place the red probe on the point you want to measure.";
  if (!blackReady) return `Place the black probe on the reference point for ${mode} mode.`;
  return `RED on ${targetDisplayLabel(probeTargets.positive)} and BLACK on ${targetDisplayLabel(probeTargets.negative)}. Press MEASURE to read ${mode}.`;
}

function updateProbeSelectionFeedback({
  status = "idle",
  mode = normalizeMultimeterMode(multimeterModeEl?.value || "voltage"),
  displayValue = latestMultimeterUiState?.displayValue || "--",
} = {}) {
  renderMultimeterFeedback({
    ...latestMultimeterUiState,
    mode,
    targetLabel: measurementPairLabel(),
    displayValue,
    status,
    helpText: probePlacementHelp(mode),
    summary: `Mode: ${mode} | Target: ${measurementPairLabel()} | Result: ${displayValue}`,
  });
}

function setProbeTarget(polarity, target) {
  const key = polarity === "negative" ? "negative" : "positive";
  probeTargets[key] = cloneMeasurementTarget(target);
  syncProbeInputFields();
  pcbViewerAPI?.setPlacedProbeTargets?.(probeTargets);
}

function clearProbeTargets() {
  probeTargets.positive = null;
  probeTargets.negative = null;
  syncProbeInputFields();
  pcbViewerAPI?.setPlacedProbeTargets?.(probeTargets);
}

function buildManualMeasurementTarget() {
  if (probeTargets.positive) return cloneMeasurementTarget(probeTargets.positive);
  if (currentMeasurementSelection?.target) return cloneMeasurementTarget(currentMeasurementSelection.target);

  const targetType = multimeterTargetTypeEl?.value || "rail";
  if (targetType === "component") {
    const componentId = multimeterComponentEl?.value?.trim();
    if (!componentId) return null;
    const component = currentBoardRuntime?.componentsById?.[componentId] || null;
    return {
      type: "component",
      id: `component:${componentId}`,
      componentId,
      rails: component?.rails || [],
      pins: component?.pins || [],
      label: component?.refdes || component?.label || componentId,
      source: "multimeter-ui",
    };
  }

  const railId = multimeterRailEl?.dataset?.railId?.trim();
  if (!railId) return null;
  const rail = currentBoardRuntime?.railsById?.[railId] || null;
  return {
    type: "rail",
    id: `rail:${railId}`,
    railId,
    label: rail?.label || railId,
    source: "multimeter-ui",
  };
}

function buildReferenceTarget() {
  if (probeTargets.negative) return cloneMeasurementTarget(probeTargets.negative);

  const railId = multimeterRailBEl?.dataset?.railId?.trim();
  if (!railId) return null;
  const rail = currentBoardRuntime?.railsById?.[railId] || null;
  return {
    type: "rail",
    id: `rail:${railId}`,
    railId,
    label: rail?.label || railId,
    source: "multimeter-ui",
  };
}

function resolveTargetRailHint(target) {
  if (!target) return "";
  if (typeof target.railId === "string" && target.railId.trim()) return target.railId.trim();
  if (Array.isArray(target.rails)) {
    const railId = target.rails.find((value) => typeof value === "string" && value.trim());
    if (railId) return railId.trim();
  }
  return "";
}

function syncMultimeterInputsFromTarget(target) {
  if (!target) return;

  if (target.type === "component" || target.type === "component-pin") {
    if (multimeterTargetTypeEl) {
      multimeterTargetTypeEl.value = "component";
      multimeterTargetTypeEl.dispatchEvent(new Event("change"));
    }
    if (multimeterComponentEl) {
      multimeterComponentEl.value = target.componentId || "";
    }
    return;
  }

  if (multimeterTargetTypeEl) {
    multimeterTargetTypeEl.value = "rail";
    multimeterTargetTypeEl.dispatchEvent(new Event("change"));
  }
}

function syncReferenceInputFromTarget(target) {
  writeProbeInput(multimeterRailBEl, target, "Touch black probe on PCB");
}

function applyActiveProbePolarity() {
  const isNegative = activeProbePolarity === "negative";
  if (multimeterProbePositiveBtn) {
    multimeterProbePositiveBtn.classList.toggle("is-active", !isNegative);
    multimeterProbePositiveBtn.setAttribute("aria-pressed", String(!isNegative));
  }
  if (multimeterProbeNegativeBtn) {
    multimeterProbeNegativeBtn.classList.toggle("is-active", isNegative);
    multimeterProbeNegativeBtn.setAttribute("aria-pressed", String(isNegative));
  }
}

function setActiveProbePolarity(polarity = "positive", { focusInput = false } = {}) {
  activeProbePolarity = polarity === "negative" ? "negative" : "positive";
  applyActiveProbePolarity();
  pcbViewerAPI?.setProbePolarity?.(activeProbePolarity);

  if (!focusInput) return;
  if (activeProbePolarity === "negative") {
    multimeterRailBEl?.focus();
    return;
  }
  multimeterRailEl?.focus();
}

async function performMultimeterMeasurement(target, { source = "manual" } = {}) {
  const activeTarget = target || buildManualMeasurementTarget();
  const mode = normalizeMultimeterMode(multimeterModeEl?.value || "voltage");
  const reference = buildReferenceTarget();

  currentMeasurementSelection = activeTarget
    ? { target: activeTarget, reference, source }
    : currentMeasurementSelection;

  const result = await measureBoardTarget({
    mode,
    target: activeTarget,
    reference,
    boardRuntime: currentBoardRuntime,
  });

  renderMultimeterFeedback(result);
  renderDiagnosisForTarget(activeTarget);
  if (result?.ok) {
    appendMeasurementHistoryEntry(result);
    if (result.beep) {
      playContinuityBeep();
    }
  }
  return result;
}


async function loadSessionReviewPanel() {
  const summaryEl = document.getElementById("sessionReviewSummary");
  const timelineEl = document.getElementById("sessionReviewTimeline");
  if (!summaryEl || !timelineEl) return;
  try {
    const res = await fetch("/reports/pedagogy/latest/session_review_sample.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const review = await res.json();
    summaryEl.textContent = `Score ${review.reasoning?.score_total ?? "-"} (${review.reasoning?.status ?? "unknown"}) · Risky ${review.risk_summary?.risky_actions_count ?? 0} · Secondary ${review.risk_summary?.secondary_damage_events ?? 0}`;
    const items = (review.timeline || []).slice(-8).map((e) => `<div class="measItem"><span class="measTime">t${e.tick}</span><span class="measTarget">${e.action?.tool}:${e.action?.target}</span><span class="measValue">${e.consequence?.level}</span></div>`).join("");
    timelineEl.innerHTML = items || '<div class="measEmpty">No timeline entries</div>';
  } catch {
    summaryEl.textContent = "Session review JSON unavailable (run pedagogy acceptance).";
    timelineEl.innerHTML = '<div class="measEmpty">No review timeline loaded</div>';
  }
}

function parseRuntimeQuery() {
  const parsed = { mode: null, faults: [] };
  if (typeof window === "undefined") return parsed;

  let params;
  try {
    params = new URLSearchParams(window.location.search || "");
  } catch {
    return parsed;
  }

  const modeRaw = String(params.get("mode") || "").trim().toUpperCase();
  if (["ALW", "S0", "SLEEP", "OFF"].includes(modeRaw)) {
    parsed.mode = modeRaw;
  }

  const faultRaw = params.getAll("fault").join(",");
  for (const token of String(faultRaw || "").split(",")) {
    const part = token.trim();
    if (!part) continue;
    const [railIdRaw, typeRaw] = part.split(":");
    const railId = String(railIdRaw || "").trim();
    const type = String(typeRaw || "").trim().toLowerCase();
    if (!railId) continue;
    if (type !== "short" && type !== "open" && type !== "disable_regulator") continue;
    parsed.faults.push({ railId, type });
  }

  return parsed;
}

function updateStatus(msg) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  // simple color map
  if (msg === "RUNNING") statusEl.style.color = "#4ec9b0";
  else if (msg === "ERROR") statusEl.style.color = "#f44747";
  else statusEl.style.color = "#ff4500";
}

function renderPowerInput(pi) {
  if (!pi || !psuStatusEl) return;
  psuStatusEl.textContent = pi.enabled ? `PSU: ON  ${pi.voltage}V` : "PSU: OFF";
  if (psuCurrentEl) {
    psuCurrentEl.textContent = `Current: ${formatNumber(pi.measured_current, 3)} A`;
  }
  if (psuTargetStatusEl) {
    psuTargetStatusEl.textContent = `Target: ${pi.target_rail || "None"}`;
  }
  if (psuTargetRailEl && pi.target_rail) {
    psuTargetRailEl.value = pi.target_rail;
  }
}

function createRailToggle(name) {
  if (!railTogglePanel) return;

  const label = document.createElement("label");
  label.style.display = "block";
  label.style.fontSize = "12px";
  label.style.marginTop = "6px";
  label.innerHTML = `<input type="checkbox" checked> ${name}`;

  const input = label.querySelector("input");
  input.onchange = (e) => {
    railVisibility[name] = e.target.checked;
    markDirty();
  };

  railTogglePanel.appendChild(label);
}

function clearSeriesMap(map) {
  Object.keys(map).forEach((key) => delete map[key]);
}

function resetReplayState() {
  clearSeriesMap(voltageHistory);
  clearSeriesMap(voltageSmoothed);
  clearSeriesMap(thermalHistory);
  clearSeriesMap(thermalSmoothed);
  distressHistory.length = 0;
  diagnosticHistory.length = 0;
  clearSeriesMap(railVisibility);
  if (railTogglePanel) railTogglePanel.innerHTML = "";
}

function replayTimelineToIndex(index) {
  const snapshots = getTimelineSnapshots();
  if (!Array.isArray(snapshots) || snapshots.length === 0) return;

  const safeIndex = Math.max(0, Math.min(index, snapshots.length - 1));
  resetReplayState();

  for (let i = 0; i <= safeIndex; i++) {
    processSnapshot(snapshots[i]);
  }

  markDirty();
}

/* ==========================================================
   INITIALIZATION & CHART SETUP
   ========================================================== */
const voltageOffscreen = createOffscreenCanvas(voltageCanvas);
const thermalOffscreen = createOffscreenCanvas(thermalCanvas);
const distressOffscreen = createOffscreenCanvas(distressCanvas);

function handleResize() {
  [voltageCanvas, thermalCanvas, distressCanvas].forEach(resizeCanvasToDisplaySize);
  syncOffscreen(voltageOffscreen, voltageCanvas);
  syncOffscreen(thermalOffscreen, thermalCanvas);
  syncOffscreen(distressOffscreen, distressCanvas);
  markDirty();
}

/* ==========================================================
   CORE SNAPSHOT PROCESSOR
   ========================================================== */
function processSnapshot(snap) {
  if (!snap) return;

  console.log("processSnapshot - rails:", snap.rails, "thermals:", snap.thermals);

  // show raw snapshot for debugging
  if (out) out.textContent = JSON.stringify(snap, null, 2);

  // Measurement History
  if (snap.measurements && Array.isArray(snap.measurements)) {
    measurementHistoryData = snap.measurements;
    renderMeasurementHistory();
  }

  // PSU panel
  renderPowerInput(snap.power_input);

  // distress history
  const distress = clamp01(snap.distress ?? 0);
  distressHistory.push(distress);
  trim(distressHistory, MAX_POINTS);

  // rails
  const rails = Array.isArray(snap.rails) ? snap.rails : [];
  setPsuTargetRailOverlay(snap?.power_input?.target_rail || "");
  rails.forEach((r, idx) => {
    const name = r?.name ?? `rail_${idx}`;
    const raw = toNumberFlex(r?.voltage);

    if (!voltageHistory[name]) {
      voltageHistory[name] = [];
      voltageSmoothed[name] = [];
      railVisibility[name] = true;
      createRailToggle(name);
    }

    voltageHistory[name].push(raw);
    trim(voltageHistory[name], MAX_POINTS);

    const prev = lastValue(voltageSmoothed[name]);
    const next =
      raw == null
        ? prev
        : (prev == null ? raw : (smoothingAlpha * raw + (1 - smoothingAlpha) * prev));

    voltageSmoothed[name].push(next);
    trim(voltageSmoothed[name], MAX_POINTS);
  });

  // thermals
  const thermals = Array.isArray(snap.thermals) ? snap.thermals : [];
  thermals.forEach((z, idx) => {
    const name = z?.zone ?? `zone_${idx}`;
    const raw = toNumberFlex(z?.temperature);

    if (!thermalHistory[name]) {
      thermalHistory[name] = [];
      thermalSmoothed[name] = [];
    }

    thermalHistory[name].push(raw);
    trim(thermalHistory[name], MAX_POINTS);

    const prev = lastValue(thermalSmoothed[name]);
    const next =
      raw == null
        ? prev
        : (prev == null ? raw : (smoothingAlpha * raw + (1 - smoothingAlpha) * prev));

    thermalSmoothed[name].push(next);
    trim(thermalSmoothed[name], MAX_POINTS);
  });

  // diagnostic
  const diag = computeDiagnostic({
    rails,
    thermals,
    distress,
    time: snap.time ?? Date.now(),
  });
  diagnosticHistory.push(diag);
  if (diagnosticHistory.length > 500) diagnosticHistory.shift();

  markDirty();
}

function renderPsuTargetOptions(injectableRails, current) {
  if (!psuTargetRailEl) return;

  const items = [`<option value="">(no target)</option>`].concat(
    (injectableRails || []).map((id) => `<option value="${id}">${id}</option>`)
  );
  psuTargetRailEl.innerHTML = items.join("");

  if (current && (injectableRails || []).includes(current)) {
    psuTargetRailEl.value = current;
  } else {
    psuTargetRailEl.value = "";
  }
}

/* ==========================================================
   RENDER LOOP
   ========================================================== */
let lastRenderTime = 0;
let dirty = true;
const targetFrameDuration = 1000 / TARGET_FPS;

function markDirty() { dirty = true; }

function updatePanelsFromLatestDiagnostic() {
  const diag = diagnosticHistory[diagnosticHistory.length - 1];
  if (!diag) return;

  if (diagnosticText) diagnosticText.textContent = diag.message ?? "";
  if (diagnosticConfidence) {
    diagnosticConfidence.textContent = `Confidence: ${formatNumber(diag.confidence ?? 0, 2)}`;
  }

  // Update hypothesis list
  const hypothesisList = document.getElementById('hypothesisList');
  if (hypothesisList && diag.hypotheses) {
    hypothesisList.innerHTML = '';
    diag.hypotheses.forEach(h => {
      const li = document.createElement('li');
      li.textContent = h.text;
      li.style.color = h.type === 'critical' ? '#ff4500' : h.type === 'distress' ? '#ffcc00' : '#ce9178';
      hypothesisList.appendChild(li);
    });
  }

  // FIX: dulu pakai snap yang undefined -> selalu 0
  if (distressFill) {
    const pct = Math.max(0, Math.min(100, Number(diag.distress ?? 0) * 100));
    distressFill.style.width = pct + "%";
  }
}

function renderLoop(now) {
  if (!lastRenderTime) lastRenderTime = now;
  const elapsed = now - lastRenderTime;

  if (dirty && elapsed >= targetFrameDuration) {
    drawVoltageChart(voltageCanvas, voltageOffscreen);
    drawThermalChart(thermalCanvas, thermalOffscreen);
    drawDistressChart(distressCanvas, distressOffscreen);
    lastRenderTime = now;
    dirty = false;
  }

  updatePanelsFromLatestDiagnostic();
  requestAnimationFrame(renderLoop);
}

/* ==========================================================
   APP STARTUP
   ========================================================== */
let engineLoopId = null;
let engineReady = false;

document.addEventListener("DOMContentLoaded", () => {
  window.hpSim = {
    injectFault,
    clearFault,
    setSystemMode,
    dumpPower: debugDumpPower,
    dumpElectricalGraph: () => Tools.getDiagnosisSnapshot()?.graph,
    dumpSelectedTarget: () => Tools.getDiagnosisSnapshot()?.lastSelection,
    dumpFaults: () => Tools.getDiagnosisSnapshot()?.faults,
    setDiagnosisFault,
    clearFaultsForTarget,
    debugComponent: (componentId) => diagnosisDebugComponent(componentId),
    debugRail: (railId) => diagnosisDebugRail(railId),
  };

  handleResize();
  window.addEventListener("resize", debounce(handleResize, 100));
  const pendingRestoreSession = consumePendingRestore();

  // 1) BOOT ENGINE
  (async () => {
    try {
      const first = await bootEngine();
      engineReady = true;
      State.setSnapshot(first);
      processSnapshot(first);

      if (pendingRestoreSession) {
        const restored = applyRestoredSession(pendingRestoreSession);
        if (restored) {
          const scenarioId = pendingRestoreSession.scenarioId || pendingRestoreSession?.scenario?.id;
          if (scenarioId) {
            const scenarioSelect = document.getElementById("scenarioSelect");
            if (scenarioSelect) scenarioSelect.value = scenarioId;
            setScenario(scenarioId);
          }

          const restoredSnapshot = pendingRestoreSession.lastSnapshot;
          if (restoredSnapshot && typeof restoredSnapshot === "object") {
            if (out) out.textContent = JSON.stringify(restoredSnapshot, null, 2);
            if (Array.isArray(restoredSnapshot.measurements)) {
              measurementHistoryData = restoredSnapshot.measurements;
              renderMeasurementHistory();
            }
            renderPowerInput(restoredSnapshot.power_input);
            setPsuTargetRailOverlay(restoredSnapshot?.power_input?.target_rail || "");
          }

          updateScenarioDisplay();
          markDirty();
          console.log("Session restored from saved data");
        }
      }

      updateStatus("PAUSED");
      requestAnimationFrame(renderLoop);
      console.log("🚀 Engine ready");
    } catch (e) {
      console.error("Critical Start Failure:", e);
      if (out) out.textContent = `BOOT ERROR:\n${String(e?.stack || e)}`;
      updateStatus("ERROR");
    }
  })();

  // 2) INIT PCB VIEWER
  let pcbViewerAPI = null;
  installPcbViewerDevApi({ viewerApiProvider: () => pcbViewerAPI });

  try {
    pcbViewerAPI = initPcbViewerPanel({
      mountSelector: "#motherboardMap",
      onBoardReady: async ({ board, components, rails, topology, runtime }) => {
        console.log("📡 Board loaded:", board?.id);
        currentBoardRuntime = runtime || null;
        currentMeasurementSelection = null;
        clearProbeTargets();
        renderMultimeterFeedback({
          ...createMultimeterUiState(),
          mode: normalizeMultimeterMode(multimeterModeEl?.value || "voltage"),
          summary: `Mode: ${normalizeMultimeterMode(multimeterModeEl?.value || "voltage")} | Target: None | Result: --`,
          helpText: "Place the red and black probes on measurable points on the motherboard.",
        });

        if (boardProfileLabelEl) {
          boardProfileLabelEl.textContent = board?.name || board?.id || "Board Loaded";
        }

        // Fill multimeter component dropdown
        if (multimeterComponentEl && Array.isArray(components)) {
          multimeterComponentEl.innerHTML = ['<option value="">Select Component</option>']
            .concat(components.map(c => `<option value="${c.id}">${c.refdes || c.id} (${c.name || c.kind || "Component"})</option>`))
            .join("");
        }

        if (multimeterRailEl && Array.isArray(rails) && rails.length) {
          syncProbeInputFields();
        }

        if (topology) {
          await applyTopologyGraph(topology);
        }

        if (board?.id) {
          try {
            await Tools.loadBoardRails(board.id, { baseUrl: "" });

            const runtimeQuery = parseRuntimeQuery();
            if (runtimeQuery.mode) {
              setSystemMode(runtimeQuery.mode);
            }
            if (runtimeQuery.faults.length) {
              const knownRails = new Set((Tools.state.board.rails || []).map((r) => String(r?.id || "")));
              for (const f of runtimeQuery.faults) {
                if (!knownRails.has(f.railId)) continue;
                injectFault(f.railId, { type: f.type });
                if (f.type === "short") setDiagnosisFault({ type: "short_gnd", targetType: "rail", targetId: f.railId });
                if (f.type === "open") setDiagnosisFault({ type: "open_line", targetType: "rail", targetId: f.railId });
              }
            }

            Tools.setPSUConfig({ targetRail: null });
            dispatchToolAction({ ClearPSUTargetRail: {} });
            renderPsuTargetOptions(
              Tools.state.board.injectableRails,
              Tools.state.psu.targetRail
            );
          } catch (e) {
            console.warn("Failed to load board rails metadata:", e);
          }
        }
      }
    });
  } catch (e) {
    console.error("PCB Viewer init failed:", e);
    if (out) out.textContent = `PCB VIEWER ERROR:\n${String(e?.stack || e)}`;
  }

  window.dumpBoard = () => currentBoardRuntime;
  window.dumpRails = () => currentBoardRuntime?.rails || [];
  window.dumpComponents = () => currentBoardRuntime?.components || [];
  window.debugPick = (x, y) => pcbViewerAPI?.debugPick?.(x, y) || null;
  window.debugMeasureCurrentSelection = () => performMultimeterMeasurement(currentMeasurementSelection?.target || buildManualMeasurementTarget(), { source: "debug" });
  window.dumpSelectedMeasurementTarget = () => currentMeasurementSelection?.target || null;
  window.dumpLastMeasurementResult = () => latestMultimeterUiState || null;
  window.debugComponentMeasurement = (componentId, mode = null) => {
    if (!componentId) return null;
    const target = {
      type: "component",
      id: `component:${componentId}`,
      componentId,
      source: "debug",
    };
    if (mode && multimeterModeEl) multimeterModeEl.value = mode;
    return performMultimeterMeasurement(target, { source: "debug-component" });
  };

  // 2.5) INIT BOARD SELECTOR IN TOPBAR
  async function initBoardSelector() {
    const boardSelectorContainer = document.getElementById('boardSelector');
    if (!boardSelectorContainer) return;
    
    try {
      const boards = await pcbViewerAPI?.getBoardList();
      if (!boards || boards.length === 0) return;
      
      boardSelectorContainer.innerHTML = `
        <select id="topbar-board-select" class="board-select">
          ${boards.map(b => `<option value="${b.id}">${b.name || b.id}</option>`).join('')}
        </select>
      `;
      
      const topbarSelect = document.getElementById('topbar-board-select');
      topbarSelect.addEventListener('change', async (e) => {
        const boardId = e.target.value;
        console.log('Switching to board:', boardId);
        
        pcbViewerAPI?.clearScene();
        resetBoardState();
        await pcbViewerAPI?.loadBoard(boardId);
        
        if (boardProfileLabelEl) {
          const board = boards.find(b => b.id === boardId);
          boardProfileLabelEl.textContent = board?.name || boardId;
        }
      });
      
      console.log('📋 Board selector ready');
    } catch (e) {
      console.error('Board selector init failed:', e);
    }
  }
  
  initBoardSelector();

  // 3) INIT SCENARIO SELECTOR
  initScenarioSelector()
    .then(() => {
      updateScenarioDisplay();
      console.log("📋 Scenario selector ready");
    })
    .catch((e) => {
      console.error("Scenario selector init failed:", e);
    });

  // 4) INIT EXPORT REPORT
  try {
    initExportReport();
    console.log("📄 Export report ready");
  } catch (e) {
    console.error("Export report init failed:", e);
  }

  // 5) INIT TIMELINE
  try {
    initTimeline();
    console.log("⏱️ Timeline ready");
  } catch (e) {
    console.error("Timeline init failed:", e);
  }

  window.addEventListener("timeline:jump", (evt) => {
    const index = Number(evt?.detail?.index);
    if (!Number.isFinite(index)) return;
    if (engineLoopId) clearInterval(engineLoopId);
    engineLoopId = null;
    loopBusy = false;
    replayTimelineToIndex(index);
    updateStatus("PAUSED");
  });

  // 6) INIT SAVE/LOAD
  try {
    initSaveLoad();
    console.log("💾 Save/Load ready");

    const showOutcomeBtn = document.getElementById('showOutcome');
    if (showOutcomeBtn) {
      showOutcomeBtn.addEventListener('click', () => {
        showOutcomeModal();
      });
    }
  } catch (e) {
    console.error("Save/Load init failed:", e);
  }

  // Multimeter UI Logic: Enable/Disable inputs based on target type
  renderMultimeterFeedback(latestMultimeterUiState);
  if (multimeterTargetTypeEl) {
    multimeterTargetTypeEl.addEventListener("change", () => {
      const isComponent = multimeterTargetTypeEl.value === "component";
      if (multimeterComponentEl) multimeterComponentEl.disabled = !isComponent;
    });
    // Initialize UI state
    multimeterTargetTypeEl.dispatchEvent(new Event("change"));
  }

  if (multimeterModeEl) {
    multimeterModeEl.addEventListener("change", () => {
      const mode = normalizeMultimeterMode(multimeterModeEl.value);
      updateProbeSelectionFeedback({ mode });
    });
  }

  applyActiveProbePolarity();
  syncProbeInputFields();
  if (multimeterProbePositiveBtn) {
    multimeterProbePositiveBtn.addEventListener("click", () => setActiveProbePolarity("positive", { focusInput: true }));
  }
  if (multimeterProbeNegativeBtn) {
    multimeterProbeNegativeBtn.addEventListener("click", () => setActiveProbePolarity("negative", { focusInput: true }));
  }
  multimeterRailEl?.addEventListener("focus", () => setActiveProbePolarity("positive"));
  multimeterRailEl?.addEventListener("pointerdown", () => setActiveProbePolarity("positive"));
  multimeterRailBEl?.addEventListener("focus", () => setActiveProbePolarity("negative"));
  multimeterRailBEl?.addEventListener("pointerdown", () => setActiveProbePolarity("negative"));

  window.addEventListener("pcb:measurement-target-selected", (evt) => {
    const detail = evt?.detail || {};
    const target = detail.target || null;
    currentBoardRuntime = detail.boardRuntime || currentBoardRuntime;

    if (activeProbePolarity === "negative") {
      setProbeTarget("negative", target);
      syncReferenceInputFromTarget(target);
      updateProbeSelectionFeedback();
      return;
    }

    if (!target) return;
    setProbeTarget("positive", target);
    currentMeasurementSelection = {
      target: cloneMeasurementTarget(target),
      reference: buildReferenceTarget(),
      source: detail.source || "board",
    };
    syncMultimeterInputsFromTarget(target);
    updateProbeSelectionFeedback();
  });
  window.addEventListener("pcb:pick-missed", () => {
    renderMultimeterFeedback({
      ok: false,
      mode: normalizeMultimeterMode(multimeterModeEl?.value || "voltage"),
      targetLabel: measurementPairLabel(),
      displayValue: "--",
      status: "warning",
      helpText: "No measurable target was found at the clicked position.",
      summary: "Click landed outside probe, component, and rail geometry.",
    });
  });

  /* =========================
     UI EVENT LISTENERS
     ========================= */

  // PSU Apply
  if (psuApplyBtn) {
    psuApplyBtn.onclick = async () => {
      if (!engineReady) return;

      Tools.setPSUConfig({
        voltage: parseFloat(psuVoltageEl.value) || 4.2,
        currentLimit: parseFloat(psuCurrentLimitEl.value) || 2.0,
        enabled: !!psuEnableEl.checked,
        targetRail: psuTargetRailEl.value || null,
      });

      await Tools.applyPSU();

      const snap = await snapshot();
      processSnapshot(snap);
    };
  }

  if (psuTargetRailEl) {
    psuTargetRailEl.onchange = async () => {
      if (!engineReady) return;

      Tools.setPSUConfig({ targetRail: psuTargetRailEl.value || null });
      await Tools.applyPSUTargetOnly();

      const snap = await snapshot();
      processSnapshot(snap);
    };
  }

  // Multimeter Measure
  if (manualMeasureBtn) {
    manualMeasureBtn.onclick = async () => {
      await performMultimeterMeasurement(currentMeasurementSelection?.target || null, { source: "manual" });
    };
  }

  // STEP
  if (stepBtn) {
    stepBtn.onclick = async () => {
      if (!engineReady) {
        console.warn("Engine not ready. Please wait for boot.");
        return;
      }
      const snap = await step();
      if (snap && typeof snap === "object") {
        State.setSnapshot(snap);
        processSnapshot(snap);
        saveSnapshot(snap);
      }
      updateStatus("PAUSED");
    };
  }

  // RUN / PAUSE (speed aware)
  function currentIntervalMs() {
    const speed = Number(speedSelect?.value || 1);
    const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
    return Math.max(10, Math.round(ENGINE_BASE_INTERVAL_MS / s));
  }

  let loopBusy = false;

  if (runBtn) {
    runBtn.onclick = () => {
      if (!engineReady) {
        console.warn("Engine not ready. Please wait for boot.");
        return;
      }
      if (engineLoopId) return;
      engineLoopId = setInterval(async () => {
        if (loopBusy) return;
        loopBusy = true;
        try {
          const snap = await step();
          if (snap && typeof snap === "object") {
            State.setSnapshot(snap);
            processSnapshot(snap);
            saveSnapshot(snap);
          }
        } catch (e) {
          console.error("Engine loop step failed:", e);
        } finally {
          loopBusy = false;
        }
      }, currentIntervalMs());
      updateStatus("RUNNING");
    };
  }

  if (pauseBtn) {
    pauseBtn.onclick = () => {
      if (engineLoopId) clearInterval(engineLoopId);
      engineLoopId = null;
      loopBusy = false;
      updateStatus("PAUSED");
    };
  }

  if (speedSelect) {
    speedSelect.onchange = () => {
      // if running, restart interval at new speed
      if (!engineLoopId) return;
      clearInterval(engineLoopId);
      engineLoopId = setInterval(async () => {
        if (loopBusy) return;
        loopBusy = true;
        try {
          const snap = await step();
          if (snap && typeof snap === "object") {
            State.setSnapshot(snap);
            processSnapshot(snap);
            saveSnapshot(snap);
          }
        } catch (e) {
          console.error("Engine loop step failed:", e);
        } finally {
          loopBusy = false;
        }
      }, currentIntervalMs());
    };
  }

  // RESET
  if (resetBtn) resetBtn.onclick = () => {
    showOutcomeModal();
    setTimeout(() => {
      window.location.reload();
    }, 100);
  };

  // AI Panel Button - Add floating button
  const aiBtn = document.createElement('button');
  aiBtn.id = 'ai-toggle-btn';
  aiBtn.textContent = '🤖 AI';
  aiBtn.style.cssText = `
    position: fixed;
    right: 20px;
    bottom: 20px;
    padding: 10px 20px;
    background: #4a90d9;
    color: white;
    border: none;
    border-radius: 25px;
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
    z-index: 999;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
  `;
  aiBtn.onclick = showAIPanel;
  document.body.appendChild(aiBtn);

  // Oscilloscope Button
  const scopeBtn = document.createElement('button');
  scopeBtn.id = 'scope-toggle-btn';
  scopeBtn.textContent = '📟 Scope';
  scopeBtn.style.cssText = `
    position: fixed;
    right: 90px;
    bottom: 20px;
    padding: 10px 20px;
    background: #ff6600;
    color: white;
    border: none;
    border-radius: 25px;
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
    z-index: 999;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
  `;
  scopeBtn.onclick = toggleOscilloscope;
  document.body.appendChild(scopeBtn);

  loadSessionReviewPanel();
});



