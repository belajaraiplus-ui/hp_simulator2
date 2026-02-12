use crate::state::phone_state::PhoneState;
use crate::outcome::taxonomy::{OutcomeLabel, SessionOutcome};

/// Narasi refleksi pasca-sesi.
/// Tidak memberi saran.
/// Tidak menyebut solusi.
/// Tidak membaca ground truth.
#[derive(Debug, Clone)]
pub struct OutcomeNarrative {
    pub headline: &'static str,
    pub bullets: Vec<&'static str>,
}

/// Bangun narasi berdasarkan jejak interaksi teknisi.
/// Fokus pada pola keputusan, bukan hasil teknis.
pub fn build_narrative(
    state: &PhoneState,
    outcome: &SessionOutcome,
) -> OutcomeNarrative {
    let mut bullets: Vec<&'static str> = Vec::new();

    // =======================
    // DATA & OBSERVATION
    // =======================
    let measurements = state.measurements.history.len();
    if measurements == 0 {
        bullets.push(
            "Sesi berakhir tanpa data pengukuran yang dapat dijadikan dasar observasi."
        );
    } else if measurements >= 6 {
        bullets.push(
            "Pengukuran dilakukan berulang kali; setiap interaksi alat ukur turut memengaruhi kondisi sistem."
        );
    }

    // =======================
    // DOMAIN COVERAGE
    // =======================
    let has_electrical = !state.last_voltage.is_empty();
    let has_thermal = !state.last_temperature.is_empty();

    match (has_electrical, has_thermal) {
        (true, false) => bullets.push(
            "Observasi terutama terjadi di domain listrik; kondisi termal tidak pernah dikonfirmasi."
        ),
        (false, true) => bullets.push(
            "Observasi terutama terjadi di domain termal; kondisi listrik tidak pernah dikonfirmasi."
        ),
        _ => {}
    }

    // =======================
    // STRESS & ESCALATION
    // =======================
    if state.stress.measurement > 1.5 {
        bullets.push(
            "Interaksi alat ukur berkontribusi terhadap akumulasi stres sepanjang sesi."
        );
    }

    if state.stress.electrical > 1.5 || state.stress.thermal > 1.5 {
        bullets.push(
            "Kondisi sistem berubah seiring waktu akibat eskalasi stres dan interaksi berulang."
        );
    }

    // =======================
    // OUTCOME CONTEXT
    // =======================
    match outcome.label {
        OutcomeLabel::StoppedEarlyPrudent => bullets.push(
            "Sesi dihentikan sebelum ketidakpastian berkembang menjadi risiko yang tidak terkendali."
        ),

        OutcomeLabel::CatastrophicTermination => bullets.push(
            "Proses berakhir setelah sistem melewati batas yang tidak dapat dipulihkan."
        ),

        OutcomeLabel::SystemLimitReached => bullets.push(
            "Sistem mencapai batas fisik atau observabilitas yang membuat kelanjutan analisa tidak lagi bermakna."
        ),

        OutcomeLabel::SessionEnded => bullets.push(
            "Sesi berakhir tanpa kesimpulan teknis yang pasti."
        ),
    }

    // =======================
    // HEADLINE
    // =======================
    let headline = match outcome.label {
        OutcomeLabel::StoppedEarlyPrudent =>
            "Berhenti sebagai Keputusan Teknis",

        OutcomeLabel::CatastrophicTermination =>
            "Konsekuensi yang Tidak Dapat Dipulihkan",

        OutcomeLabel::SystemLimitReached =>
            "Batas Sistem Tercapai",

        OutcomeLabel::SessionEnded =>
            "Sesi Berakhir Tanpa Kepastian",
    };

    OutcomeNarrative { headline, bullets }
}
