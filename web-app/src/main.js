// src/main.js
import { applyPsuConfig, bootEngine, measureTool, snapshot, step } from "./engine/adapter.js";
import { initPcbViewerPanel } from "./pcb_viewer/panel.js";
import { MAX_POINTS, TARGET_FPS, ENGINE_BASE_INTERVAL_MS } from "./config.js";
import { clamp01, toNumber, trim, lastValue, formatNumber, debounce } from "./utils.js";
import {
  State, voltageHistory, voltageSmoothed, thermalHistory, thermalSmoothed,
  distressHistory, diagnosticHistory, railVisibility,
  setSelectedBoardComponent, smoothingAlpha, setSmoothingAlpha, resmoothAll
} from "./state.js";
import { computeDiagnostic, analyzeDistressTrend } from "./analysis.js";
import { createOffscreenCanvas, resizeCanvasToDisplaySize, syncOffscreen, drawVoltageChart, drawThermalChart, drawDistressChart } from "./ui/charts.js";
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

const smoothingSliderEl = document.getElementById("smoothingSlider");
const smoothingValueEl = document.getElementById("smoothingValue");

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
   CORE SIMULATION PROCESSOR
   ========================================================== */
function processSnapshot(snap) {
  if (!snap) return;
  if (out) out.textContent = JSON.stringify(snap, null, 2);
  
  renderPowerInput(snap.power_input);

  // Update Distress History
  const distress = clamp01(snap.distress ?? 0);
  distressHistory.push(distress);
  trim(distressHistory, MAX_POINTS);

  // Process Rails
  const rails = Array.isArray(snap.rails) ? snap.rails : [];
  rails.forEach((r, idx) => {
    const name = r?.name ?? `rail_${idx}`;
    const raw = toNumber(r?.voltage);
    if (!voltageHistory[name]) {
      voltageHistory[name] = [];
      voltageSmoothed[name] = [];
      railVisibility[name] = true;
      createRailToggle(name);
    }
    voltageHistory[name].push(raw);
    trim(voltageHistory[name], MAX_POINTS);
    
    const prev = lastValue(voltageSmoothed[name]);
    const next = raw == null ? prev : (prev == null ? raw : (smoothingAlpha * raw + (1 - smoothingAlpha) * prev));
    voltageSmoothed[name].push(next);
    trim(voltageSmoothed[name], MAX_POINTS);
  });

  // Process Thermals
  const thermals = Array.isArray(snap.thermals) ? snap.thermals : [];
  thermals.forEach((z, idx) => {
    const name = z?.zone ?? `zone_${idx}`;
    const raw = toNumber(z?.temperature);
    if (!thermalHistory[name]) {
      thermalHistory[name] = [];
      thermalSmoothed[name] = [];
    }
    thermalHistory[name].push(raw);
    const prev = lastValue(thermalSmoothed[name]);
    const next = raw == null ? prev : (prev == null ? raw : (smoothingAlpha * raw + (1 - smoothingAlpha) * prev));
    thermalSmoothed[name].push(next);
  });

  const diag = computeDiagnostic({ rails, thermals, distress, time: snap.time ?? Date.now() });
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
   APP STARTUP (DOMContentLoaded)
   ========================================================== */
let engineLoopId = null;
let engineReady = false;

document.addEventListener("DOMContentLoaded", () => {
  handleResize();
  window.addEventListener("resize", debounce(handleResize, 100));

  // 1. BOOT SIMULATION ENGINE (WASM)
  async function initApp() {
    try {
      const snap = await bootEngine();
      engineReady = true;
      State.setSnapshot(snap);
      processSnapshot(snap);
      updateStatus("PAUSED");
      requestAnimationFrame(renderLoop);
      console.log("🚀 Engine & Charts Initialized");
    } catch (e) {
      console.error("Critical Start Failure:", e);
      updateStatus("ERROR");
    }
  }
  initApp();

  // 2. INITIALIZE PCB VIEWER PANEL (OpenSeadragon)
  initPcbViewerPanel({ 
    mountSelector: "#motherboardMap", // Pastikan ID ini ada di index.html Anda
    onBoardReady: ({ board, components }) => {
        console.log("📡 New Board Data Loaded:", board.id);
        
        // Sync Dashboard UI
        if (boardProfileLabelEl) boardProfileLabelEl.textContent = board.name;
        
        // Populate Multimeter Dropdown with actual components from JSON
        if (multimeterComponentEl) {
            multimeterComponentEl.innerHTML = components.map(c => 
                `<option value="${c.id}">${c.id} (${c.name || 'Component'})</option>`
            ).join("");
        }
    }
  });

  /* ==========================================================
     UI EVENT LISTENERS
     ========================================================== */
  
  // PSU Apply
  if (psuApplyBtn) {
    psuApplyBtn.onclick = () => {
      if (!engineReady) return;
      applyPsuConfig({
        voltage: parseFloat(psuVoltageEl.value) || 4.2,
        currentLimit: parseFloat(psuCurrentLimitEl.value) || 2.0,
        enabled: psuEnableEl.checked
      });
      const snap = snapshot();
      processSnapshot(snap);
    };
  }

  // Multimeter Measure
  if (manualMeasureBtn) {
    manualMeasureBtn.onclick = () => {
      if (!engineReady) return;
      const label = buildMultimeterLabel(
        multimeterModeEl.value, 
        multimeterTargetTypeEl.value, 
        multimeterRailEl.value, 
        multimeterComponentEl.value
      );
      if (multimeterTargetTypeEl.value === "component") setSelectedBoardComponent(multimeterComponentEl.value);
      const val = measureTool(label);
      renderMultimeterResult(multimeterResultEl, multimeterModeEl.value, Number(val));
    };
  }

  // Simulation Controls
  if (runBtn) runBtn.onclick = () => {
    if (!engineReady || engineLoopId) return;
    engineLoopId = setInterval(() => {
      const snap = step();
      if (snap) processSnapshot(snap);
    }, ENGINE_BASE_INTERVAL_MS);
    updateStatus("RUNNING");
  };

  if (pauseBtn) pauseBtn.onclick = () => {
    clearInterval(engineLoopId);
    engineLoopId = null;
    updateStatus("PAUSED");
  };

  if (resetBtn) resetBtn.onclick = () => window.location.reload();
});

/* ==========================================================
   HELPERS (UI Sync)
   ========================================================== */
function renderPowerInput(pi) {
  if (!pi || !psuStatusEl) return;
  psuStatusEl.textContent = pi.enabled ? `ON: ${pi.voltage}V` : "OFF";
  if (psuCurrentEl) psuCurrentEl.textContent = `I: ${formatNumber(pi.measured_current, 3)}A`;
}

function updateStatus(msg) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.style.color = msg === "RUNNING" ? "#4ec9b0" : "#f44747";
}

function createRailToggle(name) {
  if (!railTogglePanel) return;
  const label = document.createElement("label");
  label.innerHTML = `<input type="checkbox" checked> ${name}`;
  label.querySelector("input").onchange = (e) => {
    railVisibility[name] = e.target.checked;
    markDirty();
  };
  railTogglePanel.appendChild(label);
}

function updatePanelsFromLatestDiagnostic() {
    const diag = diagnosticHistory[diagnosticHistory.length - 1];
    if (!diag || !diagnosticText) return;
    diagnosticText.textContent = diag.message;
    if (distressFill) {
        const pct = (snap?.distress || 0) * 100;
        distressFill.style.width = pct + "%";
    }
}