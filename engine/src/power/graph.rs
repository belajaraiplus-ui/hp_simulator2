use crate::state::ids::RailId;
use std::collections::{HashMap, VecDeque};

#[derive(Debug, Clone, Copy, Default)]
pub struct ParallelRegulatorConfig {
    pub phase_count: u8,
    pub phase_offset: f64,
    pub current_share_tolerance: f64,
}

#[derive(Debug, Default)]
pub struct DependencyGraph {
    pub adjacency: HashMap<RailId, Vec<RailId>>,
    pub parents: HashMap<RailId, Vec<RailId>>,
    pub edge_current_limit_a: HashMap<(RailId, RailId), f64>,
    pub parallel_regulators: HashMap<RailId, ParallelRegulatorConfig>,
}

impl DependencyGraph {
    pub fn new() -> Self {
        Self {
            adjacency: HashMap::new(),
            parents: HashMap::new(),
            edge_current_limit_a: HashMap::new(),
            parallel_regulators: HashMap::new(),
        }
    }

    pub fn add_regulator(&mut self, source: RailId, target: RailId) {
        if source == target {
            return;
        }

        let deps = self.adjacency.entry(source).or_default();
        if !deps.contains(&target) {
            deps.push(target);
        }

        let parents = self.parents.entry(target).or_default();
        if !parents.contains(&source) {
            parents.push(source);
        }
    }

    pub fn add_regulator_with_limit(
        &mut self,
        source: RailId,
        target: RailId,
        current_limit_a: f64,
    ) {
        self.add_regulator(source, target);
        if current_limit_a > 0.0 {
            self.edge_current_limit_a
                .insert((source, target), current_limit_a);
        }
    }

    pub fn add_parallel_regulator(&mut self, target: RailId, phase_count: u8, phase_offset: f64) {
        self.parallel_regulators.insert(
            target,
            ParallelRegulatorConfig {
                phase_count,
                phase_offset,
                current_share_tolerance: 0.1,
            },
        );
    }

    pub fn edge_current_limit(&self, source: RailId, target: RailId) -> Option<f64> {
        self.edge_current_limit_a.get(&(source, target)).copied()
    }

    pub fn get_dependents(&self, rail: RailId) -> Option<&Vec<RailId>> {
        self.adjacency.get(&rail)
    }

    pub fn get_source(&self, rail: RailId) -> Option<&RailId> {
        self.parents.get(&rail).and_then(|v| v.first())
    }

    pub fn get_sources(&self, rail: RailId) -> Option<&Vec<RailId>> {
        self.parents.get(&rail)
    }

    pub fn has_parallel_regulators(&self, rail: RailId) -> bool {
        self.parents
            .get(&rail)
            .map(|v| v.len() > 1)
            .unwrap_or(false)
    }

    pub fn all_rails(&self) -> Vec<RailId> {
        let mut rails: Vec<RailId> = self.adjacency.keys().cloned().collect();
        rails.extend(self.parents.keys().cloned());
        rails.sort_by_key(|k| format!("{:?}", k));
        rails.dedup();
        rails
    }

    pub fn topo_order(&self) -> TopoResult {
        let rails = self.all_rails();

        let mut indegree: HashMap<RailId, usize> = rails.iter().map(|&r| (r, 0usize)).collect();

        for (&src, deps) in self.adjacency.iter() {
            indegree.entry(src).or_insert(0);
            for &dst in deps {
                *indegree.entry(dst).or_insert(0) += 1;
            }
        }

        let mut zeros: Vec<RailId> = indegree
            .iter()
            .filter_map(|(&r, &deg)| if deg == 0 { Some(r) } else { None })
            .collect();

        zeros.sort_by_key(|k| format!("{:?}", k));
        let mut q: VecDeque<RailId> = zeros.into_iter().collect();

        let mut order: Vec<RailId> = Vec::with_capacity(indegree.len());

        while let Some(n) = q.pop_front() {
            order.push(n);

            if let Some(children) = self.adjacency.get(&n) {
                let mut sorted_children = children.clone();
                sorted_children.sort_by_key(|k| format!("{:?}", k));

                for m in sorted_children {
                    if let Some(d) = indegree.get_mut(&m) {
                        *d = d.saturating_sub(1);
                        if *d == 0 {
                            q.push_back(m);
                        }
                    }
                }
            }
        }

        let mut remaining: Vec<RailId> = indegree
            .iter()
            .filter_map(|(&r, &deg)| if deg > 0 { Some(r) } else { None })
            .collect();

        remaining.sort_by_key(|k| format!("{:?}", k));

        TopoResult { order, remaining }
    }

    pub fn has_cycle(&self) -> bool {
        !self.topo_order().remaining.is_empty()
    }
}

#[derive(Debug, Clone)]
pub struct TopoResult {
    pub order: Vec<RailId>,
    pub remaining: Vec<RailId>,
}
