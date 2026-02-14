// src/main.js
import { applyPsuConfig, bootEngine, measureTool, snapshot, step } from "./engine/adapter.js";

/*
  Production-ready UI controller for HP Repair Simulator – Proxy Dashboard.
  - Reactive state (subscribe)
  - Engine stepping separated from rendering
  - rAF render loop (throttled)
  - Offscreen canvas drawing + blit
  - Auto-resize responsive canvases with devicePixelRatio
  - EMA smoothing (anti-jitter) with runtime slider
  - Scales computed only from visible series
  - Efficient drawing for many rails (>30)
*/

/* =========================
   CONFIG
========================= */
const MAX_POINTS = 300;
const TARGET_FPS = 30;
// smoothingAlpha is now runtime-adjustable via slider (default 0.18)
let smoothingAlpha = 0.18;
const ENGINE_BASE_INTERVAL_MS = 200;
const COLOR_CACHE = {};

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
function createOffscreenCanvas(el) {
  if (!el) return null;
  const off = document.createElement("canvas");
  off.style.display = "none";
  document.body.appendChild(off);
  return off;
}

const voltageOffscreen = createOffscreenCanvas(voltageCanvas);
const thermalOffscreen = createOffscreenCanvas(thermalCanvas);
const distressOffscreen = createOffscreenCanvas(distressCanvas);

/* =========================
   STATE (reactive)
========================= */
const State = (() => {
  let data = { lastSnapshot: null };
  const listeners = new Set();
  return {
    get: () => data,
    setSnapshot: (snap) => {
      data.lastSnapshot = snap;
      listeners.forEach(fn => { try { fn(snap); } catch (e) { console.error(e); } });
    },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }
  };
})();

/* =========================
   HISTORIES & VISIBILITY
========================= */
const voltageHistory = {};
const voltageSmoothed = {};
const thermalHistory = {};
const thermalSmoothed = {};
const distressHistory = [];
const diagnosticHistory = [];
const railVisibility = {};
let selectedBoardComponent = null;

/* =========================
   UTILS
========================= */
function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
function toNumber(v) {
  return (typeof v === "number" && Number.isFinite(v)) ? v : null;
}
function trim(arr) { while (arr.length > MAX_POINTS) arr.shift(); }
function lastValue(arr) { return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null; }

function formatNumber(value, digits = 3) {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(digits);
}

const BOARD_LAYOUT = {
  // Area Baterai (Pojok Kanan Bawah)
  j_vbat_main:   { x: 85, y: 75, region: "BATT_CONN" },
  c_vbat_in:     { x: 75, y: 75, region: "BATT_CONN" },
  r_vbat_sense:  { x: 65, y: 75, region: "BATT_CONN" },
  tp_vbat:       { x: 65, y: 85, region: "BATT_CONN" },

  // Area PMIC (Tengah Kiri - Tertutup Shield)
  j_vcore_phase: { x: 35, y: 45, region: "PMIC_SHIELD" },
  c_vcore_out:   { x: 25, y: 45, region: "PMIC_SHIELD" },
  r_vcore_fb:    { x: 25, y: 55, region: "PMIC_SHIELD" },
  tp_vcore:      { x: 15, y: 45, region: "PMIC_SHIELD" },

  // Area Logic/IO (Atas)
  tp_vio:        { x: 45, y: 25, region: "LOGIC_SHIELD" },
};

function syncMultimeterTargetUi() {
  const useComponent = multimeterTargetTypeEl && multimeterTargetTypeEl.value === "component";
  if (multimeterRailEl) {
    multimeterRailEl.disabled = !!useComponent;
  }
  if (multimeterComponentEl) {
    multimeterComponentEl.disabled = !useComponent;
  }
}

function componentLayoutFor(index, componentId) {
  const direct = BOARD_LAYOUT[componentId];
  if (direct) return direct;

  const col = index % 4;
  const row = Math.floor(index / 4);
  return {
    x: 12 + col * 21,
    y: 18 + row * 18,
    region: "Aux",
  };
}

function componentCatalogFallbackFromUi() {
  if (!multimeterComponentEl) return [];
  const list = [];
  for (const opt of multimeterComponentEl.options) {
    const id = (opt.value || "").toLowerCase();
    if (!id) continue;
    list.push({
      id,
      label: opt.textContent || id,
      rail: "Unknown",
    });
  }
  return list;
}

function renderMotherboardMap(snapshot) {
  if (!motherboardMapEl) return;
  const profile = snapshot && snapshot.board_profile ? snapshot.board_profile : null;
  const snapshotCatalog = snapshot && Array.isArray(snapshot.component_catalog)
    ? snapshot.component_catalog
    : [];
  const catalog = snapshotCatalog.length ? snapshotCatalog : componentCatalogFallbackFromUi();

  if (boardProfileLabelEl) {
    boardProfileLabelEl.textContent = profile
      ? `Board: ${profile.display_name}`
      : "Board: Generic Service Board";
  }

  motherboardMapEl.innerHTML = "";
  if (!catalog.length) {
    const empty = document.createElement("div");
    empty.className = "small";
    empty.style.padding = "10px";
    empty.textContent = "No component catalog available.";
    motherboardMapEl.appendChild(empty);
    return;
  }

  const seenRegions = new Set();
  catalog.forEach((item, index) => {
    const layout = componentLayoutFor(index, item.id);
    if (layout.region && !seenRegions.has(layout.region)) {
      seenRegions.add(layout.region);
      const regionEl = document.createElement("div");
      regionEl.className = "board-region";
      regionEl.textContent = layout.region;
      regionEl.style.left = `${Math.max(2, layout.x - 12)}%`;
      regionEl.style.top = `${Math.max(2, layout.y - 10)}%`;
      motherboardMapEl.appendChild(regionEl);
    }

    const node = document.createElement("button");
    node.type = "button";
    node.className = "board-node";

    // Tentukan kelas visual berdasarkan ID komponen
    const idLower = item.id.toLowerCase();
    if (idLower.startsWith("c_")) node.classList.add("comp-c");
    else if (idLower.startsWith("r_")) node.classList.add("comp-r");
    else if (idLower.startsWith("tp_")) node.classList.add("comp-tp");
    else if (idLower.startsWith("j_") || idLower.startsWith("l_")) node.classList.add("comp-j");
    else node.classList.add("comp-j"); // default

    if (selectedBoardComponent === item.id) {
      node.classList.add("active");
    }
    node.style.left = `${layout.x}%`;
    node.style.top = `${layout.y}%`;
    
    // Label disimpan di atribut data untuk tooltip CSS
    node.setAttribute("data-label", item.label || item.id);
    // Text content dikosongkan untuk komponen kecil agar terlihat realistis
    if (!node.classList.contains("comp-j")) node.textContent = "";
    else node.textContent = (item.label || item.id).substring(0,1); // Inisial untuk konektor

    node.addEventListener("click", () => {
      selectedBoardComponent = item.id;
      if (multimeterTargetTypeEl) {
        multimeterTargetTypeEl.value = "component";
        multimeterTargetTypeEl.dispatchEvent(new Event("change"));
      }
      if (multimeterComponentEl) {
        multimeterComponentEl.value = item.id;
      }
      renderMotherboardMap(snapshot);
    });
    motherboardMapEl.appendChild(node);
  });
}

function buildMultimeterLabel(mode, targetType, rail, component) {
  const normalizedRail = (rail || "vbat").toLowerCase();
  const normalizedComponent = (component || "tp_vbat").toLowerCase();

  if (targetType === "component") {
    if (mode === "diode") return `diode comp:${normalizedComponent}`;
    if (mode === "ohm") return `ohm comp:${normalizedComponent}`;
    if (mode === "continuity") return `continuity comp:${normalizedComponent}`;
    return `voltage comp:${normalizedComponent}`;
  }

  if (mode === "diode") return `diode ${normalizedRail}`;
  if (mode === "ohm") return `ohm ${normalizedRail}`;
  if (mode === "continuity") return `continuity ${normalizedRail}`;
  return normalizedRail;
}

function renderMultimeterResult(mode, value) {
  if (!multimeterResultEl) return;
  if (!Number.isFinite(value)) {
    multimeterResultEl.textContent = "Reading: --";
    return;
  }

  if (mode === "diode") {
    multimeterResultEl.textContent = `Reading: ${formatNumber(value, 3)} V`;
    return;
  }

  if (mode === "ohm") {
    if (value >= 1.0e8) {
      multimeterResultEl.textContent = "Reading: OL";
    } else {
      multimeterResultEl.textContent = `Reading: ${formatNumber(value, 2)} Ohm`;
    }
    return;
  }

  if (mode === "continuity") {
    const beep = value < 50.0;
    if (value >= 1.0e8) {
      multimeterResultEl.textContent = "Reading: OL (No Beep)";
    } else {
      multimeterResultEl.textContent =
        `Reading: ${formatNumber(value, 2)} Ohm (${beep ? "Beep" : "No Beep"})`;
    }
    return;
  }

  multimeterResultEl.textContent = `Reading: ${formatNumber(value, 3)} V`;
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

function hslForIndex(i, total) {
  const key = `${i}:${total}`;
  if (COLOR_CACHE[key]) return COLOR_CACHE[key];
  const hue = Math.round((i * (360 / Math.max(1, total))) % 360);
  const col = `hsl(${hue}deg 70% 55%)`;
  COLOR_CACHE[key] = col;
  return col;
}

/* =========================
   DPR-AWARE RESIZE
========================= */
function resizeCanvasToDisplaySize(canvas) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  const targetWidth = Math.round(cssWidth * dpr);
  const targetHeight = Math.round(cssHeight * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}
function syncOffscreen(off, visible) {
  if (!off || !visible) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = visible.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width));
  const cssH = Math.max(1, Math.round(rect.height));
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (off.width !== w || off.height !== h) {
    off.width = w;
    off.height = h;
    const ctx = off.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}
function debounce(fn, ms = 100) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
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
  renderMotherboardMap(snapshot);

  const distress = clamp01(snapshot.distress ?? 0);
  distressHistory.push(distress);
  trim(distressHistory);

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
    trim(voltageHistory[name]);

    const prev = lastValue(voltageSmoothed[name]);
    const next = raw == null ? prev : (prev == null ? raw : (smoothingAlpha * raw + (1 - smoothingAlpha) * prev));
    voltageSmoothed[name].push(next);
    trim(voltageSmoothed[name]);
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
    trim(thermalHistory[name]);

    const prev = lastValue(thermalSmoothed[name]);
    const next = raw == null ? prev : (prev == null ? raw : (smoothingAlpha * raw + (1 - smoothingAlpha) * prev));
    thermalSmoothed[name].push(next);
    trim(thermalSmoothed[name]);
  });

  const diag = computeDiagnostic({ rails, thermals, distress, time: snapshot.time ?? Date.now() });
  diagnosticHistory.push(diag);
  if (diagnosticHistory.length > 500) diagnosticHistory.shift();

  markDirty();
}

/* =========================
   RESMOOTH ALL (apply new smoothingAlpha to HISTORIES)
   -> called when slider changes to immediately reflect smoothing
========================= */
function resmoothAll() {
  // voltage
  Object.keys(voltageHistory).forEach(name => {
    const raw = voltageHistory[name] || [];
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      if (i === 0) {
        out.push(r == null ? null : r);
      } else {
        const prev = lastValue(out);
        const next = (r == null) ? prev : (prev == null ? r : (smoothingAlpha * r + (1 - smoothingAlpha) * prev));
        out.push(next);
      }
    }
    voltageSmoothed[name] = out;
    trim(voltageSmoothed[name]);
  });

  // thermal
  Object.keys(thermalHistory).forEach(name => {
    const raw = thermalHistory[name] || [];
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      if (i === 0) {
        out.push(r == null ? null : r);
      } else {
        const prev = lastValue(out);
        const next = (r == null) ? prev : (prev == null ? r : (smoothingAlpha * r + (1 - smoothingAlpha) * prev));
        out.push(next);
      }
    }
    thermalSmoothed[name] = out;
    trim(thermalSmoothed[name]);
  });

  markDirty();
}

/* =========================
   DIAGNOSTIC CORE (unchanged logic)
========================= */
function computeDiagnostic({ rails = [], thermals = [], distress = 0, time = 0 }) {
  const voltageIssues = detectVoltageIssuesFromSmoothed();
  const thermalIssues = detectThermalIssuesFromSmoothed();
  const distressTrend = analyzeDistressTrend();
  let score = 0;
  const messages = [];

  if (voltageIssues.length) { messages.push("Voltage instability: " + voltageIssues.join(", ")); score += 0.4; }
  if (thermalIssues.length) { messages.push("Thermal anomaly: " + thermalIssues.join(", ")); score += 0.3; }
  if (distressTrend === "rising") { messages.push("Distress trend increasing."); score += 0.2; }
  if (!messages.length) messages.push("System appears stable based on observable proxy.");

  const confidence = Math.min(1, score + distress * 0.4);
  return {
    timestamp: time,
    voltageIssues,
    thermalIssues,
    distressTrend,
    distress,
    confidence,
    message: messages.join(" ")
  };
}

function detectVoltageIssuesFromSmoothed() {
  const issues = [];
  Object.keys(voltageSmoothed).forEach(name => {
    const hist = voltageSmoothed[name].filter(v => v != null);
    if (hist.length < 6) return;
    const variance = computeVariance(hist);
    if (variance > 0.01) issues.push(name);
  });
  return issues;
}

function detectThermalIssuesFromSmoothed() {
  const issues = [];
  Object.keys(thermalSmoothed).forEach(zone => {
    const hist = thermalSmoothed[zone].filter(v => v != null);
    if (hist.length < 6) return;
    const mx = Math.max(...hist);
    if (mx > 85) issues.push(zone);
  });
  return issues;
}

function computeVariance(series) {
  const valid = series.filter(v => v != null);
  if (!valid.length) return 0;
  const mean = valid.reduce((s, x) => s + x, 0) / valid.length;
  return valid.reduce((sum, v) => sum + (v - mean) ** 2, 0) / valid.length;
}

function analyzeDistressTrend() {
  if (distressHistory.length < 6) return "stable";
  const recent = distressHistory.slice(-6);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (last - first > 0.05) return "rising";
  if (first - last > 0.05) return "falling";
  return "stable";
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
  drawVoltageChart();
  drawThermalChart();
  drawDistressChart();
}

/* DRAW helpers (unchanged) */
function drawVoltageChart() {
  if (!voltageCanvas || !voltageOffscreen) return;
  syncOffscreen(voltageOffscreen, voltageCanvas);
  const ctx = voltageOffscreen.getContext("2d");
  if (!ctx) return;

  const rect = voltageCanvas.getBoundingClientRect();
  const cssW = rect.width, cssH = rect.height;
  ctx.clearRect(0, 0, cssW, cssH);
  drawGridOnCtx(ctx, cssW, cssH);

  const names = Object.keys(voltageSmoothed).filter(n => railVisibility[n] !== false);
  const max = Math.max(5, getMaxFilteredSmoothed(voltageSmoothed, names), 0.0001);

  names.forEach((name, idx) => {
    const color = hslForIndex(idx, Math.max(6, names.length));
    drawSeriesOnCtx(ctx, voltageSmoothed[name], max, color, cssW, cssH);
  });

  const vctx = voltageCanvas.getContext("2d");
  if (vctx && voltageOffscreen) {
    vctx.clearRect(0, 0, voltageCanvas.width, voltageCanvas.height);
    vctx.drawImage(voltageOffscreen, 0, 0);
  }
}

function drawThermalChart() {
  if (!thermalCanvas || !thermalOffscreen) return;
  syncOffscreen(thermalOffscreen, thermalCanvas);
  const ctx = thermalOffscreen.getContext("2d");
  if (!ctx) return;

  const rect = thermalCanvas.getBoundingClientRect();
  const cssW = rect.width, cssH = rect.height;
  ctx.clearRect(0, 0, cssW, cssH);
  drawGridOnCtx(ctx, cssW, cssH);

  const names = Object.keys(thermalSmoothed);
  const max = Math.max(120, getMaxFilteredSmoothed(thermalSmoothed, names), 0.0001);

  names.forEach((name, idx) => {
    const color = hslForIndex(idx, Math.max(6, names.length));
    drawSeriesOnCtx(ctx, thermalSmoothed[name], max, color, cssW, cssH);
  });

  const vctx = thermalCanvas.getContext("2d");
  if (vctx && thermalOffscreen) {
    vctx.clearRect(0, 0, thermalCanvas.width, thermalCanvas.height);
    vctx.drawImage(thermalOffscreen, 0, 0);
  }
}

function drawDistressChart() {
  if (!distressCanvas || !distressOffscreen) return;
  syncOffscreen(distressOffscreen, distressCanvas);
  const ctx = distressOffscreen.getContext("2d");
  if (!ctx) return;

  const rect = distressCanvas.getBoundingClientRect();
  const cssW = rect.width, cssH = rect.height;
  ctx.clearRect(0, 0, cssW, cssH);
  drawGridOnCtx(ctx, cssW, cssH);

  drawSeriesOnCtx(ctx, distressHistory, 1, "#ff4c4c", cssW, cssH);

  const vctx = distressCanvas.getContext("2d");
  if (vctx && distressOffscreen) {
    vctx.clearRect(0, 0, distressCanvas.width, distressCanvas.height);
    vctx.drawImage(distressOffscreen, 0, 0);
  }
}

function drawGridOnCtx(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 1;
  const spacing = Math.max(12, Math.round(Math.min(width, height) / 12));
  for (let x = 0; x <= width; x += spacing) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, height); ctx.stroke();
  }
  for (let y = 0; y <= height; y += spacing) {
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); ctx.stroke();
  }
  ctx.restore();
}

function drawSeriesOnCtx(ctx, series, max, color, width, height) {
  if (!series || series.length === 0) return;
  const values = series;
  const len = Math.min(values.length, MAX_POINTS);
  const step = Math.max(1, values.length > MAX_POINTS ? (values.length / MAX_POINTS) : 1);

  ctx.save();
  ctx.beginPath();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  let started = false;

  for (let i = 0, drawn = 0; i < values.length && drawn < MAX_POINTS; i += step, drawn++) {
    const v = values[Math.floor(i)];
    if (v == null) { started = false; continue; }
    const x = (drawn / (MAX_POINTS - 1)) * width;
    const y = height - (v / max) * (height - 8);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }

  ctx.stroke();
  ctx.restore();
}

function getMaxFilteredSmoothed(map, allowedKeys) {
  let m = 0;
  allowedKeys.forEach(k => {
    (map[k] || []).forEach(v => { if (v != null && v > m) m = v; });
  });
  return m;
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
      smoothingAlpha = Math.max(0, Math.min(1, v));
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
        selectedBoardComponent = component;
      }
      const label = buildMultimeterLabel(mode, targetType, rail, component);

      const reading = measureTool(label);
      renderMultimeterResult(mode, Number(reading));

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
  if (multimeterTargetTypeEl) {
    multimeterTargetTypeEl.addEventListener("change", () => {
      syncMultimeterTargetUi();
    });
    syncMultimeterTargetUi();
  }

  if (multimeterComponentEl) {
    multimeterComponentEl.addEventListener("change", () => {
      selectedBoardComponent = multimeterComponentEl.value;
      renderMotherboardMap(State.get().lastSnapshot);
    });
  }
