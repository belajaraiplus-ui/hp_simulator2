import type { PowerRuntime, RailFault, RailRuntime, SystemMode } from "./powerRuntime";

/**
 * Runtime power propagation (Step 9)
 * - Evaluasi rails berdasarkan depends_on (DAG) + state.default/enabled_by + fault injection
 * - Output runtime measurement: voltage + resistance + continuity (rail, single-ended)
 */

type RailDef = {
  id: string;
  depends_on?: string[];
  expected?: {
    voltage_v?: { min?: number; max?: number };
    r2g_ohms?: { nominal?: number };
    continuity?: { beep_below_ohms?: number; open_above_ohms?: number };
  };
  state?: { default?: SystemMode; enabled_by?: string[] };
};

type StaticState = {
  board_id: string;
  railsById: Record<string, RailDef>;
  topo: string[];
};

type BoardEntry = {
  static: StaticState;
  rt: PowerRuntime;
};

// -------------------- internal state --------------------
let _static: StaticState = {
  board_id: "",
  railsById: {},
  topo: [],
};

let _rt: PowerRuntime = {
  board_id: "",
  system_mode: "S0",
  faults: {},
  rails: {},
  topo_order: [],
};

const _boards = new Map<string, BoardEntry>();
let _activeBoardId: string | null = null;
const POWER_LS_PREFIX = "hpSim.power.";

// -------------------- helpers --------------------
function rankMode(m: SystemMode | string | undefined): number {
  return ({ OFF: 0, ALW: 1, SLEEP: 2, S0: 3 })[String(m || "OFF")] ?? 0;
}

function normalizeSystemMode(m: unknown, fallback: SystemMode): SystemMode {
  const s = String(m || "").toUpperCase();
  if (s === "ALW" || s === "S0" || s === "SLEEP" || s === "OFF") return s;
  return fallback;
}

function normalizeFaultType(t: unknown): RailFault["type"] | null {
  const s = String(t || "").trim().toLowerCase();
  if (s === "short") return "short";
  if (s === "open") return "open";
  if (s === "disable_regulator" || s === "disable-regulator") return "disable_regulator";
  return null;
}

function normalizeFault(fault: unknown): RailFault | null {
  if (!fault || typeof fault !== "object") return null;
  const f = fault as RailFault;
  const type = normalizeFaultType(f.type);
  if (!type) return null;
  const note = typeof f.note === "string" && f.note.trim() ? f.note.trim() : undefined;
  return note ? { type, note } : { type };
}

function cloneFaults(input: Record<string, RailFault | undefined>): Record<string, RailFault | undefined> {
  const out: Record<string, RailFault | undefined> = {};
  for (const [railId, fault] of Object.entries(input || {})) {
    const normalized = normalizeFault(fault);
    if (normalized) out[String(railId)] = normalized;
  }
  return out;
}

function isAllowedByMode(defaultState: SystemMode, systemMode: SystemMode): boolean {
  // OFF => none, ALW => minimal, SLEEP => ALW+SLEEP, S0 => all
  const d = rankMode(defaultState);
  const s = rankMode(systemMode);
  return d > 0 && d <= s;
}

function randBetween(min: number | undefined, max: number | undefined): number | null {
  const a = Number(min);
  const b = Number(max);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a === b) return a;
  return a + Math.random() * (b - a);
}

function jitter(v: number, frac = 0.005): number {
  if (!Number.isFinite(v)) return v;
  const amp = Math.max(0.001, Math.abs(v) * frac);
  return v + (Math.random() * 2 - 1) * amp;
}

function clampResistance(v: number): number {
  if (!Number.isFinite(v) || Number.isNaN(v)) return 1.0e9;
  return Math.max(0, Math.min(1.0e9, v));
}

function canUseLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function bindActiveEntry(entry: BoardEntry): void {
  _static = entry.static;
  _rt = entry.rt;
}

function getActiveEntry(): BoardEntry | null {
  if (!_activeBoardId) return null;
  const entry = _boards.get(_activeBoardId) || null;
  if (entry) bindActiveEntry(entry);
  return entry;
}

function storageKey(boardId: string): string {
  return `${POWER_LS_PREFIX}${boardId}`;
}

function loadPersistedState(board_id: string): void {
  const boardId = String(board_id || "").trim();
  if (!boardId || !canUseLocalStorage()) return;

  const entry = _boards.get(boardId);
  if (!entry) return;

  try {
    const raw = window.localStorage.getItem(storageKey(boardId));
    if (!raw) return;

    const parsed = JSON.parse(raw);
    entry.rt.system_mode = normalizeSystemMode(parsed?.system_mode, entry.rt.system_mode);

    const persistedFaults = cloneFaults(parsed?.faults || {});
    const filteredFaults: Record<string, RailFault | undefined> = {};
    for (const [railId, fault] of Object.entries(persistedFaults)) {
      if (!entry.static.railsById[railId]) continue;
      filteredFaults[railId] = fault;
    }
    entry.rt.faults = filteredFaults;
  } catch (e) {
    console.warn("loadPersistedState failed:", e);
  }
}

function persistState(board_id: string): void {
  const boardId = String(board_id || "").trim();
  if (!boardId || !canUseLocalStorage()) return;

  const entry = _boards.get(boardId);
  if (!entry) return;

  const payload = {
    system_mode: normalizeSystemMode(entry.rt.system_mode, "S0"),
    faults: cloneFaults(entry.rt.faults),
  };

  try {
    window.localStorage.setItem(storageKey(boardId), JSON.stringify(payload));
  } catch (e) {
    console.warn("persistState failed:", e);
  }
}

function dependsOf(railDef: RailDef): string[] {
  // kontrak di data: depends_on: ["VBAT", ...]
  const d = railDef?.depends_on;
  return Array.isArray(d) ? d : [];
}

function enabledByOf(railDef: RailDef): string[] {
  const eb = railDef?.state?.enabled_by;
  return Array.isArray(eb) ? eb : [];
}

function defaultStateOf(railDef: RailDef): SystemMode {
  const s = railDef?.state?.default;
  if (s === "ALW" || s === "S0" || s === "SLEEP" || s === "OFF") return s;
  return "ALW";
}

function summarizeUpstreamStatus(
  upstreamId: string,
  evaluated: Record<string, RailRuntime>
): RailRuntime["reason"]["upstream_status"] {
  const upstream = evaluated[upstreamId];
  return upstream?.status || "OFF";
}

function mkRuntimeBase(id: string, railDef: RailDef, system_mode: SystemMode): RailRuntime {
  const fault = _rt.faults[id];
  const default_state = defaultStateOf(railDef);
  return {
    id,
    status: "OFF",
    voltage_v: null,
    reason: { decided_by: "default_state" },
    gating: {
      system_mode,
      default_state,
      enabled_by: enabledByOf(railDef),
      regulator_ok: fault?.type !== "disable_regulator",
    },
  };
}

// -------------------- topo sort --------------------
function buildTopoOrder(railsById: Record<string, RailDef>): string[] {
  // edges: upstream -> downstream
  const ids = Object.keys(railsById);
  const indeg = new Map(ids.map((id) => [id, 0]));
  const out = new Map(ids.map((id) => [id, [] as string[]]));

  for (const id of ids) {
    const r = railsById[id];
    // upstream gating: depends_on + enabled_by juga kita treat sebagai dependency
    const deps = [...dependsOf(r), ...enabledByOf(r)];
    for (const up of deps) {
      if (!railsById[up]) continue; // validator sudah cek existence; ini safety
      out.get(up)!.push(id);
      indeg.set(id, (indeg.get(id) || 0) + 1);
    }
  }

  const q: string[] = [];
  for (const [id, d] of indeg.entries()) if (d === 0) q.push(id);

  const topo: string[] = [];
  while (q.length) {
    const u = q.shift()!;
    topo.push(u);
    for (const v of out.get(u) || []) {
      indeg.set(v, (indeg.get(v) || 0) - 1);
      if (indeg.get(v) === 0) q.push(v);
    }
  }

  // kalau ada cycle (harusnya sudah dicegah validator), fallback: ids order
  if (topo.length !== ids.length) return ids;
  return topo;
}

// -------------------- evaluation --------------------
export function setActiveBoard(board_id: string): void {
  const id = String(board_id || "").trim();
  if (!id) return;
  const entry = _boards.get(id);
  if (!entry) return;
  _activeBoardId = id;
  bindActiveEntry(entry);
}

export function initPowerRuntime({
  board_id,
  rails,
  system_mode = "S0",
}: {
  board_id: string;
  rails: RailDef[];
  system_mode?: SystemMode;
}): void {
  const normalizedBoardId = String(board_id || "").trim();
  if (!normalizedBoardId) return;

  const railsById: Record<string, RailDef> = {};
  for (const r of rails || []) {
    if (r?.id) railsById[r.id] = r;
  }

  const staticState: StaticState = {
    board_id: normalizedBoardId,
    railsById,
    topo: buildTopoOrder(railsById),
  };

  const runtimeState: PowerRuntime = {
    board_id: staticState.board_id,
    system_mode: normalizeSystemMode(system_mode, "S0"),
    faults: {},
    rails: {},
    topo_order: [...staticState.topo],
  };

  const entry: BoardEntry = { static: staticState, rt: runtimeState };
  _boards.set(staticState.board_id, entry);
  _activeBoardId = staticState.board_id;
  bindActiveEntry(entry);

  loadPersistedState(staticState.board_id);
  recomputePower(); // initial evaluate
}

export function setSystemMode(system_mode: SystemMode): void {
  if (!getActiveEntry()) return;
  _rt.system_mode = normalizeSystemMode(system_mode, _rt.system_mode);
  recomputePower();
  if (_activeBoardId) persistState(_activeBoardId);
}

export function injectFault(railId: string, fault?: RailFault | null): void {
  if (!getActiveEntry()) return;
  if (!railId) return;
  const normalizedFault = normalizeFault(fault);
  if (!normalizedFault) delete _rt.faults[String(railId)];
  else _rt.faults[String(railId)] = normalizedFault;
  recomputePower();
  if (_activeBoardId) persistState(_activeBoardId);
}

export function clearFault(railId: string): void {
  if (!getActiveEntry()) return;
  if (!railId) return;
  delete _rt.faults[String(railId)];
  recomputePower();
  if (_activeBoardId) persistState(_activeBoardId);
}

export function recomputePower(): void {
  if (!getActiveEntry()) return;
  const railsById = _static.railsById;
  const topo = _static.topo;
  const system_mode = _rt.system_mode;

  const out: Record<string, RailRuntime> = {};

  for (const id of topo) {
    const def = railsById[id];
    if (!def) continue;

    const rr = mkRuntimeBase(id, def, system_mode);
    const fault = _rt.faults[id];

    // FAULT: short/open -> rail sendiri FAULT
    if (fault?.type === "short" || fault?.type === "open") {
      rr.status = "FAULT";
      rr.reason = { decided_by: "fault", fault };
      rr.voltage_v = null;
      out[id] = rr;
      continue;
    }

    // mode gating
    const default_state = rr.gating.default_state;
    if (!isAllowedByMode(default_state, system_mode)) {
      rr.status = "OFF";
      rr.reason = { decided_by: "default_state" };
      rr.voltage_v = null;
      out[id] = rr;
      continue;
    }

    // disable regulator => OFF walau upstream OK
    if (!rr.gating.regulator_ok) {
      rr.status = "OFF";
      rr.reason = { decided_by: "fault", fault };
      rr.voltage_v = null;
      out[id] = rr;
      continue;
    }

    // enabled_by gating (butuh rail enable ON)
    const en = enabledByOf(def);
    const enBlocker = en.find((up) => out[up]?.status !== "ON");
    if (enBlocker) {
      rr.status = "OFF";
      rr.reason = {
        decided_by: "enabled_by",
        upstream_blocker: enBlocker,
        upstream_status: summarizeUpstreamStatus(enBlocker, out),
      };
      rr.voltage_v = null;
      out[id] = rr;
      continue;
    }

    // depends_on propagation
    const deps = dependsOf(def);
    const depBlocker = deps.find((up) => out[up]?.status !== "ON");
    if (depBlocker) {
      rr.status = "OFF";
      rr.reason = {
        decided_by: "upstream",
        upstream_blocker: depBlocker,
        upstream_status: summarizeUpstreamStatus(depBlocker, out),
      };
      rr.voltage_v = null;
      out[id] = rr;
      continue;
    }

    // ON -> sample voltage from expected range
    const vmin = def?.expected?.voltage_v?.min;
    const vmax = def?.expected?.voltage_v?.max;
    const v = randBetween(vmin, vmax);
    rr.status = "ON";
    rr.voltage_v = Number.isFinite(v) ? v : null;
    rr.reason = { decided_by: "default_state" };
    out[id] = rr;
  }

  _rt.rails = out;
}

export function getRailRuntime(railId: string): RailRuntime | null {
  if (!getActiveEntry()) return null;
  return _rt.rails[String(railId)] || null;
}

export function measureRailVoltage(railId: string): number {
  const rr = getRailRuntime(railId);
  if (!rr) return 0;

  if (rr.status === "ON") return jitter(rr.voltage_v ?? 0);

  if (rr.status === "FAULT") {
    const t = rr.reason?.fault?.type;
    if (t === "open") return jitter(0.02, 2.0); // floating noise sederhana
    return 0; // short -> 0V
  }

  return 0; // OFF
}

function resolveRailId(rawRailId: string): string | null {
  if (!getActiveEntry()) return null;
  const input = String(rawRailId || "").trim();
  if (!input) return null;
  if (_static.railsById[input]) return input;
  const wanted = input.toLowerCase();
  const found = Object.keys(_static.railsById).find((id) => id.toLowerCase() === wanted);
  return found || null;
}

function faultTypeOf(rawRailId: string): RailFault["type"] | null {
  const railId = resolveRailId(rawRailId);
  if (!railId) return null;

  const fromFaultMap = _rt.faults[railId]?.type;
  if (fromFaultMap === "short" || fromFaultMap === "open") return fromFaultMap;

  const fromRuntimeReason = _rt.rails[railId]?.reason?.fault?.type;
  if (fromRuntimeReason === "short" || fromRuntimeReason === "open") return fromRuntimeReason;

  return null;
}

export function measureRailResistance(a: string, b: string | null = null): number {
  const railA = resolveRailId(a);
  if (!railA) return Number.NaN;

  const railB = b == null || String(b).trim() === "" ? null : resolveRailId(String(b));
  if (b != null && String(b).trim() !== "" && !railB) return Number.NaN;

  const faultA = faultTypeOf(railA);
  const faultB = railB ? faultTypeOf(railB) : null;

  if (faultA === "short" || faultB === "short") {
    return clampResistance(jitter(0.2, 0.15));
  }

  if (faultA === "open" || faultB === "open") {
    return clampResistance(randBetween(1.0e7, 5.0e7) ?? 2.0e7);
  }

  // Sederhana:
  // - rail->GND: 100k..2M
  // - rail->rail: 10k..500k
  const base = railB ? randBetween(1.0e4, 5.0e5) : randBetween(1.0e5, 2.0e6);
  return clampResistance(base ?? Number.NaN);
}

export function measureContinuity(a: string, b: string | null = null): number {
  const ohm = measureRailResistance(a, b);
  if (!Number.isFinite(ohm)) return Number.NaN;
  return ohm < 10 ? 1 : 0;
}

export function debugDumpPower(): { static: StaticState; runtime: PowerRuntime } {
  const entry = getActiveEntry();
  if (!entry) {
    return {
      static: _static,
      runtime: _rt,
    };
  }
  return {
    static: entry.static,
    runtime: entry.rt,
  };
}
