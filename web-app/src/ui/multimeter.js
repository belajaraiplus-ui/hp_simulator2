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

  // Engine adapter kamu expect format label seperti ini:
  // - "diode vbat"
  // - "ohm vbat"
  // - "voltage comp:U1201" dst
  if (targetType === "component") {
    if (mode === "diode") return `diode comp:${normalizedComponent}`;
    if (mode === "ohm") return `ohm comp:${normalizedComponent}`;
    if (mode === "continuity") return `continuity comp:${normalizedComponent}`;
    return `voltage comp:${normalizedComponent}`;
  }

  if (mode === "diode") return `diode ${normalizedRail}`;
  if (mode === "ohm") return `ohm ${normalizedRail}`;
  if (mode === "continuity") return `continuity ${normalizedRail}`;
  return normalizedRail; // default voltage rail
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
    if (value >= 1.0e8) multimeterResultEl.textContent = "OL";
    else multimeterResultEl.textContent = formatNumber(value, 2);
    return;
  }

  // voltage default
  multimeterResultEl.textContent = formatNumber(value, 3);
}
