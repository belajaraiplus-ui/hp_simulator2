export const MAX_POINTS = 300;
export const TARGET_FPS = 30;
export const ENGINE_BASE_INTERVAL_MS = 200;

export const BOARD_LAYOUT = {
  // Area Baterai (Pojok Kanan Bawah)
  j_vbat_main:   { x: 85, y: 75, region: "BATT_CONN" },
  c_vbat_in:     { x: 75, y: 75, region: "BATT_CONN" },
  r_vbat_sense:  { x: 65, y: 75, region: "BATT_CONN" },
  tp_vbat:       { x: 65, y: 85, region: "BATT_CONN" },

  // Area PMIC (Tengah Kiri - Tertutup Shield)
  j_vcore_phase: { x: 35, y: 45, region: "PMIC_SHIELD" },
  c_vcore_out:   { x: 25, y: 45, region: "PMIC_SHIELD" },
  r_vcore_fb:    { x: 25, y: 55, region: "PMIC_SHIELD" },
  tp_vcore:      { x: 15, y: 45, region: "PMIC_SHIELD" },

  // Area Logic/IO (Atas)
  tp_vio:        { x: 45, y: 25, region: "LOGIC_SHIELD" },
};