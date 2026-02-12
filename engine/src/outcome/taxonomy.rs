/// Outcome Taxonomy — label refleksi pasca sesi.
/// BUKAN skor. BUKAN penilaian benar/salah.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutcomeLabel {
    /// Teknisi memilih berhenti saat data belum cukup,
    /// mencegah eskalasi risiko lebih lanjut.
    StoppedEarlyPrudent,

    /// Perangkat tidak terselesaikan, tapi tetap stabil.
    /// Keputusan tidak memperburuk kondisi.
    UnresolvedButStable,

    /// Keputusan atau pengukuran memperparah kondisi,
    /// namun belum menghancurkan total.
    EscalatedDamage,

    /// Kerusakan fisik/elektrik permanen terjadi
    /// dan sesi berakhir paksa.
    CatastrophicTermination,

    /// Sesi dihentikan tanpa evaluasi teknis lengkap
    /// (mis. user stop / waktu habis).
    SessionAborted,
}

/// Container outcome untuk UI & post-mortem.
#[derive(Debug, Clone)]
pub struct SessionOutcome {
    pub label: OutcomeLabel,
    pub summary: &'static str,
}
