pub mod bootstrap;
pub mod electrical;
pub mod fatigue;
pub mod ids;
pub mod invariants;
pub mod material;
pub mod measurement_log;
pub mod phone_state;
pub mod stress;
use std::collections::HashMap;

pub use stress::StressState;
#[derive(Clone, Debug)]
pub struct ThermalZone {
    pub id: String,
    pub temp_c: f64,
    pub thermal_mass: f64,
    pub heat_dissipation: f64,
    pub convection_coefficient: f64,
    pub surface_area: f64,
    pub is_heatsink: bool,
    pub throttling_threshold: f64,
}

#[derive(Clone, Debug)]
pub struct ThermalLink {
    pub a: String,
    pub b: String,
    pub conductance: f64,
}

#[derive(Clone, Debug, Default)]
pub struct ThermalState {
    pub ambient_c: f64,
    pub zones: HashMap<String, ThermalZone>,
    pub links: Vec<ThermalLink>,
    pub rail_zone: HashMap<String, String>,
    pub throttled_zones: HashMap<String, f64>,
    pub fan_speed: f64,
}

impl ThermalState {
    pub fn new() -> Self {
        Self {
            ambient_c: 27.0,
            zones: HashMap::new(),
            links: vec![],
            rail_zone: HashMap::new(),
            throttled_zones: HashMap::new(),
            fan_speed: 0.0,
        }
    }

    pub fn ensure_zone(&mut self, id: &str) {
        self.zones.entry(id.to_string()).or_insert(ThermalZone {
            id: id.to_string(),
            temp_c: self.ambient_c,
            thermal_mass: 5.0,
            heat_dissipation: 0.3,
            convection_coefficient: 0.05,
            surface_area: 0.001,
            is_heatsink: false,
            throttling_threshold: 85.0,
        });
    }

    pub fn average(&self) -> f64 {
        if self.zones.is_empty() {
            return self.ambient_c;
        }
        let sum: f64 = self.zones.values().map(|z| z.temp_c).sum();
        sum / self.zones.len() as f64
    }

    pub fn add_power(&mut self, zone_id: &str, p_w: f64, power_acc: &mut HashMap<String, f64>) {
        let z = zone_id.to_string();
        *power_acc.entry(z).or_insert(0.0) += p_w.max(0.0);
    }

    pub fn step(&mut self, dt: f64, power_w: &HashMap<String, f64>) -> f64 {
        let mut d_t: HashMap<String, f64> = HashMap::new();
        let fan_cooling = self.fan_speed * 0.5;

        for (id, z) in self.zones.iter() {
            let p = *power_w.get(id).unwrap_or(&0.0);

            let conduction_loss = z.heat_dissipation * (z.temp_c - self.ambient_c);

            let temp_diff = z.temp_c - self.ambient_c;
            let natural_convection = z.convection_coefficient * z.surface_area * temp_diff;
            let forced_convection = fan_cooling * z.surface_area * temp_diff.max(0.0);

            let total_loss = conduction_loss + natural_convection + forced_convection;
            let net = p - total_loss;
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

                if z.temp_c >= z.throttling_threshold && z.throttling_threshold > 0.0 {
                    let throttle_factor =
                        ((z.throttling_threshold + 20.0 - z.temp_c) / 20.0).clamp(0.0, 1.0);
                    *self.throttled_zones.entry(id.clone()).or_insert(1.0) = throttle_factor;
                } else {
                    self.throttled_zones.remove(&id);
                }

                stress_delta += z.temp_c.max(0.0) * dt * 0.001;
            }
        }
        stress_delta
    }

    pub fn get_throttle_factor(&self, zone_id: &str) -> f64 {
        self.throttled_zones.get(zone_id).copied().unwrap_or(1.0)
    }

    pub fn set_fan_speed(&mut self, speed: f64) {
        self.fan_speed = speed.clamp(0.0, 1.0);
    }
}
