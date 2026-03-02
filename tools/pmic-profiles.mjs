// tools/pmic-profiles.mjs
export const PMIC_MAIN = {
  id: "PMIC_MAIN",
  // regulatorName: { mode, defaultVoltageRange, suggestedRailId, domain, type }
  regulators: {
    SMPS1: { mode: "buck", minV: 0.6, maxV: 1.2, rail: "VDD_CPU", domain: "AP", type: "core" },
    SMPS2: { mode: "buck", minV: 0.7, maxV: 1.2, rail: "VDD_SOC", domain: "AP", type: "core" },
    SMPS3: { mode: "buck", minV: 0.6, maxV: 1.2, rail: "VDD_GPU", domain: "AP", type: "core" },

    LDO1: { mode: "ldo", minV: 1.71, maxV: 1.89, rail: "VDD_IO_1V8", domain: "AP", type: "logic" },
    LDO2: { mode: "ldo", minV: 2.85, maxV: 3.15, rail: "VDD_IO_3V0", domain: "AP", type: "logic" },

    LDO3: { mode: "ldo", minV: 2.7, maxV: 2.9, rail: "VCAM_AVDD_2V8", domain: "CAMERA", type: "camera" },
    LDO4: { mode: "ldo", minV: 1.14, maxV: 1.26, rail: "VCAM_DVDD_1V2", domain: "CAMERA", type: "camera" },
    LDO5: { mode: "ldo", minV: 1.71, maxV: 1.89, rail: "VCAM_IOVDD_1V8", domain: "CAMERA", type: "camera" },

    LDO6: { mode: "ldo", minV: 2.7, maxV: 3.0, rail: "VDD_UFS_2V9", domain: "STORAGE", type: "peripheral" },
    LDO7: { mode: "ldo", minV: 1.71, maxV: 1.89, rail: "VCCQ_UFS_1V8", domain: "STORAGE", type: "peripheral" },

    LDO8: { mode: "ldo", minV: 1.2, maxV: 1.4, rail: "VDD_RF_1V3", domain: "RF", type: "peripheral" },
  }
};
