use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceNodeKind {
    Measurement,
    Hypothesis,
    Justification,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EvidenceNode {
    pub id: String,
    pub kind: EvidenceNodeKind,
    pub text: String,
    pub tick: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceEdgeKind {
    Supports,
    Contradicts,
    UntestedAssumption,
    RiskIntroduced,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EvidenceEdge {
    pub from: String,
    pub to: String,
    pub kind: EvidenceEdgeKind,
    pub tick: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct EvidenceGraph {
    pub nodes: Vec<EvidenceNode>,
    pub edges: Vec<EvidenceEdge>,
}

impl EvidenceGraph {
    pub fn add_node(
        &mut self,
        id: impl Into<String>,
        kind: EvidenceNodeKind,
        text: impl Into<String>,
        tick: u64,
    ) {
        self.nodes.push(EvidenceNode {
            id: id.into(),
            kind,
            text: text.into(),
            tick,
        });
    }

    pub fn add_edge(
        &mut self,
        from: impl Into<String>,
        to: impl Into<String>,
        kind: EvidenceEdgeKind,
        tick: u64,
    ) {
        self.edges.push(EvidenceEdge {
            from: from.into(),
            to: to.into(),
            kind,
            tick,
        });
    }
}
