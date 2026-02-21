use crate::state::ids::*;

/// =======================
/// FAULT MODEL — FASE 10.1
/// Fault adalah PERILAKU DINAMIS, bukan status.
/// =======================

#[derive(Debug, Clone)]
pub struct FaultInstance {
    /// Identitas fault (tetap)
    pub id: FaultId,

    /// Intensitas kontinu 0.0 → 1.0
    /// Tidak pernah boolean.
    pub intensity: f64,

    /// Lifecycle fault
    pub phase: FaultPhase,

    /// Seberapa cepat fault memburuk (per detik, sebelum coupling)
    pub escalation_rate: f64,

    /// Kopling ke domain fisik
    pub coupling: FaultCoupling,

    /// Akumulasi stress lokal fault (memori jangka pendek–menengah)
    pub accumulated_stress: f64,
}

/// Lifecycle fault.
/// Soft        → baru muncul / intermittent
/// Persistent → aktif stabil, mulai merusak sistem lain
/// Latent      → “tenang” tapi berbahaya (menyisakan scar)
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FaultPhase {
    Soft,
    Persistent,
    Latent,
}

/// Kopling fault ke dunia fisik.
/// Nilai lebih besar = lebih sensitif terhadap domain tsb.
#[derive(Debug, Clone)]
pub struct FaultCoupling {
    pub thermal: f64,
    pub electrical: f64,
}

/// Helper constructor supaya spawn fault konsisten
impl FaultInstance {
    pub fn new(
        id: FaultId,
        escalation_rate: f64,
        thermal_coupling: f64,
        electrical_coupling: f64,
    ) -> Self {
        Self {
            id,
            intensity: 0.01, // tidak pernah mulai dari nol absolut
            phase: FaultPhase::Soft,
            escalation_rate,
            coupling: FaultCoupling {
                thermal: thermal_coupling,
                electrical: electrical_coupling,
            },
            accumulated_stress: 0.0,
        }
    }
}

/// =======================
/// PARAMETER TRANSISI (FASE 10.1)
/// Bisa dipindah ke config nanti.
/// =======================

pub const SOFT_TO_PERSISTENT_THRESHOLD: f64 = 0.4;
pub const PERSISTENT_TO_LATENT_THRESHOLD: f64 = 0.8;

/// Clamp utility (hindari NaN / runaway)
pub fn clamp01(v: f64) -> f64 {
    if v < 0.0 {
        0.0
    } else if v > 1.0 {
        1.0
    } else {
        v
    }
}
