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

pub const BATTERY_DRAIN_SCENARIO: WorldProfile = WorldProfile {
    name: "Battery Drain Scenario",
    ambient_temperature: 32.0,
    humidity_factor: 0.7,
    emi_noise_floor: 0.03,
    device_age_factor: 0.4,
    prior_repair_factor: 0.3,
    psu_quality: 0.75,
    ground_integrity: 0.8,
    thermal_dissipation: 0.75,
    thermal_coupling: 1.15,
    measurement_bias: 0.25,
};

pub const CHARGING_ISSUE_SCENARIO: WorldProfile = WorldProfile {
    name: "Charging Issue Scenario",
    ambient_temperature: 28.0,
    humidity_factor: 0.5,
    emi_noise_floor: 0.04,
    device_age_factor: 0.45,
    prior_repair_factor: 0.5,
    psu_quality: 0.7,
    ground_integrity: 0.75,
    thermal_dissipation: 0.8,
    thermal_coupling: 1.1,
    measurement_bias: 0.3,
};

pub const RF_UNSTABLE_SCENARIO: WorldProfile = WorldProfile {
    name: "RF Unstable Environment",
    ambient_temperature: 34.0,
    humidity_factor: 0.78,
    emi_noise_floor: 0.08,
    device_age_factor: 0.35,
    prior_repair_factor: 0.45,
    psu_quality: 0.78,
    ground_integrity: 0.72,
    thermal_dissipation: 0.82,
    thermal_coupling: 1.35,
    measurement_bias: 0.25,
};

pub const THERMAL_SHUTDOWN_SCENARIO: WorldProfile = WorldProfile {
    name: "Thermal Shutdown Risk",
    ambient_temperature: 38.0,
    humidity_factor: 0.6,
    emi_noise_floor: 0.03,
    device_age_factor: 0.5,
    prior_repair_factor: 0.2,
    psu_quality: 0.85,
    ground_integrity: 0.9,
    thermal_dissipation: 0.5,
    thermal_coupling: 1.5,
    measurement_bias: 0.15,
};

pub const DEAD_DEVICE_SCENARIO: WorldProfile = WorldProfile {
    name: "Dead Device - No Power",
    ambient_temperature: 25.0,
    humidity_factor: 0.4,
    emi_noise_floor: 0.01,
    device_age_factor: 0.6,
    prior_repair_factor: 0.7,
    psu_quality: 0.9,
    ground_integrity: 0.8,
    thermal_dissipation: 0.9,
    thermal_coupling: 1.0,
    measurement_bias: 0.1,
};

pub fn get_profile_by_scenario(scenario_id: &str) -> &'static WorldProfile {
    match scenario_id {
        "power_drain_intermit" => &BATTERY_DRAIN_SCENARIO,
        "fake_charging_drop" => &CHARGING_ISSUE_SCENARIO,
        "rf_no_service_intermit" => &RF_UNSTABLE_SCENARIO,
        "thermal_shutdown" => &THERMAL_SHUTDOWN_SCENARIO,
        "no_power_at_all" => &DEAD_DEVICE_SCENARIO,
        "hot_humid" => &HOT_HUMID_WORKSHOP,
        "previously_repaired" => &PREVIOUSLY_REPAIRED_DEVICE,
        _ => &IDEAL_BENCH,
    }
}
