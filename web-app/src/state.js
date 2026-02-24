import { MAX_POINTS } from "./config.js";
import { trim, lastValue } from "./utils.js";

export const State = (() => {
  let data = { lastSnapshot: null, scenario: null };
  const listeners = new Set();
  return {
    get: () => data,
    setSnapshot: (snap) => {
      data.lastSnapshot = snap;
      listeners.forEach(fn => { try { fn(snap); } catch (e) { console.error(e); } });
    },
    setScenario: (scenario) => {
      data.scenario = scenario;
      listeners.forEach(fn => { try { fn(null); } catch (e) { console.error(e); } });
    },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }
  };
})();

export const voltageHistory = {};
export const voltageSmoothed = {};
export const thermalHistory = {};
export const thermalSmoothed = {};
export const distressHistory = [];
export const diagnosticHistory = [];
export const railVisibility = {};

// Mutable state variables
export let selectedBoardComponent = null;
export function setSelectedBoardComponent(val) { selectedBoardComponent = val; }

export let smoothingAlpha = 0.18;
export function setSmoothingAlpha(val) { smoothingAlpha = val; }

export function resmoothAll() {
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
    trim(voltageSmoothed[name], MAX_POINTS);
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
    trim(thermalSmoothed[name], MAX_POINTS);
  });
}

export function resetBoardState() {
  Object.keys(voltageHistory).forEach(k => { voltageHistory[k] = []; voltageSmoothed[k] = []; });
  Object.keys(thermalHistory).forEach(k => { thermalHistory[k] = []; thermalSmoothed[k] = []; });
  distressHistory.length = 0;
  diagnosticHistory.length = 0;
  Object.keys(railVisibility).forEach(k => railVisibility[k] = true);
}