use serde::{Deserialize, Serialize};

use super::evidence_graph::{EvidenceEdgeKind, EvidenceGraph, EvidenceNodeKind};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReasoningReview {
    pub score_total: u8,
    pub subscores: ReasoningSubscores,
    pub status: String,
    pub top_findings: Vec<String>,
    pub recommendations: Vec<String>,
    pub blind_spots: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReasoningSubscores {
    pub evidence_completeness: u8,
    pub sequence_quality: u8,
    pub risk_handling: u8,
    pub hypothesis_revision_quality: u8,
}

pub fn score_reasoning(graph: &EvidenceGraph) -> ReasoningReview {
    let node_count = graph.nodes.len() as f64;
    let edge_count = graph.edges.len() as f64;
    let measure_nodes = graph
        .nodes
        .iter()
        .filter(|n| n.kind == EvidenceNodeKind::Measurement)
        .count() as f64;
    let hypo_nodes = graph
        .nodes
        .iter()
        .filter(|n| n.kind == EvidenceNodeKind::Hypothesis)
        .count() as f64;
    let justification_nodes = graph
        .nodes
        .iter()
        .filter(|n| n.kind == EvidenceNodeKind::Justification)
        .count() as f64;

    let supports = graph
        .edges
        .iter()
        .filter(|e| e.kind == EvidenceEdgeKind::Supports)
        .count() as f64;
    let contradictions = graph
        .edges
        .iter()
        .filter(|e| e.kind == EvidenceEdgeKind::Contradicts)
        .count() as f64;
    let untested = graph
        .edges
        .iter()
        .filter(|e| e.kind == EvidenceEdgeKind::UntestedAssumption)
        .count() as f64;
    let risk_edges = graph
        .edges
        .iter()
        .filter(|e| e.kind == EvidenceEdgeKind::RiskIntroduced)
        .count() as f64;

    let completeness =
        ((measure_nodes + hypo_nodes + justification_nodes) / (node_count.max(1.0) + 2.0) * 100.0)
            .min(100.0) as u8;
    let sequence =
        (((supports + edge_count) / (edge_count.max(1.0) + 3.0)) * 100.0).min(100.0) as u8;
    let risk = ((100.0 - ((risk_edges + untested) * 12.0)).clamp(0.0, 100.0)) as u8;
    let revision =
        (((contradictions + supports) / (hypo_nodes.max(1.0) + 2.0)) * 100.0).min(100.0) as u8;

    let total = (0.30 * completeness as f64
        + 0.25 * sequence as f64
        + 0.25 * risk as f64
        + 0.20 * revision as f64)
        .round() as u8;

    let status = if total < 60 {
        "needs_guidance"
    } else if total < 80 {
        "acceptable"
    } else {
        "trainer_ready"
    };

    ReasoningReview {
        score_total: total,
        subscores: ReasoningSubscores {
            evidence_completeness: completeness,
            sequence_quality: sequence,
            risk_handling: risk,
            hypothesis_revision_quality: revision,
        },
        status: status.to_string(),
        top_findings: vec![
            format!("{} evidence nodes captured", node_count as usize),
            format!("{} contradiction checks performed", contradictions as usize),
            format!("{} explicit risk-introduced links", risk_edges as usize),
        ],
        recommendations: vec![
            "Add at least one confirming measurement before irreversible action.".into(),
            "Convert untested assumptions into explicit measurements with timestamps.".into(),
            "Document why risky actions were chosen and what mitigation was applied.".into(),
        ],
        blind_spots: vec![
            "Ground-reference integrity not validated early.".into(),
            "Alternative hypotheses were not fully eliminated.".into(),
            "Risk escalation checkpoints were sparse in timeline.".into(),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pedagogy::evidence_graph::{EvidenceEdgeKind, EvidenceGraph, EvidenceNodeKind};

    #[test]
    fn returns_required_fields_and_status() {
        let mut graph = EvidenceGraph::default();
        graph.add_node("n1", EvidenceNodeKind::Measurement, "VBAT=0V", 1);
        graph.add_node("n2", EvidenceNodeKind::Hypothesis, "Input path open", 2);
        graph.add_node("n3", EvidenceNodeKind::Justification, "Inject PSU", 3);
        graph.add_edge("n1", "n2", EvidenceEdgeKind::Supports, 2);
        graph.add_edge("n2", "n3", EvidenceEdgeKind::RiskIntroduced, 3);

        let review = score_reasoning(&graph);
        assert!(review.score_total <= 100);
        assert_eq!(review.recommendations.len(), 3);
        assert_eq!(review.blind_spots.len(), 3);
        assert!(
            ["needs_guidance", "acceptable", "trainer_ready"].contains(&review.status.as_str())
        );
    }
}
