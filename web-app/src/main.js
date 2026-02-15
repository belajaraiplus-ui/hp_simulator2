// src/main.js
import { applyPsuConfig, bootEngine, measureTool, snapshot, step } from "./engine/adapter.js";
import { initPcbViewerPanel } from "./pcb_viewer/panel.js";
import { MAX_POINTS, TARGET_FPS, ENGINE_BASE_INTERVAL_MS } from "./config.js";
import { clamp01, toNumber, trim, lastValue, formatNumber, debounce } from "./utils.js";
import {
  State, voltageHistory, voltageSmoothed, thermalHistory, thermalSmoothed,
  distressHistory, diagnosticHistory, railVisibility,
  selectedBoardComponent, setSelectedBoardComponent,
  smoothingAlpha, setSmoothingAlpha, resmoothAll
} from "./state.js";
import { computeDiagnostic, analyzeDistressTrend } from "./analysis.js";
import { createOffscreenCanvas, resizeCanvasToDisplaySize, syncOffscreen, drawVoltageChart, drawThermalChart, drawDistressChart } from "./ui/charts.js";
import { renderMotherboardMap } from "./ui/board.js";
import { buildMultimeterLabel, renderMultimeterResult } from "./ui/multimeter.js";

/*
  Production-ready UI controller for HP Repair Simulator – Proxy Dashboard.
*/

/* =========================
   DOM REFERENCES (queried here; may be null until DOMContentLoaded)
========================= */
const out = document.getElementById("out");
const stepBtn = document.getElementById("step");
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
const multimeterComponentEl = document.getElementById("multimeterComponent");
const multimeterResultEl = document.getElementById("multimeterResult");
const boardProfileLabelEl = document.getElementById("boardProfileLabel");
const motherboardMapEl = document.getElementById("motherboardMap");

const psuEnableEl = document.getElementById("psuEnable");
const psuVoltageEl = document.getElementById("psuVoltage");
const psuCurrentLimitEl = document.getElementById("psuCurrentLimit");
const psuApplyBtn = document.getElementById("psuApply");
const psuStatusEl = document.getElementById("psuStatus");
const psuCurrentEl = document.getElementById("psuMeasuredCurrent");

const diagnosticText = document.getElementById("diagnosticText");
const diagnosticConfidence = document.getElementById("diagnosticConfidence");
const hypothesisList = document.getElementById("hypothesisList");
const diagnosticLog = document.getElementById("diagnosticLog");
const exportReportBtn = document.getElementById("exportReport");
const railTogglePanel = document.getElementById("railTogglePanel");

const simTimeEl = document.getElementById("simTime");
const scenarioNameEl = document.getElementById("scenarioName");
const coveragePercentEl = document.getElementById("coveragePercent");
const unobservedRailsEl = document.getElementById("unobservedRails");
const distressBreakdownEl = document.getElementById("distressBreakdown");
const timelineScrubber = document.getElementById("timelineScrubber");
const scenarioSelect = document.getElementById("scenarioSelect");

// smoothing slider elements (may be null until DOM ready)
const smoothingSliderEl = document.getElementById("smoothingSlider");
const smoothingValueEl = document.getElementById("smoothingValue");

let currentScenario = "Default";
if (scenarioNameEl) scenarioNameEl.textContent = currentScenario;

/* =========================
   OFFSCREEN CANVASES
========================= */
const voltageOffscreen = createOffscreenCanvas(voltageCanvas);
const thermalOffscreen = createOffscreenCanvas(thermalCanvas);
const distressOffscreen = createOffscreenCanvas(distressCanvas);

function syncMultimeterTargetUi() {
  const useComponent = multimeterTargetTypeEl && multimeterTargetTypeEl.value === "component";
  if (multimeterRailEl) {
    multimeterRailEl.disabled = !!useComponent;
  }
  if (multimeterComponentEl) {
    multimeterComponentEl.disabled = !useComponent;
  }
}

function renderPowerInput(powerInput) {
  if (!powerInput) return;

  if (psuStatusEl) {
    const enabled = !!powerInput.enabled;
    psuStatusEl.textContent = enabled
      ? `PSU: ON ${formatNumber(powerInput.voltage, 2)} V / ${formatNumber(powerInput.current_limit, 2)} A`
      : "PSU: OFF";
  }

  if (psuCurrentEl) {
    psuCurrentEl.textContent = `Current: ${formatNumber(powerInput.measured_current, 3)} A`;
  }
}

function handleResize() {
  [voltageCanvas, thermalCanvas, distressCanvas].forEach(resizeCanvasToDisplaySize);
  syncOffscreen(voltageOffscreen, voltageCanvas);
  syncOffscreen(thermalOffscreen, thermalCanvas);
  syncOffscreen(distressOffscreen, distressCanvas);
  markDirty();
}

/* =========================
   PROCESS SNAPSHOT -> HISTORY (uses smoothingAlpha)
========================= */
function processSnapshot(snapshot) {
  if (!snapshot) return;
  if (out) out.textContent = JSON.stringify(snapshot, null, 2);
  renderPowerInput(snapshot.power_input);
  renderMotherboardMap(snapshot, {
    motherboardMapEl,
    boardProfileLabelEl,
    multimeterComponentEl,
    multimeterTargetTypeEl
  });

  const distress = clamp01(snapshot.distress ?? 0);
  distressHistory.push(distress);
  trim(distressHistory, MAX_POINTS);

  const rails = Array.isArray(snapshot.rails) ? snapshot.rails : [];
  rails.forEach((r, idx) => {
    const name = r?.name ?? `rail_${idx}`;
    const raw = toNumber(r?.voltage);
    if (!voltageHistory[name]) {
      voltageHistory[name] = [];
      voltageSmoothed[name] = [];
      railVisibility[name] = (railVisibility[name] === undefined) ? true : !!railVisibility[name];
      createRailToggle(name);
    }
    voltageHistory[name].push(raw);
    trim(voltageHistory[name], MAX_POINTS);

    const prev = lastValue(voltageSmoothed[name]);
    const next = raw == null ? prev : (prev == null ? raw : (smoothingAlpha * raw + (1 - smoothingAlpha) * prev));
    voltageSmoothed[name].push(next);
    trim(voltageSmoothed[name], MAX_POINTS);
  });

  const thermals = Array.isArray(snapshot.thermals) ? snapshot.thermals : [];
  thermals.forEach((z, idx) => {
    const name = z?.zone ?? `zone_${idx}`;
    const raw = toNumber(z?.temperature);
    if (!thermalHistory[name]) {
      thermalHistory[name] = [];
      thermalSmoothed[name] = [];
    }
    thermalHistory[name].push(raw);
    trim(thermalHistory[name], MAX_POINTS);

    const prev = lastValue(thermalSmoothed[name]);
    const next = raw == null ? prev : (prev == null ? raw : (smoothingAlpha * raw + (1 - smoothingAlpha) * prev));
    thermalSmoothed[name].push(next);
    trim(thermalSmoothed[name], MAX_POINTS);
  });

  const diag = computeDiagnostic({ rails, thermals, distress, time: snapshot.time ?? Date.now() });
  diagnosticHistory.push(diag);
  if (diagnosticHistory.length > 500) diagnosticHistory.shift();

  markDirty();
}

/* =========================
   RENDER LOOP & DRAWING
========================= */
let lastRenderTime = 0;
let dirty = true;
const targetFrameDuration = 1000 / TARGET_FPS;
function markDirty() { dirty = true; }
function clearDirty() { dirty = false; }

function renderLoop(now) {
  if (!lastRenderTime) lastRenderTime = now;
  const elapsed = now - lastRenderTime;
  if (dirty && elapsed >= targetFrameDuration) {
    drawAllCharts();
    lastRenderTime = now;
    clearDirty();
  }
  updatePanelsFromLatestDiagnostic();
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

function drawAllCharts() {
  drawVoltageChart(voltageCanvas, voltageOffscreen);
  drawThermalChart(thermalCanvas, thermalOffscreen);
  drawDistressChart(distressCanvas, distressOffscreen);
}

/* =========================
   UI PANELS
========================= */
let lastDiagRendered = null;
function updatePanelsFromLatestDiagnostic() {
  const diag = diagnosticHistory.length ? diagnosticHistory[diagnosticHistory.length - 1] : null;
  if (!diag) return;
  if (lastDiagRendered && lastDiagRendered.timestamp === diag.timestamp && lastDiagRendered.confidence === diag.confidence) return;
  lastDiagRendered = diag;

  if (diagnosticText) diagnosticText.textContent = diag.message || "";
  if (diagnosticConfidence) diagnosticConfidence.textContent = "Confidence level: " + Math.round((diag.confidence || 0) * 100) + "% (proxy-based)";

  if (hypothesisList) {
    hypothesisList.innerHTML = "";
    const hyps = [];
    if (diag.voltageIssues && diag.voltageIssues.length) hyps.push({ label: "Possible power instability", prob: 0.6 + (diag.confidence || 0) * 0.3 });
    if (diag.thermalIssues && diag.thermalIssues.length) hyps.push({ label: "Possible overheating condition", prob: 0.5 + (diag.confidence || 0) * 0.4 });
    if (diag.distressTrend === "rising") hyps.push({ label: "System stress escalation", prob: 0.4 + (diag.distress || 0) * 0.5 });
    if (!hyps.length) hyps.push({ label: "No observable anomaly", prob: 0.9 - (diag.distress || 0) });

    hyps.sort((a, b) => b.prob - a.prob).forEach(h => {
      const li = document.createElement("li");
      li.textContent = `${h.label} — ${Math.round(Math.max(0, Math.min(1, h.prob)) * 100)}%`;
      hypothesisList.appendChild(li);
    });
  }

  if (diagnosticLog) diagnosticLog.textContent = JSON.stringify(diag, null, 2);

  if (simTimeEl && State.get().lastSnapshot) {
    simTimeEl.textContent = ((State.get().lastSnapshot?.time ?? 0)).toFixed ? (State.get().lastSnapshot.time ?? 0).toFixed(2) : String(State.get().lastSnapshot.time ?? 0);
  }

  if (coveragePercentEl && unobservedRailsEl) {
    const rails = (State.get().lastSnapshot?.rails) || [];
    const observed = rails.filter(r => r && r.voltage != null).length;
    const total = rails.length || 0;
    const cov = total === 0 ? 0 : Math.round((observed / total) * 100);
    coveragePercentEl.textContent = cov + "%";
    unobservedRailsEl.innerHTML = "";
    rails.filter(r => r && r.voltage == null).forEach(r => {
      const li = document.createElement("li"); li.textContent = "Unobserved: " + (r.name || "unknown"); unobservedRailsEl.appendChild(li);
    });
  }

  if (distressBreakdownEl) {
    distressBreakdownEl.innerHTML = "";
    const distress = clamp01(State.get().lastSnapshot?.distress ?? 0);
    const breakdown = [
      "Overall Distress: " + Math.round(distress * 100) + "%",
      "Trend: " + analyzeDistressTrend(),
      "Observability Influence: based on missing rail measurements",
      "Noise Influence: based on recent measurement variance"
    ];
    breakdown.forEach(txt => {
      const li = document.createElement("li"); li.textContent = txt; distressBreakdownEl.appendChild(li);
    });
  }

  if (distressFill) {
    const v = clamp01(State.get().lastSnapshot?.distress ?? 0);
    const pct = v * 100;
    distressFill.style.width = pct + "%";
    distressFill.style.background = pct < 40 ? "green" : pct < 70 ? "orange" : "red";
  }
}

/* =========================
   CONTROLS / SAFE INIT (wait for DOM ready)
========================= */
let engineLoopId = null;
let engineReady = false;
let speedMultiplier = 1;

document.addEventListener("DOMContentLoaded", () => {
  // Ensure canvases sized correctly after DOM ready
  handleResize();
  window.addEventListener("resize", debounce(handleResize, 100));

  async function startEngine() {
    try {
      const snap = await bootEngine();
      engineReady = true;
      State.setSnapshot(snap);
      processSnapshot(snap);
      updateStatus("PAUSED");
    } catch (e) {
      if (out) out.textContent = "Engine failed to start: " + (e?.message || e);
      updateStatus("ERROR");
    }
  }
  startEngine();

  // SMOOTHING SLIDER binding (if present)
  if (smoothingSliderEl) {
    // initialize display
    smoothingSliderEl.value = String(smoothingAlpha);
    if (smoothingValueEl) smoothingValueEl.textContent = smoothingAlpha.toFixed(2);

    smoothingSliderEl.addEventListener("input", (evt) => {
      const v = parseFloat(evt.target.value);
      if (!Number.isFinite(v)) return;
      setSmoothingAlpha(Math.max(0, Math.min(1, v)));
      if (smoothingValueEl) smoothingValueEl.textContent = smoothingAlpha.toFixed(2);
      // recompute smoothed arrays from raw histories so effect is immediate
      resmoothAll();
    });
  }

  // STEP
  if (stepBtn) {
    stepBtn.addEventListener("click", () => {
      if (!engineReady) return;
      try {
        const snap = step();
        if (snap) {
          State.setSnapshot(snap);
          processSnapshot(snap);
        }
      } catch (e) {
        console.error("step() error:", e);
        updateStatus("ERROR");
      }
    });
  }

  // RUN
  if (runBtn) {
    runBtn.addEventListener("click", () => {
      if (!engineReady || engineLoopId) return;
      const interval = Math.max(10, Math.round(ENGINE_BASE_INTERVAL_MS / Math.max(0.001, speedMultiplier)));
      engineLoopId = setInterval(() => {
        try {
          const snap = step();
          if (snap) {
            State.setSnapshot(snap);
            processSnapshot(snap);
          }
        } catch (e) {
          console.error("Engine step error:", e);
          updateStatus("ERROR");
          clearInterval(engineLoopId);
          engineLoopId = null;
        }
      }, interval);
      updateStatus("RUNNING");
    });
  }

  // PAUSE
  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => {
      if (!engineLoopId) return;
      clearInterval(engineLoopId);
      engineLoopId = null;
      updateStatus("PAUSED");
    });
  }

  // SPEED
  if (speedSelect) {
    speedSelect.addEventListener("change", (e) => {
      speedMultiplier = parseFloat(e.target.value) || 1;
      if (engineLoopId) {
        clearInterval(engineLoopId);
        engineLoopId = null;
        runBtn?.click();
      }
    });
  }

  // MANUAL MEASURE
  if (manualMeasureBtn) {
    manualMeasureBtn.addEventListener("click", () => {
      if (!engineReady) return;

      const mode = multimeterModeEl ? multimeterModeEl.value : "voltage";
      const targetType = multimeterTargetTypeEl ? multimeterTargetTypeEl.value : "rail";
      const rail = multimeterRailEl ? multimeterRailEl.value : "vbat";
      const component = multimeterComponentEl ? multimeterComponentEl.value : "tp_vbat";
      if (targetType === "component") {
        setSelectedBoardComponent(component);
      }
      const label = buildMultimeterLabel(mode, targetType, rail, component);

      const reading = measureTool(label);
      renderMultimeterResult(multimeterResultEl, mode, Number(reading));

      const snap = snapshot();
      if (snap) {
        State.setSnapshot(snap);
        processSnapshot(snap);
      }
    });
  }

  // PSU APPLY
  if (psuApplyBtn) {
    psuApplyBtn.addEventListener("click", () => {
      if (!engineReady) return;

      const voltage = Number(psuVoltageEl ? psuVoltageEl.value : 4.2);
      const currentLimit = Number(psuCurrentLimitEl ? psuCurrentLimitEl.value : 2.0);
      const enabled = psuEnableEl ? !!psuEnableEl.checked : true;

      const ok = applyPsuConfig({
        voltage: Number.isFinite(voltage) ? voltage : 4.2,
        currentLimit: Number.isFinite(currentLimit) ? currentLimit : 2.0,
        enabled,
      });

      if (!ok) return;

      const snap = snapshot();
      if (snap) {
        State.setSnapshot(snap);
        processSnapshot(snap);
      }
    });
  }

  // TIMELINE SCRUBBER
  if (timelineScrubber) {
    timelineScrubber.addEventListener("input", () => {
      const length = diagnosticHistory.length;
      if (length === 0) {
        if (diagnosticLog) diagnosticLog.textContent = "No diagnostic history.";
        return;
      }
      const ratio = (timelineScrubber.value || 0) / 100;
      const index = Math.floor(ratio * (length - 1));
      const safeIndex = Math.max(0, Math.min(length - 1, index));
      if (diagnosticLog) diagnosticLog.textContent = JSON.stringify(diagnosticHistory[safeIndex], null, 2);
    });
  }

  // SCENARIO
  if (scenarioSelect) {
    scenarioSelect.addEventListener("change", (e) => {
      currentScenario = e.target.value;
      if (scenarioNameEl) scenarioNameEl.textContent = currentScenario;
      Object.keys(voltageHistory).forEach(k => voltageHistory[k] = []);
      Object.keys(voltageSmoothed).forEach(k => voltageSmoothed[k] = []);
      Object.keys(thermalHistory).forEach(k => thermalHistory[k] = []);
      Object.keys(thermalSmoothed).forEach(k => thermalSmoothed[k] = []);
      distressHistory.length = 0;
      diagnosticHistory.length = 0;
      markDirty();
    });
  }

  // EXPORT
  if (exportReportBtn) {
    exportReportBtn.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(diagnosticHistory, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "diagnostic_report.json";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  initPcbViewerPanel({ mountSelector: "body" });
});

/* =========================
   RAIL TOGGLE UI
========================= */
function createRailToggle(name) {
  if (!railTogglePanel) return;
  if (railTogglePanel.querySelector(`[data-rail="${CSS.escape(name)}"]`)) return;

  const wrapper = document.createElement("label");
  wrapper.style.marginRight = "10px";
  wrapper.setAttribute("data-rail", name);

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = !!railVisibility[name];
  checkbox.onchange = () => { railVisibility[name] = checkbox.checked; markDirty(); };

  wrapper.appendChild(checkbox);
  wrapper.appendChild(document.createTextNode(" " + name));
  railTogglePanel.appendChild(wrapper);
}

/* =========================
   STATUS helper
========================= */
function updateStatus(state) {
  if (!statusEl) return;
  statusEl.textContent = state;
  if (state === "RUNNING") statusEl.style.color = "green";
  else if (state === "ERROR") statusEl.style.color = "orange";
  else statusEl.style.color = "red";
}

/* initial dirty draw */
markDirty();
