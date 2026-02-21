use crate::state::ids::RailId;
use std::collections::{HashMap, VecDeque};

/// Merepresentasikan struktur pohon/jaringan distribusi daya.
/// Menentukan bagaimana dependency merambat dari sumber (VBAT/USB) ke beban.
pub struct DependencyGraph {
    /// Mapping: Source Rail -> List of Dependent Rails
    /// Contoh: Vsys -> [Vcore, Vio, Vddr]
    pub adjacency: HashMap<RailId, Vec<RailId>>,

    /// Mapping: Dependent Rail -> Source Rail (single-parent)
    /// Digunakan untuk back-tracing arus atau debugging.
    pub parents: HashMap<RailId, RailId>,
}

impl DependencyGraph {
    pub fn new() -> Self {
        Self {
            adjacency: HashMap::new(),
            parents: HashMap::new(),
        }
    }

    /// Menambahkan hubungan regulator (LDO/Buck/Switch).
    /// `source` memberikan daya ke `target`.
    ///
    /// Catatan:
    /// - Mencegah self-loop (A->A)
    /// - Mencegah duplikasi edge (A->B) berulang
    pub fn add_regulator(&mut self, source: RailId, target: RailId) {
        if source == target {
            // self-loop biasanya konfigurasi salah, abaikan agar topo tidak kacau
            return;
        }

        let deps = self.adjacency.entry(source).or_default();

        // hindari duplicate edge
        if !deps.contains(&target) {
            deps.push(target);
        }

        // single-parent mapping (kalau target sudah punya parent, overwrite = last-wins)
        self.parents.insert(target, source);
    }

    /// Mendapatkan rail yang ditenagai langsung oleh rail ini.
    pub fn get_dependents(&self, rail: RailId) -> Option<&Vec<RailId>> {
        self.adjacency.get(&rail)
    }

    /// Mendapatkan sumber daya rail ini.
    pub fn get_source(&self, rail: RailId) -> Option<&RailId> {
        self.parents.get(&rail)
    }

    /// Mengembalikan semua rail dalam graph.
    pub fn all_rails(&self) -> Vec<RailId> {
        let mut rails: Vec<RailId> = self.adjacency.keys().cloned().collect();
        rails.extend(self.parents.keys().cloned());
        rails.sort_by_key(|k| format!("{:?}", k)); // deterministic
        rails.dedup();
        rails
    }

    /// Topological order (Kahn). Cocok untuk graph besar.
    /// - Jika ada cycle, mengembalikan urutan parsial + rails yang tersisa (cycle/loop).
    pub fn topo_order(&self) -> TopoResult {
        let rails = self.all_rails();

        // indegree init 0
        let mut indegree: HashMap<RailId, usize> =
            rails.iter().map(|&r| (r, 0usize)).collect();

        // hitung indegree dari adjacency
        for (&src, deps) in self.adjacency.iter() {
            indegree.entry(src).or_insert(0);

            for &dst in deps {
                *indegree.entry(dst).or_insert(0) += 1;
            }
        }

        // queue nodes indegree 0
        let mut zeros: Vec<RailId> = indegree
            .iter()
            .filter_map(|(&r, &deg)| if deg == 0 { Some(r) } else { None })
            .collect();

        zeros.sort_by_key(|k| format!("{:?}", k)); // deterministic
        let mut q: VecDeque<RailId> = zeros.into_iter().collect();

        let mut order: Vec<RailId> = Vec::with_capacity(indegree.len());

        while let Some(n) = q.pop_front() {
            order.push(n);

            // Untuk deterministik penuh: traversal children diurutkan
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

        // nodes yang tidak masuk order => cycle/terputus karena indegree tidak pernah 0
        let mut remaining: Vec<RailId> = indegree
            .iter()
            .filter_map(|(&r, &deg)| if deg > 0 { Some(r) } else { None })
            .collect();

        remaining.sort_by_key(|k| format!("{:?}", k));

        TopoResult { order, remaining }
    }

    /// Shortcut: apakah graph punya cycle?
    pub fn has_cycle(&self) -> bool {
        !self.topo_order().remaining.is_empty()
    }
}

/// Hasil topo sort:
/// - `order`: urutan evaluasi yang valid
/// - `remaining`: node yang tersisa (biasanya karena cycle)
#[derive(Debug, Clone)]
pub struct TopoResult {
    pub order: Vec<RailId>,
    pub remaining: Vec<RailId>,
}