import { formatNumber } from "../utils.js";

let audioContext = null;

export function normalizeMode(mode) {
  const value = String(mode || "").trim().toLowerCase();
  if (value === "resistance") return "ohm";
  return value || "voltage";
}

export function buildMultimeterLabel(mode, targetType, rail, component) {
  mode = normalizeMode(mode);

  const normalizedRail = (rail || "vbat").toLowerCase();
  const normalizedComponent = (component || "tp_vbat").toLowerCase();

  if (targetType === "component") {
    if (mode === "diode") return `diode comp:${normalizedComponent}`;
    if (mode === "ohm") return `ohm comp:${normalizedComponent}`;
    if (mode === "continuity") return `continuity comp:${normalizedComponent}`;
    if (mode === "current") return `current comp:${normalizedComponent}`;
    if (mode === "temperature") return `temperature comp:${normalizedComponent}`;
    return `voltage comp:${normalizedComponent}`;
  }

  if (mode === "diode") return `diode ${normalizedRail}`;
  if (mode === "ohm") return `ohm ${normalizedRail}`;
  if (mode === "continuity") return `continuity ${normalizedRail}`;
  if (mode === "current") return `current ${normalizedRail}`;
  if (mode === "temperature") return `temperature ${normalizedRail}`;
  return normalizedRail;
}

function defaultDisplay(mode, value) {
  if (!Number.isFinite(value)) return "--";

  if (mode === "diode") return `${formatNumber(value, 3)} V`;
  if (mode === "ohm") {
    if (value >= 1.0e8) return "OL";
    if (value >= 1.0e6) return `${formatNumber(value / 1.0e6, 2)} MOhm`;
    if (value >= 1.0e3) return `${formatNumber(value / 1.0e3, 2)} kOhm`;
    return `${formatNumber(value, 2)} Ohm`;
  }
  if (mode === "continuity") return value > 0 ? "Continuity: YES" : "Continuity: NO";
  if (mode === "current") return `${formatNumber(value, 4)} A`;
  if (mode === "temperature") return `${formatNumber(value, 1)} C`;
  return `${formatNumber(value, 3)} V`;
}

export function renderMultimeterResult(multimeterResultEl, modeOrResult, value) {
  if (!multimeterResultEl) return;

  if (modeOrResult && typeof modeOrResult === "object") {
    multimeterResultEl.textContent = modeOrResult.displayValue || "--";
    return;
  }

  const mode = normalizeMode(modeOrResult);
  multimeterResultEl.textContent = defaultDisplay(mode, value);
}

export function renderMultimeterPanel(elements, result) {
  const {
    resultEl,
    modeEl,
    targetEl,
    statusEl,
    helpEl,
  } = elements || {};

  renderMultimeterResult(resultEl, result);

  if (modeEl) {
    modeEl.textContent = result?.mode ? String(result.mode).toUpperCase() : "--";
  }
  if (targetEl) {
    targetEl.textContent = result?.targetLabel || "None";
  }
  if (statusEl) {
    statusEl.textContent = result?.summary || "Select a measurable point on the board.";
    statusEl.dataset.status = result?.status || "idle";
  }
  if (helpEl) {
    helpEl.textContent = result?.helpText || "Voltage, ohm, diode, and continuity results will appear here.";
  }
}

export function createMultimeterUiState() {
  return {
    mode: "voltage",
    targetLabel: "None",
    displayValue: "--",
    status: "idle",
    helpText: "Place the red and black probes on measurable points on the board.",
    summary: "Mode: voltage | Target: None | Result: --",
  };
}

export async function playContinuityBeep() {
  if (typeof window === "undefined") return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  try {
    if (!audioContext) audioContext = new AudioCtx();
    if (audioContext.state === "suspended") await audioContext.resume();

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = 1760;
    gainNode.gain.value = 0.04;

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    const now = audioContext.currentTime;
    oscillator.start(now);
    oscillator.stop(now + 0.08);
  } catch (error) {
    console.debug("Continuity beep unavailable", error);
  }
}
