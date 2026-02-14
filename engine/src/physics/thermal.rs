use crate::state::phone_state::*;
use crate::state::ids::ThermalZoneId;

/// Thermal update berbasis:
/// - heat_generation lokal
/// - dissipation ke ambient
/// - coupling antar zona
/// Stress thermal dicatat, bukan dipakai sebagai sumber panas.
pub fn step_thermal(s: &mut PhoneState, dt: f64) {
    const AMBIENT: f64 = 35.0;

    // snapshot suhu lama untuk coupling
    let prev_temps: Vec<(ThermalZoneId, f64)> =
        s.thermal.zones.iter().map(|(id, z)| (*id, z.temperature)).collect();

    for (_id, z) in s.thermal.zones.iter_mut() {

        // =======================
        // NUMERICAL SAFETY
        // =======================
        let mass = if z.thermal_mass < 1.0 { 50.0 } else { z.thermal_mass };

        // =======================
        // LOCAL HEAT GENERATION
        // =======================
        // heat_generation sudah diisi dari domain electrical / fault
        let local_heat = z.heat_generation;

        // =======================
        // COUPLING ANTAR ZONE
        // =======================
        let mut coupled_heat = 0.0;
        for (other_id, k) in z.coupling.iter() {
            if let Some((_, t_other)) = prev_temps.iter().find(|(i, _)| i == other_id) {
                coupled_heat += (*t_other - z.temperature) * k;
            }
        }

        // =======================
        // DISSIPATION KE AMBIENT
        // =======================
        let heat_out = 0.003 * (z.temperature - AMBIENT);

        // =======================
        // TEMPERATURE UPDATE
        // =======================
        let d_t = (local_heat + coupled_heat - heat_out) * dt / mass;
        z.temperature += d_t;

        // =======================
        // THERMAL STRESS ACCUMULATION
        // =======================
        s.stress.thermal += z.temperature.max(0.0) * dt * 0.001;
    }
}
