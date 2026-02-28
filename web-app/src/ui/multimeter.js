import { formatNumber } from "../utils.js";

function normalizeMode(mode) {
  // HTML kamu pakai value="resistance"
  if (mode === "resistance") return "ohm";
  return mode;
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

export function renderMultimeterResult(multimeterResultEl, mode, value) {
  if (!multimeterResultEl) return;
  mode = normalizeMode(mode);

  if (!Number.isFinite(value)) {
    // UI kamu sudah punya label "READING"
    multimeterResultEl.textContent = "--";
    return;
  }

  if (mode === "diode") {
    multimeterResultEl.textContent = formatNumber(value, 3);
    return;
  }

  if (mode === "ohm") {
    if (value >= 1.0e8) multimeterResultEl.textContent = "OL";
    else multimeterResultEl.textContent = formatNumber(value, 2);
    return;
  }

  if (mode === "continuity") {
    if (value >= 1.0e8) {
      multimeterResultEl.textContent = "OL";
    } else if (value <= 50) {
      multimeterResultEl.textContent = formatNumber(value, 2) + " Ω BEEP";
    } else {
      multimeterResultEl.textContent = formatNumber(value, 2);
    }
    return;
  }

  if (mode === "current") {
    if (!Number.isFinite(value) || value < 0) {
      multimeterResultEl.textContent = "OL";
    } else {
      multimeterResultEl.textContent = formatNumber(value, 4) + " A";
    }
    return;
  }

  if (mode === "temperature") {
    multimeterResultEl.textContent = formatNumber(value, 1) + " °C";
    return;
  }

  // voltage default
  multimeterResultEl.textContent = formatNumber(value, 3);
}
