use crate::power::graph::DependencyGraph;
use crate::power::rail::Rail;
use crate::state::ids::RailId;
use crate::state::phone_state::PhoneState;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct JsonRail {
    pub id: RailId, // langsung enum! no String
    pub expected: JsonExpected,
}

#[derive(Deserialize)]
pub struct JsonExpected {
    pub voltage_v: Range,
    pub diode_drop_v: Range,
    pub r2g_ohms: Nominal,
    pub continuity: Threshold,
}

#[derive(Deserialize)]
pub struct Range {
    pub min: f64,
    pub max: f64,
}

#[derive(Deserialize)]
pub struct Nominal {
    pub nominal: f64,
}

#[derive(Deserialize)]
pub struct Threshold {
    pub beep_below_ohms: f64,
}

#[derive(Deserialize)]
struct TopologyFile {
    #[allow(dead_code)]
    version: Option<u32>,
    #[allow(dead_code)]
    nodes: Option<Vec<String>>,
    #[serde(default)]
    edges: Vec<TopologyEdge>,
}

#[derive(Deserialize)]
struct TopologyEdge {
    from: String,
    to: String,
    kind: String,
    #[serde(default)]
    current_limit_a: Option<f64>,
}

/// rails.json → inject langsung ke PhoneState.electrical.rails
pub fn load_into_state(json_data: &str, state: &mut PhoneState) {
    let raw_rails: Vec<JsonRail> = serde_json::from_str(json_data).expect("Invalid rails.json");

    for r in raw_rails {
        let target_voltage = (r.expected.voltage_v.min + r.expected.voltage_v.max) / 2.0;

        let rail = state.electrical.rails.entry(r.id).or_insert_with(|| {
            let mut rail = Rail::new(r.id);
            rail.target_voltage = target_voltage;
            rail
        });

        rail.expected.v_min = r.expected.voltage_v.min;
        rail.expected.v_max = r.expected.voltage_v.max;
        rail.expected.diode_min = r.expected.diode_drop_v.min;
        rail.expected.diode_max = r.expected.diode_drop_v.max;
        rail.expected.continuity_beep_below_ohms = r.expected.continuity.beep_below_ohms;
        rail.health.resistance_to_ground = r.expected.r2g_ohms.nominal.max(1e-6_f64);
    }
}

fn default_edge_limit_by_kind(kind: &str) -> f64 {
    match kind {
        "charger" => 3.0_f64,
        "buck" => 6.0_f64,
        "ldo" => 1.5_f64,
        "switch" => 2.0_f64,
        "always_on" => 1.0_f64,
        "load" => 0.8_f64,
        _ => 2.0_f64,
    }
}

/// topology.json -> rebuild `PhoneState.power_graph` with per-edge current limits.
/// The parser accepts optional `current_limit_a` on each edge; when missing it uses
/// a default based on edge kind.
pub fn load_topology_into_graph(json_data: &str, state: &mut PhoneState) {
    let topo: TopologyFile = serde_json::from_str(json_data).expect("Invalid topology.json");
    let mut graph = DependencyGraph::new();

    for edge in topo.edges {
        let Some(from) = RailId::from_str(&edge.from) else {
            continue;
        };
        let Some(to) = RailId::from_str(&edge.to) else {
            continue;
        };

        let ilim = edge
            .current_limit_a
            .unwrap_or_else(|| default_edge_limit_by_kind(&edge.kind))
            .max(0.0_f64);

        graph.add_regulator_with_limit(from, to, ilim);
    }

    state.power_graph = graph;
}
