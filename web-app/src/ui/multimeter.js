import { formatNumber } from "../utils.js";

export function buildMultimeterLabel(mode, targetType, rail, component) {
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

export function renderMultimeterResult(multimeterResultEl, mode, value) {
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
