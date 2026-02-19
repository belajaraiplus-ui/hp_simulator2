// src/main.js
import { applyPsuConfig, bootEngine, measureTool, snapshot, step } from "./engine/adapter.js";
import { initPcbViewerPanel } from "./pcb_viewer/panel.js";
import { MAX_POINTS, TARGET_FPS, ENGINE_BASE_INTERVAL_MS } from "./config.js";
import { clamp01, toNumber, trim, lastValue, formatNumber, debounce } from "./utils.js";
import {
  State,
  voltageHistory, voltageSmoothed,
  thermalHistory, thermalSmoothed,
  distressHistory, diagnosticHistory,
  railVisibility,
  setSelectedBoardComponent,
  smoothingAlpha,
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
import { buildMultimeterLabel, renderMultimeterResult } from "./ui/multimeter.js";

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
const multimeterComponentEl = document.getElementById("multimeterComponent");
const multimeterResultEl = document.getElementById("multimeterResult");
const boardProfileLabelEl = document.getElementById("boardProfileLabel");

const psuEnableEl = document.getElementById("psuEnable");
const psuVoltageEl = document.getElementById("psuVoltage");
const psuCurrentLimitEl = document.getElementById("psuCurrentLimit");
const psuApplyBtn = document.getElementById("psuApply");
const psuStatusEl = document.getElementById("psuStatus");
const psuCurrentEl = document.getElementById("psuMeasuredCurrent");

const diagnosticText = document.getElementById("diagnosticText");
const diagnosticConfidence = document.getElementById("diagnosticConfidence");
const railTogglePanel = document.getElementById("railTogglePanel");

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

  // show raw snapshot for debugging
  if (out) out.textContent = JSON.stringify(snap, null, 2);

  // PSU panel
  renderPowerInput(snap.power_input);

  // distress history
  const distress = clamp01(snap.distress ?? 0);
  distressHistory.push(distress);
  trim(distressHistory, MAX_POINTS);

  // rails
  const rails = Array.isArray(snap.rails) ? snap.rails : [];
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

  handleResize();
  window.addEventListener("resize", debounce(handleResize, 100));

  // 1) BOOT ENGINE
  (async () => {
    try {
      const first = await bootEngine();
      engineReady = true;
      State.setSnapshot(first);
      processSnapshot(first);
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
  try {
    initPcbViewerPanel({
      mountSelector: "#motherboardMap",
      onBoardReady: ({ board, components }) => {
        console.log("📡 Board loaded:", board?.id);

        if (boardProfileLabelEl) {
          boardProfileLabelEl.textContent = board?.name || board?.id || "Board Loaded";
        }

        // Fill multimeter component dropdown
        if (multimeterComponentEl && Array.isArray(components)) {
          multimeterComponentEl.innerHTML = components
            .map(c => `<option value="${c.id}">${c.id} (${c.name || "Component"})</option>`)
            .join("");
        }
      }
    });
  } catch (e) {
    console.error("PCB Viewer init failed:", e);
    if (out) out.textContent = `PCB VIEWER ERROR:\n${String(e?.stack || e)}`;
  }

  // Multimeter UI Logic: Enable/Disable inputs based on target type
  if (multimeterTargetTypeEl) {
    multimeterTargetTypeEl.addEventListener("change", () => {
      const isComponent = multimeterTargetTypeEl.value === "component";
      if (multimeterComponentEl) multimeterComponentEl.disabled = !isComponent;
      if (multimeterRailEl) multimeterRailEl.disabled = isComponent;
    });
    // Initialize UI state
    multimeterTargetTypeEl.dispatchEvent(new Event("change"));
  }

  /* =========================
     UI EVENT LISTENERS
     ========================= */

  // PSU Apply
  if (psuApplyBtn) {
    psuApplyBtn.onclick = () => {
      if (!engineReady) {
        console.warn("Engine not ready. Please wait for boot.");
        return;
      }
      applyPsuConfig({
        voltage: parseFloat(psuVoltageEl.value) || 4.2,
        currentLimit: parseFloat(psuCurrentLimitEl.value) || 2.0,
        enabled: !!psuEnableEl.checked,
      });
      const snap = snapshot();
      processSnapshot(snap);
    };
  }

  // Multimeter Measure
  if (manualMeasureBtn) {
    manualMeasureBtn.onclick = () => {
      if (!engineReady) {
        console.warn("Engine not ready. Please wait for boot.");
        return;
      }

      const label = buildMultimeterLabel(
        multimeterModeEl.value,
        multimeterTargetTypeEl.value,
        multimeterRailEl.value,
        multimeterComponentEl.value
      );

      if (multimeterTargetTypeEl.value === "component") {
        setSelectedBoardComponent(multimeterComponentEl.value);
      }

      const val = measureTool(label);
      renderMultimeterResult(multimeterResultEl, multimeterModeEl.value, Number(val));
    };
  }

  // STEP
  if (stepBtn) {
    stepBtn.onclick = () => {
      if (!engineReady) {
        console.warn("Engine not ready. Please wait for boot.");
        return;
      }
      const snap = step();
      if (snap) processSnapshot(snap);
      updateStatus("PAUSED");
    };
  }

  // RUN / PAUSE (speed aware)
  function currentIntervalMs() {
    const speed = Number(speedSelect?.value || 1);
    const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
    return Math.max(10, Math.round(ENGINE_BASE_INTERVAL_MS / s));
  }

  if (runBtn) {
    runBtn.onclick = () => {
      if (!engineReady) {
        console.warn("Engine not ready. Please wait for boot.");
        return;
      }
      if (engineLoopId) return;
      engineLoopId = setInterval(() => {
        const snap = step();
        if (snap) processSnapshot(snap);
      }, currentIntervalMs());
      updateStatus("RUNNING");
    };
  }

  if (pauseBtn) {
    pauseBtn.onclick = () => {
      if (engineLoopId) clearInterval(engineLoopId);
      engineLoopId = null;
      updateStatus("PAUSED");
    };
  }

  if (speedSelect) {
    speedSelect.onchange = () => {
      // if running, restart interval at new speed
      if (!engineLoopId) return;
      clearInterval(engineLoopId);
      engineLoopId = setInterval(() => {
        const snap = step();
        if (snap) processSnapshot(snap);
      }, currentIntervalMs());
    };
  }

  // RESET
  if (resetBtn) resetBtn.onclick = () => window.location.reload();
