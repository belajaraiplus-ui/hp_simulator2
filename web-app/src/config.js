// config.js

/**
 * Chart / telemetry controls
 * Catatan:
 * - MAX_POINTS mempengaruhi memori + biaya render.
 * - TARGET_FPS mempengaruhi smoothness + CPU.
 * - ENGINE_BASE_INTERVAL_MS adalah interval "tick" engine baseline (sebelum speed multiplier).
 */
export const MAX_POINTS = 300;
export const TARGET_FPS = 30;
export const ENGINE_BASE_INTERVAL_MS = 200;

/**
 * Layout markers menggunakan koordinat persen (0..100).
 * - x = 0 kiri, 100 kanan
 * - y = 0 atas, 100 bawah
 *
 * region membantu grouping di UI (filter/highlight).
 * label opsional untuk ditampilkan.
 * kind opsional untuk styling: "TP" | "R" | "C" | "J" | "U" | "NET"
 */
export const BOARD_LAYOUTS = {
  /**
   * Layout default (fallback) bila board_id tidak dikenal.
   */
  default: {
    j_vbat_main:   { x: 85, y: 75, region: "BATT_CONN", kind: "J", label: "J_VBAT_MAIN" },
    c_vbat_in:     { x: 75, y: 75, region: "BATT_CONN", kind: "C", label: "C_VBAT_IN" },
    r_vbat_sense:  { x: 65, y: 75, region: "BATT_CONN", kind: "R", label: "R_VBAT_SENSE" },
    tp_vbat:       { x: 65, y: 85, region: "BATT_CONN", kind: "TP", label: "TP_VBAT" },

    j_vcore_phase: { x: 35, y: 45, region: "PMIC_SHIELD", kind: "J", label: "J_VCORE_PHASE" },
    c_vcore_out:   { x: 25, y: 45, region: "PMIC_SHIELD", kind: "C", label: "C_VCORE_OUT" },
    r_vcore_fb:    { x: 25, y: 55, region: "PMIC_SHIELD", kind: "R", label: "R_VCORE_FB" },
    tp_vcore:      { x: 15, y: 45, region: "PMIC_SHIELD", kind: "TP", label: "TP_VCORE" },

    tp_vio:        { x: 45, y: 25, region: "LOGIC_SHIELD", kind: "TP", label: "TP_VIO" },
  },

  /**
   * Contoh: kalau nanti Anda ingin layout spesifik per board,
   * taruh di key board_id dari manifest.json, mis:
   * "hp_15_da0xx_mb_v1": { ... }
   */
  // "hp_15_da0xx_mb_v1": { ... }
};

/**
 * Backward compatibility:
 * Kode lama yang import BOARD_LAYOUT masih aman.
 */
export const BOARD_LAYOUT = BOARD_LAYOUTS.default;

/* -------------------------
   Helpers (dipakai UI)
-------------------------- */

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0);

export function getBoardLayout(boardId) {
  const layout = (boardId && BOARD_LAYOUTS[boardId]) ? BOARD_LAYOUTS[boardId] : BOARD_LAYOUTS.default;
  return sanitizeLayout(layout);
}

export function sanitizeLayout(layout) {
  // menjaga agar semua entry punya x/y valid 0..100
  const out = {};
  for (const [key, v] of Object.entries(layout || {})) {
    const x = clamp01(v?.x);
    const y = clamp01(v?.y);
    out[key] = {
      x,
      y,
      region: String(v?.region ?? "UNKNOWN"),
      kind: v?.kind ? String(v.kind) : undefined,
      label: v?.label ? String(v.label) : undefined,
    };
  }
  return out;
}
