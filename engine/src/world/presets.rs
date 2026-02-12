use crate::world::profile::WorldProfile;

pub const IDEAL_BENCH: WorldProfile = WorldProfile {
    name: "Ideal Bench",
    ambient_temperature: 25.0,
    humidity_factor: 0.0,
    emi_noise_floor: 0.0,
    device_age_factor: 0.0,
    prior_repair_factor: 0.0,
    psu_quality: 1.0,
    ground_integrity: 1.0,
    thermal_dissipation: 1.0,
    thermal_coupling: 1.0,
    measurement_bias: 0.0,
};

pub const HOT_HUMID_WORKSHOP: WorldProfile = WorldProfile {
    name: "Hot & Humid Workshop",
    ambient_temperature: 35.0,
    humidity_factor: 0.8,
    emi_noise_floor: 0.05,
    device_age_factor: 0.2,
    prior_repair_factor: 0.1,
    psu_quality: 0.8,
    ground_integrity: 0.9,
    thermal_dissipation: 0.7,
    thermal_coupling: 1.2,
    measurement_bias: 0.2,
};

pub const PREVIOUSLY_REPAIRED_DEVICE: WorldProfile = WorldProfile {
    name: "Previously Repaired Device",
    ambient_temperature: 30.0,
    humidity_factor: 0.3,
    emi_noise_floor: 0.02,
    device_age_factor: 0.5,
    prior_repair_factor: 0.6,
    psu_quality: 0.9,
    ground_integrity: 0.85,
    thermal_dissipation: 0.85,
    thermal_coupling: 1.1,
    measurement_bias: 0.3,
};
