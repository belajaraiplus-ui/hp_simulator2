use serde::{Deserialize, Serialize};
use crate::state::ids::RailId;

/// Status logika rail (hasil dependency evaluator + fault engine).
/// Ini layer "PMIC / sequence / causal".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RailStatus {
    Off,        // dimatikan / belum sequence
    On,         // aktif normal
    Missing,    // enable gagal / rail tidak keluar
    ShortToGnd, // short ke ground
    Brownout,   // drop karena beban / short ringan / input lemah
}

impl Default for RailStatus {
    fn default() -> Self {
        RailStatus::Off
    }
}

/// Konfigurasi expected/guideline per rail.
/// Ini idealnya di-load dari `rails.json` (board-specific).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct RailExpected {
    /// Range tegangan normal (Volt)
    pub v_min: f64,
    pub v_max: f64,

    /// Range diode drop normal (Volt)
    pub diode_min: f64,
    pub diode_max: f64,

    /// Continuity beep threshold (Ohm). Jika R <= threshold => beep.
    pub continuity_beep_below_ohms: f64,
}

impl Default for RailExpected {
    fn default() -> Self {
        Self {
            v_min: 0.0,
            v_max: 0.0,
            diode_min: 0.0,
            diode_max: 3.0,
            continuity_beep_below_ohms: 50.0,
        }
    }
}

/// Kondisi kesehatan fisik rail.
/// Layer "physics": mempengaruhi sag, noise, leakage, r2g, dll.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct RailHealth {
    /// Resistansi ke ground (Ohm). Besar = normal/open. Kecil = indikasi short.
    pub resistance_to_ground: f64,

    /// Equivalent Series Resistance (Ohm).
    pub esr: f64,

    /// Kapasitansi total rail (Farad).
    pub capacitance: f64,
}

impl Default for RailHealth {
    fn default() -> Self {
        Self {
            resistance_to_ground: 1_000_000.0, // 1 MOhm dianggap "open/normal"
            esr: 0.05,                         // 50 mOhm
            capacitance: 10e-6,                // 10 uF
        }
    }
}

/// Kondisi dinamis rail per tick.
/// Layer "runtime state": berubah oleh PSU, injection, load, measurement probe, dll.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct RailState {
    /// Tegangan aktual rail (Volt)
    pub voltage: f64,

    /// Arus total rail (Ampere) – bisa Anda definisikan sebagai net current draw.
    pub current: f64,

    /// Ripple/noise tegangan (Vpp)
    pub ripple: f64,

    /// Flag stabilitas (biasanya dihitung dari expected range & ripple)
    pub is_stable: bool,
}

impl Default for RailState {
    fn default() -> Self {
        Self {
            voltage: 0.0,
            current: 0.0,
            ripple: 0.0,
            is_stable: false,
        }
    }
}

/// Bundle rail lengkap: ID + expected + health + state + status.
/// Ini adalah "single source" yang enak untuk engine.
///
/// Saran:
/// - Simpan map: `HashMap<RailId, Rail>` di `PhoneState.electrical`.
/// - Dependency evaluator hanya mengubah `status` dan `state.voltage` target/enable.
/// - Fault engine mengubah `health` (R2G/ESR/C) dan `status`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Rail {
    pub id: RailId,
    pub expected: RailExpected,
    pub health: RailHealth,
    pub state: RailState,
    pub status: RailStatus,

    /// Target voltage guideline (boleh dipakai oleh PMIC model / closed loop)
    pub target_voltage: f64,

    /// Kebocoran (Ampere), dipakai oleh measurement resistance model Anda yang sekarang.
    pub leakage_current: f64,

    /// Noise dasar (Volt), dipakai engine Anda sekarang.
    pub noise: f64,
}

impl Rail {
    /// Helper constructor: rail "mati" dengan default health.
    pub fn new(id: RailId) -> Self {
        Self {
            id,
            expected: RailExpected::default(),
            health: RailHealth::default(),
            state: RailState::default(),
            status: RailStatus::Off,
            target_voltage: 0.0,
            leakage_current: 1e-6,
            noise: 0.0,
        }
    }

    /// Shortcut: apakah rail dianggap "live".
    #[inline]
    pub fn is_live(&self) -> bool {
        self.status == RailStatus::On && self.state.voltage.abs() > 0.05
    }

    /// Hitung stabilitas berdasarkan expected range + ripple.
    /// Anda bisa panggil ini setiap tick atau setelah evaluator.
    #[inline]
    pub fn recompute_stability(&mut self) {
        let v = self.state.voltage;
        let in_range = if self.expected.v_max > self.expected.v_min {
            v >= self.expected.v_min && v <= self.expected.v_max
        } else {
            // kalau expected belum diset, fallback: treat >0 sebagai "stable"
            v.abs() > 0.05
        };

        // ripple besar = tidak stabil
        let ripple_ok = self.state.ripple.abs() < 0.15; // default heuristik, bisa jadi profile nanti

        self.state.is_stable = in_range && ripple_ok && self.status == RailStatus::On;
    }

    /// Resistansi yang dipakai untuk ohm/continuity mode.
    /// Default: gunakan `health.resistance_to_ground`.
    #[inline]
    pub fn r2g_ohms(&self) -> f64 {
        self.health.resistance_to_ground
    }

    /// Apakah continuity harus beep berdasarkan r2g dan threshold expected.
    #[inline]
    pub fn continuity_beep(&self) -> bool {
        self.r2g_ohms() <= self.expected.continuity_beep_below_ohms
            && self.state.voltage.abs() <= 0.2 // kalau rail live, biasanya multimeter tidak beep
    }

    /// Diode drop "expected center" untuk mode diode baseline.
    /// Engine Anda boleh tetap menambahkan stress/noise/jitter.
    #[inline]
    pub fn diode_drop_nominal(&self) -> f64 {
        let mid = (self.expected.diode_min + self.expected.diode_max) * 0.5;
        // clamp ke range DMM (0..3V)
        mid.clamp(0.0, 3.0)
    }
}
