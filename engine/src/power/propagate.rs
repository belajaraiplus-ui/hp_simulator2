use crate::api::types::MeterMode;
use crate::power::graph::DependencyGraph;
use crate::state::electrical::ElectricalState;
use crate::state::ids::RailId;
use std::collections::HashMap;

fn edge_path_resistance_ohm(parent_esr: f64, child_esr: f64) -> f64 {
    // Generic inter-rail path resistance (regulator/switch/trace) until topology metadata is wired in.
    (0.03_f64 + parent_esr + child_esr).max(0.001_f64)
}

fn edge_current_limit_a(graph: &DependencyGraph, parent: RailId, child: RailId) -> f64 {
    graph.edge_current_limit(parent, child).unwrap_or(3.0_f64)
}

/// Physically propagate rail voltages using resistive links and capacitor integration.
///
/// Current model:
/// - Inter-rail edge: I = (Vparent - Vchild) / Rpath
/// - Local sink: leakage to ground + probe/extra load
/// - External source: VCHG and bench PSU (target rail aware)
/// - Voltage update: dV = (Inet / C) * dt
pub fn propagate_power(graph: &DependencyGraph, electrical: &mut ElectricalState, dt: f64) {
    if dt <= 0.0 {
        return;
    }

    // Tool-induced loading (multimeter attached)
    if electrical.meter_attached {
        let psu_near_limit = electrical.input.enabled
            && electrical.input.current_limit > 0.0_f64
            && electrical.input.measured_current > 0.9_f64 * electrical.input.current_limit;

        if let (Some(mode), Some(id)) = (electrical.meter_mode, electrical.meter_target) {
            if let Some(r) = electrical.rails.get_mut(&id) {
                let rail_very_low = r.state.voltage.abs() < 0.2_f64;
                match mode {
                    MeterMode::Voltage => {
                        // input impedance tinggi -> beban sangat kecil
                        r.state.extra_load_a += 0.000001_f64; // 1 uA
                    }
                    MeterMode::Resistance => {
                        // mode ohm biasanya inject arus kecil
                        r.state.extra_load_a += 0.0002_f64; // 0.2 mA
                    }
                    MeterMode::Continuity => {
                        // continuity biasanya arus sedikit lebih besar
                        r.state.extra_load_a += 0.002_f64; // 2 mA
                        if psu_near_limit || rail_very_low {
                            r.state.extra_load_a += 0.003_f64;
                        }
                    }
                    MeterMode::Diode => {
                        // diode mode inject arus lebih besar dari ohm
                        r.state.extra_load_a += 0.001_f64; // 1 mA
                        if psu_near_limit || rail_very_low {
                            r.state.extra_load_a += 0.0015_f64;
                        }
                    }
                    MeterMode::Current => {
                        // Ammeter mode: very low burden voltage, minimal load effect
                        // DMM in current mode has very low input impedance (shunt)
                        r.state.extra_load_a += 0.00001_f64; // 10 uA - negligible
                    }
                    MeterMode::Temperature => {
                        // Temperature probe: no electrical load
                        // Thermocouple/PT100 has minimal current draw
                    }
                }
            }
        }
    }

    // 1) Accumulator arus per rail (positif = arus masuk ke node rail)
    let mut net_i: HashMap<RailId, f64> = HashMap::new();
    for (id, _) in &electrical.rails {
        net_i.insert(*id, 0.0);
    }

    // 2) Tambahkan supply contributions (PSU injection + VCHG)
    electrical.input.measured_current = 0.0;

    if electrical.input.enabled {
        if let Some(target) = electrical.input.target_rail {
            if let Some(rail) = electrical.rails.get(&target) {
                let r_series =
                    (electrical.input.psu_series_r_ohm + rail.health.esr).max(0.0005_f64);
                let v_src = electrical.input.voltage;
                let v_now = rail.state.voltage;

                // Detect power-on event (large voltage difference)
                let voltage_diff = (v_src - v_now).abs();
                if voltage_diff > 1.0 && v_now < 0.5 {
                    // Trigger inrush: peak = 3x normal current limit, decays exponentially
                    let inrush_peak = electrical.input.current_limit.max(0.1) * 3.0;
                    electrical.trigger_inrush(target, inrush_peak, electrical.tick as f64 * dt);
                }

                let mut i_inj = (v_src - v_now) / r_series;
                let ilim = electrical.input.current_limit.max(0.0_f64);

                if i_inj > ilim {
                    i_inj = ilim;
                }
                if i_inj < -ilim {
                    i_inj = -ilim;
                }

                *net_i.entry(target).or_insert(0.0) += i_inj;
                electrical.input.measured_current = i_inj.abs();
            }
        }
    }

    // VCHG sebagai source dengan resistansi internal sederhana
    if electrical.input.vchg_enabled {
        if let Some(vchg) = electrical.rails.get(&RailId::Vchg) {
            let r_vchg = 0.05_f64;
            let v_src = electrical.input.vchg_voltage;
            let v_now = vchg.state.voltage;
            let i = (v_src - v_now) / r_vchg;
            *net_i.entry(RailId::Vchg).or_insert(0.0) += i;
        }
    }

    // 3) Dependency edges: arus mengalir parent -> child lewat Rpath
    let time = electrical.tick as f64 * dt;
    for (child, parents) in &graph.parents {
        // Skip if child rail doesn't exist
        let vc = electrical
            .rails
            .get(child)
            .map(|r| r.state.voltage)
            .unwrap_or(0.0);
        let ve_c = electrical
            .rails
            .get(child)
            .map(|r| r.health.esr)
            .unwrap_or(0.05);

        // Handle multi-parent (parallel regulators)
        let parent_count = parents.len().max(1) as f64;

        for (idx, parent) in parents.iter().enumerate() {
            let vp = electrical
                .rails
                .get(parent)
                .map(|r| r.state.voltage)
                .unwrap_or(0.0);
            let ve_p = electrical
                .rails
                .get(parent)
                .map(|r| r.health.esr)
                .unwrap_or(0.05);

            let r_path = edge_path_resistance_ohm(ve_p, ve_c);
            let base_ilim = edge_current_limit_a(graph, *parent, *child);
            // Divide current limit among parallel phases
            let edge_ilim = base_ilim / parent_count;

            // Detect rail power-on via dependency (child was off, parent is on)
            if vc < 0.5 && vp > 1.0 {
                let inrush_peak = edge_ilim * 2.5;
                electrical.trigger_inrush(*child, inrush_peak, time);
            }

            let i_raw = (vp - vc) / r_path;
            // Apply phase offset for ripple (for parallel regulators)
            let phase_offset = if parent_count > 1.0 {
                (idx as f64 / parent_count * 2.0 * std::f64::consts::PI).sin() * 0.1
            } else {
                0.0
            };
            let i_edge = ((i_raw + phase_offset) / parent_count).clamp(-edge_ilim, edge_ilim);

            *net_i.entry(*child).or_insert(0.0) += i_edge;
            *net_i.entry(*parent).or_insert(0.0) -= i_edge;
        }
    }

    // 4) Update Dynamic Load
    electrical.update_dynamic_load(dt, 0.0);
    let dynamic_load = electrical.get_dynamic_load();

    // Get rail IDs for inrush calculation
    let rail_ids: Vec<RailId> = electrical.rails.keys().cloned().collect();

    // Pre-calculate inrush currents to avoid borrow conflict
    let mut inrush_map: HashMap<RailId, f64> = HashMap::new();
    for id in &rail_ids {
        let i_inrush = electrical.get_inrush_current(*id, time);
        inrush_map.insert(*id, i_inrush);
    }

    // 5) Update tiap rail via kapasitor: dV = (Inet - Iload)/C * dt
    for (id, rail) in electrical.rails.iter_mut() {
        // Check protection circuits (fuse/OCP)
        let protected = rail.check_protection(dt);

        let v = rail.state.voltage;

        // If protected, reduce voltage and current
        let v_effective = if protected { v * 0.1 } else { v };

        let r2g = rail.health.resistance_to_ground.max(0.01_f64);
        let i_leak = v_effective / r2g;
        let i_extra = rail.state.extra_load_a.max(0.0_f64);
        let i_sup = if protected {
            0.0
        } else {
            *net_i.get(id).unwrap_or(&0.0_f64)
        };

        // Get inrush current if active
        let i_inrush = inrush_map.get(id).copied().unwrap_or(0.0);

        // Apply dynamic load to relevant rails (core/system rails)
        let i_dynamic = if protected {
            0.0
        } else {
            match *id {
                RailId::Vcore | RailId::Vsys | RailId::Vio => dynamic_load * 0.1,
                _ => 0.0,
            }
        };

        let i_net = i_sup - i_leak - i_extra - i_inrush - i_dynamic;
        let c = rail.health.capacitance.max(1e-9_f64);
        let dv = (i_net / c) * dt;

        let new_voltage = if protected {
            (v - 0.1).max(0.0) // Rapid discharge when protected
        } else {
            (v + dv).clamp(-1.0_f64, 25.0_f64)
        };

        rail.state.voltage = new_voltage;
        rail.state.current = (i_leak + i_extra + i_inrush + i_dynamic).max(0.0_f64);
        rail.leakage_current = i_leak.max(0.0_f64);

        // Calculate switching ripple/noise
        let time = electrical.tick as f64 * dt;
        rail.state.switching_noise = rail.calculate_switching_ripple(time);
        rail.state.ripple = rail.state.switching_noise.abs() * 2.0; // Vpp = 2 * amplitude

        // transient load berlaku per tick
        rail.state.extra_load_a = 0.0_f64;

        rail.recompute_stability();
    }
}
