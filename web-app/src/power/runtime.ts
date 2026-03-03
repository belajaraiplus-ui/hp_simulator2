import type { PowerRuntime, RailFault, RailRuntime, SystemMode } from "./powerRuntime";

/**
 * Runtime power propagation (Step 9)
 * - Evaluasi rails berdasarkan depends_on (DAG) + state.default/enabled_by + fault injection
 * - Fokus output: voltage measurement untuk multimeter/PCB probe
 */

type RailDef = {
  id: string;
  depends_on?: string[];
  expected?: { voltage_v?: { min?: number; max?: number } };
  state?: { default?: SystemMode; enabled_by?: string[] };
};

type StaticState = {
  board_id: string;
  railsById: Record<string, RailDef>;
  topo: string[];
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

// -------------------- helpers --------------------
function rankMode(m: SystemMode | string | undefined): number {
  return ({ OFF: 0, ALW: 1, SLEEP: 2, S0: 3 })[String(m || "OFF")] ?? 0;
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
export function initPowerRuntime({
  board_id,
  rails,
  system_mode = "S0",
}: {
  board_id: string;
  rails: RailDef[];
  system_mode?: SystemMode;
}): void {
  const railsById: Record<string, RailDef> = {};
  for (const r of rails || []) {
    if (r?.id) railsById[r.id] = r;
  }

  _static = {
    board_id: board_id || "",
    railsById,
    topo: buildTopoOrder(railsById),
  };

  _rt.board_id = _static.board_id;
  _rt.system_mode = system_mode;
  _rt.topo_order = [..._static.topo];
  _rt.rails = {};
  recomputePower(); // initial evaluate
}

export function setSystemMode(system_mode: SystemMode): void {
  _rt.system_mode = system_mode;
  recomputePower();
}

export function injectFault(railId: string, fault?: RailFault | null): void {
  if (!railId) return;
  if (!fault) delete _rt.faults[String(railId)];
  else _rt.faults[String(railId)] = fault;
  recomputePower();
}

export function clearFault(railId: string): void {
  if (!railId) return;
  delete _rt.faults[String(railId)];
  recomputePower();
}

export function recomputePower(): void {
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
      rr.reason = { decided_by: "enabled_by", upstream_blocker: enBlocker };
      rr.voltage_v = null;
      out[id] = rr;
      continue;
    }

    // depends_on propagation
    const deps = dependsOf(def);
    const depBlocker = deps.find((up) => out[up]?.status !== "ON");
    if (depBlocker) {
      rr.status = "OFF";
      rr.reason = { decided_by: "upstream", upstream_blocker: depBlocker };
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

export function debugDumpPower(): { static: StaticState; runtime: PowerRuntime } {
  return {
    static: _static,
    runtime: _rt,
  };
}
