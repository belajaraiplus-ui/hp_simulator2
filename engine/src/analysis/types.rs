#[derive(Clone)]
pub struct Hypothesis {
    pub description: String,
    pub confidence: f64, // 0.0 – 1.0 (BUKAN probabilitas benar)
}

#[derive(Clone)]
pub struct AnalysisReport {
    pub hypotheses: Vec<Hypothesis>,
    pub data_quality: f64, // seberapa konsisten data (bisa menipu)
}
