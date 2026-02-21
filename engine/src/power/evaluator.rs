use std::collections::HashMap;

use crate::state::ids::RailId;
use super::graph::DependencyGraph;
use super::rail::{Rail, RailStatus};

/// PowerEvaluator:
/// - Menentukan status + target_voltage rail berdasarkan dependency graph.
/// - Menggunakan topo sort untuk graph besar (deterministik & stabil).
/// - Tidak memaksa `state.voltage` secara langsung (itu domain physics),
///   tetapi boleh mematikan target ketika upstream mati/short/brownout.
pub struct PowerEvaluator;

impl PowerEvaluator {
    const ALIVE_V: f64 = 0.05_f64;
    const HEADROOM_V: f64 = 0.2_f64;

    /// Heuristik: kapan dianggap "short"
    const R2G_SHORT_OHMS: f64 = 2.0_f64;
    /// Heuristik: kapan dianggap "brownout risk" (short ringan / leak besar)
    const R2G_BROWNOUT_OHMS: f64 = 20.0_f64;

    /// Root inputs: rail yang boleh dianggap "digerakkan dari luar"
    /// (contoh: VBAT dari PSU/charger, VCHG dari USB, VSYS dari charger IC).
    ///
    /// Anda bisa panggil fungsi ini setiap tick sebelum evaluate().
    pub fn apply_root_inputs(rails: &mut HashMap<RailId, Rail>, root_inputs: &HashMap<RailId, f64>) {
        for (&rid, &v) in root_inputs.iter() {
            let r = rails.entry(rid).or_insert_with(|| Rail::new(rid));
            r.state.voltage = v.max(0.0_f64);

            // root dianggap ON jika ada tegangan
            if r.state.voltage > Self::ALIVE_V {
                // jangan overwrite ShortToGnd jika fault engine menandainya
                if r.status != RailStatus::ShortToGnd {
                    r.status = RailStatus::On;
                }
            } else {
                // jika root memang 0V, boleh Off
                if r.status != RailStatus::ShortToGnd {
                    r.status = RailStatus::Off;
                }
            }

            // root target ikut voltage input (optional)
            r.target_voltage = r.state.voltage;
        }
    }

    /// Evaluate dependency:
    /// - set status & target_voltage untuk downstream rails
    /// - handle short/brownout dari RailHealth.r2g
    /// - handle cycle: remaining -> Missing
    pub fn evaluate(graph: &DependencyGraph, rails: &mut HashMap<RailId, Rail>) {
        let topo = graph.topo_order();

        // helper ambil voltage/status upstream
        let upstream_voltage = |m: &HashMap<RailId, Rail>, id: RailId| -> f64 {
            m.get(&id).map(|r| r.state.voltage).unwrap_or(0.0_f64)
        };

        let upstream_live = |m: &HashMap<RailId, Rail>, id: RailId| -> bool {
            if let Some(r) = m.get(&id) {
                // upstream dianggap supply jika status ON dan punya V
                r.status == RailStatus::On && r.state.voltage > Self::ALIVE_V
            } else {
                false
            }
        };

        // 1) traverse topo: src -> children
        for &src in topo.order.iter() {
            let Some(children) = graph.get_dependents(src) else { continue; };

            let src_live = upstream_live(rails, src);
            let src_v = upstream_voltage(rails, src);

            for &child in children.iter() {
                let child_rail = rails.entry(child).or_insert_with(|| Rail::new(child));

                // ====== HEALTH pre-check ======
                // short/brownout classification dari R2G
                let r2g = child_rail.health.resistance_to_ground.max(1e-9_f64);

                if r2g <= Self::R2G_SHORT_OHMS {
                    child_rail.status = RailStatus::ShortToGnd;
                    child_rail.target_voltage = 0.0_f64;
                    // leakage besar (untuk feel measurement)
                    child_rail.leakage_current = (child_rail.state.voltage / r2g).max(0.0_f64);
                    child_rail.recompute_stability();
                    continue;
                }

                // upstream mati -> downstream off (kecuali short already handled)
                if !src_live {
                    child_rail.status = RailStatus::Off;
                    child_rail.target_voltage = 0.0_f64;
                    child_rail.leakage_current = (child_rail.state.voltage / r2g).max(0.0_f64);
                    child_rail.recompute_stability();
                    continue;
                }

                // ====== Desired voltage ======
                // dari expected range midpoint; jika expected belum diset -> passthrough
                let desired = if child_rail.expected.v_max > child_rail.expected.v_min {
                    (child_rail.expected.v_min + child_rail.expected.v_max) * 0.5_f64
                } else {
                    // passthrough rail (no expected)
                    src_v
                };

                // ====== Regulator rule (minimal) ======
                // Jika rail punya expected range berarti regulated → butuh headroom.
                let has_expected = child_rail.expected.v_max > child_rail.expected.v_min;

                let mut out_target = if has_expected {
                    if src_v >= desired + Self::HEADROOM_V {
                        desired
                    } else {
                        0.0_f64
                    }
                } else {
                    desired
                };

                // ====== Brownout effect (short ringan / leakage tinggi) ======
                if r2g <= Self::R2G_BROWNOUT_OHMS {
                    child_rail.status = RailStatus::Brownout;
                    out_target *= 0.5_f64;
                } else {
                    // normal ON
                    child_rail.status = RailStatus::On;
                }

                // ====== ESR effect kecil (feel) ======
                let esr = child_rail.health.esr.max(0.0_f64);
                out_target -= (esr * 0.05_f64).min(0.2_f64);

                child_rail.target_voltage = out_target.max(0.0_f64);

                // leakage current (I=V/R) based on actual voltage
                child_rail.leakage_current = (child_rail.state.voltage / r2g).max(0.0_f64);

                // update stability flag
                child_rail.recompute_stability();
            }
        }

        // 2) cycle nodes → Missing (konfigurasi salah / loop)
        for rid in topo.remaining {
            let r = rails.entry(rid).or_insert_with(|| Rail::new(rid));
            if r.status != RailStatus::ShortToGnd {
                r.status = RailStatus::Missing;
            }
            r.target_voltage = 0.0_f64;
            r.recompute_stability();
        }
    }
}