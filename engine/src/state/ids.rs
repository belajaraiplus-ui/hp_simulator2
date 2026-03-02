use rand::seq::SliceRandom;
use rand::thread_rng;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum RailId {
    Vbat,
    #[serde(alias = "VPH_PWR")]
    Vsys,
    #[serde(alias = "VDD_CPU")]
    #[serde(alias = "VDD_GPU")]
    #[serde(alias = "VDD_SOC")]
    Vcore,
    #[serde(alias = "VREG_1V8_ALW")]
    #[serde(alias = "VDD_IO_1V8")]
    #[serde(alias = "VDD_IO_3V0")]
    #[serde(alias = "VDD_UFS_2V9")]
    #[serde(alias = "VCCQ_UFS_1V8")]
    #[serde(alias = "VDD_USB_PHY_1V2")]
    Vio,
    #[serde(alias = "VDD_DDR")]
    #[serde(alias = "VDDQ_DDR")]
    #[serde(alias = "VDD2_DDR")]
    Vddr,
    #[serde(alias = "VRTC")]
    #[serde(alias = "VDD_RF_1V3")]
    #[serde(alias = "VDD_PA_3V4")]
    #[serde(alias = "VDD_WLAN_1V8")]
    #[serde(alias = "VDD_BT_1V8")]
    #[serde(alias = "VDD_GNSS_1V8")]
    Vpa,
    #[serde(alias = "VCAM_AVDD_2V8")]
    #[serde(alias = "VCAM_DVDD_1V2")]
    #[serde(alias = "VCAM_IOVDD_1V8")]
    Vcam,
    #[serde(alias = "VREG_3V0_ALW")]
    Vdisp,
    #[serde(alias = "VBUS_5V")]
    #[serde(alias = "VUSB")]
    Vchg,
}

impl RailId {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.trim().to_ascii_uppercase().as_str() {
            "VBAT" => Some(RailId::Vbat),

            // Canonical system rail + smartphone alias
            "VSYS" | "VPH_PWR" => Some(RailId::Vsys),

            // Core buckets used by template
            "VCORE" | "VDD_CPU" | "VDD_GPU" | "VDD_SOC" => Some(RailId::Vcore),

            // IO rails and storage side rails
            "VIO"
            | "VREG_1V8_ALW"
            | "VDD_IO_1V8"
            | "VDD_IO_3V0"
            | "VDD_UFS_2V9"
            | "VCCQ_UFS_1V8"
            | "VDD_USB_PHY_1V2" => Some(RailId::Vio),

            // Memory group
            "VDDR" | "VDD_DDR" | "VDDQ_DDR" | "VDD2_DDR" => Some(RailId::Vddr),

            // Peripheral / RF / PA / RTC group
            "VPA"
            | "VRTC"
            | "VDD_RF_1V3"
            | "VDD_PA_3V4"
            | "VDD_WLAN_1V8"
            | "VDD_BT_1V8"
            | "VDD_GNSS_1V8" => Some(RailId::Vpa),

            // Camera family
            "VCAM" | "VCAM_AVDD_2V8" | "VCAM_DVDD_1V2" | "VCAM_IOVDD_1V8" => Some(RailId::Vcam),

            // Display / 3V always family
            "VDISP" | "VREG_3V0_ALW" => Some(RailId::Vdisp),

            // Charger / USB source family
            "VCHG" | "VBUS_5V" | "VUSB" => Some(RailId::Vchg),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum ThermalZoneId {
    Soc,
    Pmic,
    Ram,
    Board,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ComponentId {
    Soc,
    Pmic,
    Ram,
    Board,
}

/// FaultId hanyalah IDENTITAS.
/// Perilaku ada di FaultInstance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FaultId {
    SoftShort,           // soft short pada rail
    LocalThermalRunaway, // hotspot lokal
    PowerInstability,    // rail noise / drop
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SystemTag {
    Electrical,
    Thermal,
    Digital,
    Memory,
    Rf,
}

/// Daftar eksplisit untuk random & iterasi
const ALL_FAULT_IDS: &[FaultId] = &[
    FaultId::SoftShort,
    FaultId::LocalThermalRunaway,
    FaultId::PowerInstability,
];

impl FaultId {
    /// Pilih fault acak selain source
    pub fn random_except(src: FaultId) -> FaultId {
        let mut rng = thread_rng();

        let candidates: Vec<FaultId> = ALL_FAULT_IDS
            .iter()
            .copied()
            .filter(|f| *f != src)
            .collect();

        // fallback safety (kalau cuma 1 fault)
        if candidates.is_empty() {
            src
        } else {
            *candidates.choose(&mut rng).unwrap()
        }
    }
}
