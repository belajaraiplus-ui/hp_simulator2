#![allow(dead_code)]

use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct ThermalZone {
    pub id: String,
    pub temp_c: f64,
    pub thermal_mass: f64,
    pub heat_dissipation: f64,
}

#[derive(Clone, Debug)]
pub struct ThermalLink {
    pub a: String,
    pub b: String,
    pub conductance: f64,
}

#[derive(Clone, Debug)]
pub struct ThermalState {
    pub ambient_c: f64,
    pub zones: HashMap<String, ThermalZone>,
    pub links: Vec<ThermalLink>,
    pub rail_zone: HashMap<String, String>,
}

impl ThermalState {
    pub fn new() -> Self {
        Self {
            ambient_c: 27.0,
            zones: HashMap::new(),
            links: vec![],
            rail_zone: HashMap::new(),
        }
    }

    pub fn ensure_zone(&mut self, id: &str) {
        self.zones.entry(id.to_string()).or_insert(ThermalZone {
            id: id.to_string(),
            temp_c: self.ambient_c,
            thermal_mass: 5.0,
            heat_dissipation: 0.3,
        });
    }

    pub fn add_power(&mut self, zone_id: &str, p_w: f64, power_acc: &mut HashMap<String, f64>) {
        let z = zone_id.to_string();
        *power_acc.entry(z).or_insert(0.0) += p_w.max(0.0);
    }

    pub fn step(&mut self, dt: f64, power_w: &HashMap<String, f64>) -> f64 {
        let mut d_t: HashMap<String, f64> = HashMap::new();

        for (id, z) in self.zones.iter() {
            let p = *power_w.get(id).unwrap_or(&0.0);
            let loss = z.heat_dissipation * (z.temp_c - self.ambient_c);
            let net = p - loss;
            let m = z.thermal_mass.max(1e-6);
            d_t.insert(id.clone(), (net / m) * dt);
        }

        for l in &self.links {
            if let (Some(za), Some(zb)) = (self.zones.get(&l.a), self.zones.get(&l.b)) {
                let g = l.conductance.max(0.0);
                let flow = g * (za.temp_c - zb.temp_c);
                let ma = za.thermal_mass.max(1e-6);
                let mb = zb.thermal_mass.max(1e-6);
                *d_t.entry(l.a.clone()).or_insert(0.0) += (-flow / ma) * dt;
                *d_t.entry(l.b.clone()).or_insert(0.0) += (flow / mb) * dt;
            }
        }

        let mut stress_delta = 0.0;
        for (id, delta) in d_t {
            if let Some(z) = self.zones.get_mut(&id) {
                z.temp_c = (z.temp_c + delta).clamp(-50.0_f64, 200.0_f64);
                stress_delta += z.temp_c.max(0.0) * dt * 0.001;
            }
        }
        stress_delta
    }
}