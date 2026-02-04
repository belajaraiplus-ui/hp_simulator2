use crate::analysis::types::*;
use crate::analysis::input::AnalysisInput;

pub fn analyze(input: AnalysisInput) -> AnalysisReport {
    let m = &input.measurements.history;

    // 1️⃣ Kualitas data (konsistensi, bukan kebenaran)
    let data_quality = if m.len() < 3 {
        0.2
    } else {
        let noise_avg: f64 = m.iter().map(|e| e.noise.abs()).sum::<f64>() / m.len() as f64;
        (1.0 / (1.0 + noise_avg)).clamp(0.1, 0.9)
    };

    let mut hypotheses = Vec::new();

    // 2️⃣ Hipotesis berbasis pola dangkal (RAW HEURISTICS)
    if let Some(last) = m.last() {
        if last.observed_value < 0.8 {
            hypotheses.push(Hypothesis {
                description: "Kemungkinan ada drop tegangan di jalur utama".to_string(),
                confidence: (0.4 + data_quality * 0.4).min(0.95),
            });
        }
        if last.noise > 0.05 {
            hypotheses.push(Hypothesis {
                description: "Sistem menunjukkan ketidakstabilan sinyal".to_string(),
                confidence: (0.5 + data_quality * 0.3).min(0.9),
            });
        }
    }

    // 3️⃣ Overfitting dini (CONFIDENCE PALSU)
    if m.len() >= 5 {
        let first = &m[0];
        let last = &m[m.len() - 1];
        if (first.observed_value - last.observed_value).abs() < 0.02 {
            hypotheses.push(Hypothesis {
                description: "Nilai tampak stabil dalam beberapa pengukuran".to_string(),
                confidence: (0.7 + data_quality * 0.2).min(0.98), // bisa SALAH
            });
        }
    }

    AnalysisReport {
        hypotheses,
        data_quality,
    }
}
