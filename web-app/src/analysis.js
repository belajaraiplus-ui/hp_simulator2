import { voltageSmoothed, thermalSmoothed, distressHistory } from "./state.js";

export function computeDiagnostic({ rails = [], thermals = [], distress = 0, time = 0 }) {
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

export function analyzeDistressTrend() {
  if (distressHistory.length < 6) return "stable";
  const recent = distressHistory.slice(-6);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (last - first > 0.05) return "rising";
  if (first - last > 0.05) return "falling";
  return "stable";
}