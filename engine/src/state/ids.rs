use rand::seq::SliceRandom;
use rand::thread_rng;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RailId {
    Vcore,
    Vbat,
    Vio,
    Vddr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
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
    LocalThermalRunaway,// hotspot lokal
    PowerInstability,   // rail noise / drop
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
