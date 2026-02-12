use crate::outcome::taxonomy::*;
use crate::state::phone_state::PhoneState;
use crate::session::termination::{SessionStatus, TerminationReason};

/// Klasifikasi outcome berdasarkan cara sesi berakhir.
/// BUKAN penilaian benar / salah.
/// BUKAN evaluasi kompetensi teknisi.
pub fn classify_outcome(
    _state: &PhoneState,
    status: &SessionStatus,
) -> SessionOutcome {
    match status.reason {
        // =======================
        // TEKNISI MEMILIH BERHENTI
        // =======================
        Some(TerminationReason::VoluntaryStop) => SessionOutcome {
            label: OutcomeLabel::StoppedEarlyPrudent,
            summary:
                "Teknisi memilih menghentikan proses ketika informasi yang tersedia belum cukup untuk melanjutkan dengan aman.",
        },

        // =======================
        // KERUSAKAN PERMANEN
        // =======================
        Some(TerminationReason::IrreversibleDamage) => SessionOutcome {
            label: OutcomeLabel::CatastrophicTermination,
            summary:
                "Kerusakan permanen terjadi selama proses diagnosis dan tidak dapat dipulihkan.",
        },

        // =======================
        // SISTEM MEMAKSA BERHENTI
        // =======================
        Some(TerminationReason::ForcedShutdown) |
        Some(TerminationReason::InstabilityCollapse) => SessionOutcome {
            label: OutcomeLabel::SystemLimitReached,
            summary:
                "Sistem mencapai batas fisik atau observabilitas yang membuat kelanjutan diagnosis tidak lagi bermakna.",
        },

        // =======================
        // FALLBACK (HARUS JARANG)
        // =======================
        None => SessionOutcome {
            label: OutcomeLabel::SessionEnded,
            summary:
                "Sesi berakhir tanpa kesimpulan teknis yang pasti.",
        },
    }
}
