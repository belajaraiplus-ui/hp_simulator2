use crate::state::ids::RailId;
use serde::{Deserialize, Serialize};

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

    /// Fuse rating (Ampere). 0 = no fuse.
    pub fuse_rating_a: f64,

    /// Fuse status: true = blown, false = intact
    pub fuse_blown: bool,

    /// OCP threshold (Ampere). 0 = no OCP.
    pub ocp_threshold_a: f64,

    /// OCP delay (seconds) before triggering
    pub ocp_delay_s: f64,

    /// OCP triggered counter
    pub ocp_triggered_count: u32,

    /// Current sense resistance (Ohm) for OCP
    pub sense_resistor_ohm: f64,
}

impl Default for RailHealth {
    fn default() -> Self {
        Self {
            resistance_to_ground: 1_000_000.0, // 1 MOhm dianggap "open/normal"
            esr: 0.05,                         // 50 mOhm
            capacitance: 10e-6,                // 10 uF
            fuse_rating_a: 0.0,                // No fuse by default
            fuse_blown: false,
            ocp_threshold_a: 0.0, // No OCP by default
            ocp_delay_s: 0.001,   // 1ms OCP delay
            ocp_triggered_count: 0,
            sense_resistor_ohm: 0.01, // 10 mOhm sense resistor
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

    /// Switching noise amplitude (V)
    pub switching_noise: f64,

    /// Flag stabilitas (biasanya dihitung dari expected range & ripple)
    pub is_stable: bool,

    /// Beban tambahan (Ampere) dari alat ukur atau injeksi
    pub extra_load_a: f64,

    /// OCP timer (accumulates over-limit time)
    pub ocp_timer_s: f64,

    /// OCP latch (stays off until reset)
    pub ocp_latched: bool,
}

impl Default for RailState {
    fn default() -> Self {
        Self {
            voltage: 0.0,
            current: 0.0,
            ripple: 0.0,
            switching_noise: 0.0,
            is_stable: false,
            extra_load_a: 0.0,
            ocp_timer_s: 0.0,
            ocp_latched: false,
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

    /// Check and apply protection circuits (fuse and OCP)
    /// Returns true if rail is protected (blocked)
    #[inline]
    pub fn check_protection(&mut self, dt: f64) -> bool {
        // If already latched off due to OCP, check for reset condition
        if self.state.ocp_latched {
            // OCP auto-reset after 5 seconds
            self.state.ocp_timer_s += dt;
            if self.state.ocp_timer_s > 5.0 {
                self.state.ocp_latched = false;
                self.state.ocp_timer_s = 0.0;
                return false;
            }
            return true;
        }

        // Check fuse
        if self.health.fuse_rating_a > 0.0 && self.health.fuse_blown {
            return true;
        }

        // Check OCP threshold
        if self.health.ocp_threshold_a > 0.0 {
            let current = self.state.current;

            if current > self.health.ocp_threshold_a {
                self.state.ocp_timer_s += dt;

                // OCP triggers after delay
                if self.state.ocp_timer_s >= self.health.ocp_delay_s {
                    self.state.ocp_latched = true;
                    self.health.ocp_triggered_count += 1;
                    return true;
                }
            } else {
                // Reset timer if current below threshold
                self.state.ocp_timer_s = (self.state.ocp_timer_s - dt * 2.0).max(0.0);
            }
        }

        return false;
    }

    /// Blow the fuse (permanent until manually reset)
    #[inline]
    pub fn blow_fuse(&mut self) {
        if self.health.fuse_rating_a > 0.0 {
            self.health.fuse_blown = true;
        }
    }

    /// Reset fuse (for repair simulation)
    #[inline]
    pub fn reset_fuse(&mut self) {
        self.health.fuse_blown = false;
    }

    /// Calculate switching ripple based on load and rail type
    #[inline]
    pub fn calculate_switching_ripple(&self, time: f64) -> f64 {
        let load_factor = (self.state.current / 1.0).clamp(0.0, 1.0);

        // Switching frequency ~200kHz (typical buck converter)
        let switching_freq = 200_000.0;
        let base_ripple = 0.01 * load_factor; // 10mV per ampere

        // Add harmonics
        let fundamental = (time * switching_freq * 2.0 * std::f64::consts::PI).sin();
        let harmonic2 = (time * switching_freq * 4.0 * std::f64::consts::PI).sin() * 0.3;
        let harmonic3 = (time * switching_freq * 6.0 * std::f64::consts::PI).sin() * 0.1;

        base_ripple * (fundamental + harmonic2 + harmonic3)
    }
}
