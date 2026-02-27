import { dispatchToolAction, measureTool } from "../engine/adapter.js";
import { buildMultimeterLabel } from "../ui/multimeter.js";

/**
 * Tool Dispatcher: satu pintu untuk aksi tool.
 * - PSU: dispatch via kind:"tool" (tool_action / legacy)
 * - Multimeter: dispatch via kind:"measure" (label string) untuk kompatibilitas sekarang
 */
export function createToolDispatcher() {
  const state = {
    board: {
      id: null,
      rails: [],
      injectableRails: [],
    },
    psu: {
      enabled: false,
      voltage: 4.2,
      currentLimit: 2.0,
      targetRail: null, // rail id string, mis. "VBAT"
    },
    multimeter: {
      mode: "voltage", // "voltage" | "diode" | "resistance" | "continuity"
      targetType: "rail", // "rail" | "component"
      rail: "vbat",
      component: "tp_vbat",
    },
  };

  // ---- Board metadata loader (untuk filter PSU injection) ----
  async function loadBoardRails(boardId, { baseUrl = "" } = {}) {
    // Kamu bisa arahkan baseUrl ke server board API kamu.
    // Default: asumsi bisa fetch langsung dari assets.
    const url = `${baseUrl}/assets/boards/${boardId}/rails.json`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Failed to load rails.json: HTTP ${r.status} ${url}`);
    const json = await r.json();

    const rails = Array.isArray(json.rails) ? json.rails : [];
    const injectable = rails
      .filter((x) => x?.psu_injection?.enabled === true)
      .map((x) => x.id);

    state.board.id = boardId;
    state.board.rails = rails;
    state.board.injectableRails = injectable;

    // kalau targetRail tidak ada / tidak valid, biarkan null (netral)
    if (state.psu.targetRail && !injectable.includes(state.psu.targetRail)) {
      state.psu.targetRail = null;
    }

    return { rails, injectableRails: injectable };
  }

  // ---- PSU actions ----
  function setPSUConfig({ enabled, voltage, currentLimit, targetRail }) {
    if (typeof enabled === "boolean") state.psu.enabled = enabled;
    if (Number.isFinite(voltage)) state.psu.voltage = voltage;
    if (Number.isFinite(currentLimit)) state.psu.currentLimit = currentLimit;
    if (typeof targetRail === "string" || targetRail === null) state.psu.targetRail = targetRail;
  }

  async function applyPSU() {
    // 1) set target rail (kalau ada)
    // (ini butuh ToolAction::SetPSUTargetRail di engine; kalau belum, skip aman)
    if (state.psu.targetRail) {
      dispatchToolAction({ SetPSUTargetRail: { rail: state.psu.targetRail } });
    } else {
      dispatchToolAction({ ClearPSUTargetRail: {} });
    }

    // 2) setpoint + enable
    dispatchToolAction({ SetPSUVoltage: { voltage: state.psu.voltage } });
    dispatchToolAction({ SetPSUCurrent: { current: state.psu.currentLimit } });
    dispatchToolAction({ TogglePSU: { enabled: state.psu.enabled } });
  }

  async function applyPSUTargetOnly() {
    if (state.psu.targetRail) {
      dispatchToolAction({ SetPSUTargetRail: { rail: state.psu.targetRail } });
    } else {
      dispatchToolAction({ ClearPSUTargetRail: {} });
    }
  }

  // ---- Multimeter actions (kompat: masih label-based) ----
  function setMultimeter({ mode, targetType, rail, component }) {
    if (typeof mode === "string") state.multimeter.mode = mode;
    if (typeof targetType === "string") state.multimeter.targetType = targetType;
    if (typeof rail === "string") state.multimeter.rail = rail;
    if (typeof component === "string") state.multimeter.component = component;
  }

  async function measureMultimeter() {
    const label = buildMultimeterLabel(
      state.multimeter.mode,
      state.multimeter.targetType,
      state.multimeter.rail,
      state.multimeter.component
    );
    // engine ctx.measure() memang consume label string (diode/ohm/continuity/vbat/comp:...)
    const val = await measureTool(label);
    return { label, value: val };
  }

  return {
    state,
    loadBoardRails,
    setPSUConfig,
    applyPSU,
    applyPSUTargetOnly,
    setMultimeter,
    measureMultimeter,
  };
}
