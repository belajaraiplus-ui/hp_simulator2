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

pub const STABLE_LAB: WorldProfile = WorldProfile {
    name: "Stable Lab",
    ambient_temperature: 24.0,
    humidity_factor: 0.1,
    emi_noise_floor: 0.005,
    device_age_factor: 0.1,
    prior_repair_factor: 0.1,
    psu_quality: 0.98,
    ground_integrity: 0.98,
    thermal_dissipation: 0.95,
    thermal_coupling: 1.0,
    measurement_bias: 0.03,
};

pub const NOISY_POWER_ENV: WorldProfile = WorldProfile {
    name: "Noisy Power Environment",
    ambient_temperature: 33.0,
    humidity_factor: 0.6,
    emi_noise_floor: 0.09,
    device_age_factor: 0.35,
    prior_repair_factor: 0.3,
    psu_quality: 0.72,
    ground_integrity: 0.74,
    thermal_dissipation: 0.8,
    thermal_coupling: 1.25,
    measurement_bias: 0.32,
};

pub const POST_WATER_EXPOSURE: WorldProfile = WorldProfile {
    name: "Post Water Exposure",
    ambient_temperature: 32.0,
    humidity_factor: 0.9,
    emi_noise_floor: 0.06,
    device_age_factor: 0.55,
    prior_repair_factor: 0.35,
    psu_quality: 0.8,
    ground_integrity: 0.7,
    thermal_dissipation: 0.72,
    thermal_coupling: 1.3,
    measurement_bias: 0.35,
};

pub fn get_profile_by_scenario(scenario_id: &str) -> &'static WorldProfile {
    match scenario_id {
        // Legacy IDs used by older UI
        "power_drain_intermit" => &BATTERY_DRAIN_SCENARIO,
        "fake_charging_drop" => &CHARGING_ISSUE_SCENARIO,
        "thermal_shutdown" => &THERMAL_SHUTDOWN_SCENARIO,
        "no_power_at_all" => &DEAD_DEVICE_SCENARIO,
        "bootloop" => &DEAD_DEVICE_SCENARIO,
        "usb_not_recognized" => &PREVIOUSLY_REPAIRED_DEVICE,
        "audio_no_sound" => &PREVIOUSLY_REPAIRED_DEVICE,
        "touch_not_responsive" => &PREVIOUSLY_REPAIRED_DEVICE,

        // Current scenario IDs (HOT_HUMID_WORKSHOP family)
        "display_ghost_touch_emi"
        | "logic_timing_margin_collapse_under_heat"
        | "power_abnormal_idle_current_draw"
        | "power_boot_only_under_external_power"
        | "power_thermal_escalation_during_charging"
        | "rf_no_service_intermit"
        | "storage_progressive_degradation"
        | "thermal_localized_hotspot"
        | "water_damage_progressive" => &HOT_HUMID_WORKSHOP,

        // Current scenario IDs (NOISY_POWER_ENV family)
        "battery_mid_soc_sudden_shutdown"
        | "display_emi_induced_ghost_touch"
        | "logic_random_reset_without_brownout"
        | "power_fake_charging_charge_illusion"
        | "rf_power_path_instability"
        | "swhw_interaction_runaway" => &NOISY_POWER_ENV,

        // Current scenario IDs (POST_PREVIOUS_REPAIR family)
        "battery_sense_data_instability"
        | "display_backlight_power_path_failure"
        | "display_intermittent_touch_zones"
        | "display_system_alive_no_image"
        | "logic_peripheral_bus_contention"
        | "mechanical_intermittent_contact"
        | "power_total_failure_zero_current"
        | "rf_no_service_intermittent"
        | "thermal_systemic_inefficiency" => &PREVIOUSLY_REPAIRED_DEVICE,

        // Current scenario IDs (STABLE_LAB family)
        "battery_voltage_capacity_mismatch"
        | "memory_instability_random_boot_failure"
        | "rf_baseband_functional_but_isolated"
        | "security_secure_subsystem_lockout" => &STABLE_LAB,

        // Current scenario IDs (POST_WATER_EXPOSURE family)
        "water_progressive_electrochemical_corrosion" => &POST_WATER_EXPOSURE,

        // Manual aliases
        "hot_humid" => &HOT_HUMID_WORKSHOP,
        "previously_repaired" | "post_previous_repair" => &PREVIOUSLY_REPAIRED_DEVICE,
        "stable_lab" => &STABLE_LAB,
        "noisy_power_env" => &NOISY_POWER_ENV,
        "post_water_exposure" => &POST_WATER_EXPOSURE,
        _ => &IDEAL_BENCH,
    }
}
