// tools/rail-templates.mjs
export function makeRail({
  id,
  label,
  type = "other",
  minV,
  maxV,
  depends_on = [],
  continuity = undefined,
  thermal_zone = undefined,
  domain = undefined,
  source = undefined,
  state = undefined,
  tags = undefined,
}) {
  const rail = {
    id,
    label,
    type,
    expected: {
      voltage_v: { min: minV, max: maxV },
    },
    depends_on,
    overlay: { type: "multi_poly", polys: [] },
    probe_points: [],
  };

  if (continuity !== undefined) rail.expected.continuity = continuity;
  if (thermal_zone) rail.thermal_zone = thermal_zone;
  if (domain) rail.domain = domain;
  if (source) rail.source = source;
  if (state) rail.state = state;
  if (tags) rail.tags = tags;

  return rail;
}

/**
 * Baseline rail smartphone (sekitar 25-40 rails).
 * Nilai ini template awal, tetap perlu disesuaikan per board nyata.
 */
export function baselinePhoneRails() {
  return [
    // INPUTS / SOURCES
    makeRail({ id: "VBAT", label: "Battery", type: "input", minV: 3.0, maxV: 4.4, domain: "POWER", tags: ["battery", "primary"] }),
    makeRail({ id: "VBUS_5V", label: "USB VBUS 5V", type: "usb", minV: 4.75, maxV: 5.25, domain: "POWER", tags: ["usb", "charging"] }),
    makeRail({ id: "VPH_PWR", label: "PMIC Main (VPH_PWR)", type: "system", minV: 3.0, maxV: 4.4, depends_on: ["VBAT"], domain: "POWER", state: { default: "ALW" } }),

    // ALWAYS / STANDBY
    makeRail({ id: "VREG_1V8_ALW", label: "1.8V Always", type: "logic", minV: 1.71, maxV: 1.89, depends_on: ["VPH_PWR"], domain: "POWER", state: { default: "ALW" } }),
    makeRail({ id: "VREG_3V0_ALW", label: "3.0V Always", type: "logic", minV: 2.85, maxV: 3.15, depends_on: ["VPH_PWR"], domain: "POWER", state: { default: "ALW" } }),
    makeRail({ id: "VRTC", label: "RTC Supply", type: "logic", minV: 1.6, maxV: 3.3, depends_on: ["VPH_PWR"], domain: "POWER", state: { default: "ALW" }, tags: ["rtc"] }),

    // CORE BUCKS
    makeRail({ id: "VDD_CPU", label: "CPU Core", type: "core", minV: 0.6, maxV: 1.2, depends_on: ["VPH_PWR"], domain: "AP", state: { default: "S0", enabled_by: ["PWRKEY", "AP"] }, tags: ["critical", "boot"] }),
    makeRail({ id: "VDD_GPU", label: "GPU Core", type: "core", minV: 0.6, maxV: 1.2, depends_on: ["VPH_PWR"], domain: "AP", state: { default: "S0", enabled_by: ["AP"] }, tags: ["graphics"] }),
    makeRail({ id: "VDD_SOC", label: "SoC Core", type: "core", minV: 0.7, maxV: 1.2, depends_on: ["VPH_PWR"], domain: "AP", state: { default: "S0", enabled_by: ["PWRKEY", "AP"] }, tags: ["critical", "boot"] }),

    // DDR / MEMORY
    makeRail({ id: "VDD_DDR", label: "DDR VDD", type: "core", minV: 1.05, maxV: 1.25, depends_on: ["VPH_PWR"], domain: "STORAGE", state: { default: "S0", enabled_by: ["AP"] }, tags: ["memory", "critical"] }),
    makeRail({ id: "VDDQ_DDR", label: "DDR VDDQ", type: "core", minV: 0.55, maxV: 0.7, depends_on: ["VDD_DDR"], domain: "STORAGE", state: { default: "S0", enabled_by: ["AP"] }, tags: ["memory"] }),
    makeRail({ id: "VDD2_DDR", label: "DDR VDD2 / VPP", type: "core", minV: 1.7, maxV: 2.7, depends_on: ["VPH_PWR"], domain: "STORAGE", tags: ["memory"] }),

    // IO / PERIPHERAL
    makeRail({ id: "VDD_IO_1V8", label: "1.8V IO", type: "logic", minV: 1.71, maxV: 1.89, depends_on: ["VREG_1V8_ALW"], domain: "OTHER" }),
    makeRail({ id: "VDD_IO_3V0", label: "3.0V IO", type: "logic", minV: 2.85, maxV: 3.15, depends_on: ["VREG_3V0_ALW"], domain: "OTHER" }),

    // STORAGE
    makeRail({ id: "VDD_UFS_2V9", label: "UFS 2.9V", type: "peripheral", minV: 2.7, maxV: 3.0, depends_on: ["VREG_3V0_ALW"], domain: "STORAGE", tags: ["storage"] }),
    makeRail({ id: "VCCQ_UFS_1V8", label: "UFS VCCQ 1.8V", type: "peripheral", minV: 1.71, maxV: 1.89, depends_on: ["VREG_1V8_ALW"], domain: "STORAGE", tags: ["storage"] }),

    // USB PHY / CHARGING
    makeRail({ id: "VUSB", label: "USB Rail", type: "usb", minV: 4.75, maxV: 5.25, depends_on: ["VBUS_5V"], domain: "POWER", tags: ["usb"] }),
    makeRail({ id: "VDD_USB_PHY_1V2", label: "USB PHY 1.2V", type: "usb", minV: 1.14, maxV: 1.26, depends_on: ["VPH_PWR"], domain: "OTHER" }),

    // RF / MODEM / CONNECTIVITY
    makeRail({ id: "VDD_RF_1V3", label: "RF 1.3V", type: "peripheral", minV: 1.2, maxV: 1.4, depends_on: ["VPH_PWR"], domain: "RF", tags: ["rf", "modem"] }),
    makeRail({ id: "VDD_PA_3V4", label: "PA Supply", type: "peripheral", minV: 3.2, maxV: 4.4, depends_on: ["VBAT"], domain: "RF", tags: ["rf", "power-amp"] }),
    makeRail({ id: "VDD_WLAN_1V8", label: "WLAN 1.8V", type: "peripheral", minV: 1.71, maxV: 1.89, depends_on: ["VREG_1V8_ALW"], domain: "RF", tags: ["wifi", "wireless"] }),
    makeRail({ id: "VDD_BT_1V8", label: "BT 1.8V", type: "peripheral", minV: 1.71, maxV: 1.89, depends_on: ["VREG_1V8_ALW"], domain: "RF", tags: ["bluetooth", "wireless"] }),
    makeRail({ id: "VDD_GNSS_1V8", label: "GNSS 1.8V", type: "peripheral", minV: 1.71, maxV: 1.89, depends_on: ["VREG_1V8_ALW"], domain: "RF", tags: ["gps", "navigation"] }),

    // CAMERA
    makeRail({ id: "VCAM_AVDD_2V8", label: "Camera AVDD 2.8V", type: "camera", minV: 2.7, maxV: 2.9, depends_on: ["VREG_3V0_ALW"], domain: "CAMERA", tags: ["camera"] }),
    makeRail({ id: "VCAM_DVDD_1V2", label: "Camera DVDD 1.2V", type: "camera", minV: 1.14, maxV: 1.26, depends_on: ["VPH_PWR"], domain: "CAMERA", tags: ["camera"] }),
    makeRail({ id: "VCAM_IOVDD_1V8", label: "Camera IOVDD 1.8V", type: "camera", minV: 1.71, maxV: 1.89, depends_on: ["VREG_1V8_ALW"], domain: "CAMERA", tags: ["camera"] }),
  ];
}

// Backward compatibility untuk skrip yang masih import baselinePowerRails.
export function baselinePowerRails() {
  return baselinePhoneRails();
}
