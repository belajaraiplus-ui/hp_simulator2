import { dispatchToolAction, measureTool, multimeterMeasure } from "../engine/adapter.js";
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

    // Thermal mapping: kirim mapping rail -> zone ke engine
    for (const rail of rails) {
      if (rail.thermal_zone) {
        dispatchToolAction({
          SetRailThermalZone: { rail: rail.id, zone: rail.thermal_zone }
        });
      }
    }

    // Panggil thermal loader saat board berubah
    await loadBoardThermal(boardId, { baseUrl });

    return { rails, injectableRails: injectable };
  }

  async function loadBoardThermal(boardId, { baseUrl = "" } = {}) {
    const url = `${baseUrl}/assets/boards/${boardId}/thermal.json`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Failed thermal.json: HTTP ${r.status} ${url}`);
    const t = await r.json();

    // ambient
    if (Number.isFinite(t.ambient_c)) {
      dispatchToolAction({ SetAmbientTemp: { ambient_c: t.ambient_c } });
    } else {
      dispatchToolAction({ SetAmbientTemp: { ambient_c: 27 } });
    }

    // zones: pastikan ada zone "board" sebagai sink umum
    dispatchToolAction({ UpsertThermalZone: { id: "board", thermal_mass: 10, heat_dissipation: 0.8 } });

    for (const z of (t.zones || [])) {
      dispatchToolAction({
        UpsertThermalZone: {
          id: z.id,
          thermal_mass: z.thermal_mass ?? 1.0,
          heat_dissipation: z.heat_dissipation ?? 0.3,
        }
      });
    }

    // links (optional)
    const links = (t.links || []).map(l => [l.a, l.b, l.conductance ?? 0.1]);
    dispatchToolAction({ SetThermalLinks: { links } });
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
    if (typeof mode === "string" && mode !== state.multimeter.mode) {
      state.multimeter.mode = mode;
      
      // Efek suara click saat dial multimeter diputar
      const clickSound = new Audio("/assets/sounds/multimeter_click.mp3");
      clickSound.volume = 0.4;
      clickSound.play().catch(e => console.debug("Autoplay blocked or sound missing:", e));
    }
    if (typeof targetType === "string") state.multimeter.targetType = targetType;
    if (typeof rail === "string") state.multimeter.rail = rail;
    if (typeof component === "string") state.multimeter.component = component;
  }

  async function measureMultimeter(railB = null) {
    const label = buildMultimeterLabel(
      state.multimeter.mode,
      state.multimeter.targetType,
      state.multimeter.rail,
      state.multimeter.component
    );
    
    // Check if this mode supports differential measurement (b parameter)
    const supportsDifferential = ["voltage", "temperature"].includes(state.multimeter.mode);
    
    let result;
    if (supportsDifferential && railB) {
      // Use direct multimeterMeasure for differential
      const mode = state.multimeter.mode;
      result = await multimeterMeasure({ 
        mode, 
        a: state.multimeter.rail, 
        b: railB 
      });
      return { 
        label, 
        value: result?.v ?? result?.c ?? result ?? 0 
      };
    }
    
    // Original label-based approach
    const val = await measureTool(label);
    return { label, value: val };
  }

  function setThermalConfig({ ambientTemp }) {
    if (Number.isFinite(ambientTemp)) {
      dispatchToolAction({ SetAmbientTemp: { ambient_c: ambientTemp } });
    }
  }

  function upsertThermalZone({ id, thermalMass, heatDissipation }) {
    dispatchToolAction({ UpsertThermalZone: { id, thermal_mass: thermalMass, heat_dissipation: heatDissipation } });
  }

  function setThermalLinks(links) {
    dispatchToolAction({ SetThermalLinks: { links } });
  }

  function setRailThermalZone(rail, zone) {
    dispatchToolAction({ SetRailThermalZone: { rail, zone } });
  }

  return {
    state,
    loadBoardRails,
    loadBoardThermal,
    setPSUConfig,
    applyPSU,
    applyPSUTargetOnly,
    setMultimeter,
    measureMultimeter,
    setThermalConfig,
    upsertThermalZone,
    setThermalLinks,
    setRailThermalZone,
  };
}
