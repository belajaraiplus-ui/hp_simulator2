use crate::analysis::types::*;
use crate::analysis::input::AnalysisInput;

/// Analysis Engine:
/// - Tidak tahu ground truth
/// - Tidak memberi solusi
/// - Bisa salah dengan confidence tinggi
pub fn analyze(input: AnalysisInput) -> AnalysisReport {
    let m = &input.measurements.history;

    // =======================
    // 1. DATA QUALITY (OBSERVABILITY, NOT TRUTH)
    // =======================
    let data_quality = if m.len() < 3 {
        0.15
    } else {
        let noise_avg: f64 =
            m.iter().map(|e| e.noise.abs()).sum::<f64>() / m.len() as f64;

        // Noise rendah TIDAK menjamin kualitas tinggi
        (1.0 / (1.0 + noise_avg * 1.5)).clamp(0.1_f64, 0.8_f64)
    };

    let mut hypotheses = Vec::new();

    // =======================
    // 2. RAW HEURISTICS (SHALLOW, BIAS-PRONE)
    // =======================
    if let Some(last) = m.last() {
        // Tegangan rendah → indikasi umum, BUKAN diagnosis
        if last.observed_value < 0.8 {
            hypotheses.push(Hypothesis {
                description: "Teramati nilai pengukuran lebih rendah dari ekspektasi umum".to_string(),
                confidence: (0.25 + data_quality * 0.4).min(0.85),
            });
        }

        // Noise tinggi → ketidakstabilan observasi, bukan sistem
        if last.noise > 0.05 {
            hypotheses.push(Hypothesis {
                description: "Observasi menunjukkan fluktuasi yang sulit diinterpretasikan".to_string(),
                confidence: (0.3 + data_quality * 0.3).min(0.8),
            });
        }
    }

    // =======================
    // 3. FALSE STABILITY WINDOW
    // =======================
    if m.len() >= 5 {
        let first = &m[0];
        let last = &m[m.len() - 1];

        if (first.observed_value - last.observed_value).abs() < 0.02 {
            hypotheses.push(Hypothesis {
                description: "Data tampak konsisten dalam jendela observasi terbatas".to_string(),
                // Sengaja tinggi → bisa SALAH
                confidence: (0.6 + data_quality * 0.2).min(0.95),
            });
        }
    }

    // =======================
    // 4. SILENT FAILURE MODE
    // =======================
    // Jika kualitas data rendah DAN hipotesis lemah,
    // analysis boleh hampir diam.
    if data_quality < 0.2 && hypotheses.len() <= 1 {
        hypotheses.clear();
    }

    AnalysisReport {
        hypotheses,
        data_quality,
    }
}
