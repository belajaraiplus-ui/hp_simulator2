use crate::api::types::MeterMode;
use crate::power::rail::Rail;
use crate::state::ids::RailId;
use std::collections::HashMap;

#[derive(Debug, Default)]
pub struct PowerInput {
    pub voltage: f64,
    pub current_limit: f64,
    pub psu_series_r_ohm: f64,
    pub enabled: bool,
    pub measured_current: f64,
    pub vchg_enabled: bool,
    pub vchg_voltage: f64,
    pub target_rail: Option<RailId>,
    pub psu_mode: PsuMode,
    pub ovp_threshold: f64,
    pub uvp_threshold: f64,
    pub ocp_threshold: f64,
    pub output_ripple_pp: f64,
    pub load_response_time: f64,
    pub psu_temperature: f64,
    pub cv_setpoint: f64,
    pub cc_setpoint: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PsuMode {
    #[default]
    CV,
    CC,
    Off,
    Fault,
}

impl PowerInput {
    pub fn new() -> Self {
        Self {
            voltage: 0.0,
            current_limit: 0.0,
            psu_series_r_ohm: 0.05,
            enabled: false,
            measured_current: 0.0,
            vchg_enabled: false,
            vchg_voltage: 5.0,
            target_rail: None,
            psu_mode: PsuMode::Off,
            ovp_threshold: 6.0,
            uvp_threshold: 0.0,
            ocp_threshold: 0.0,
            output_ripple_pp: 0.05,
            load_response_time: 0.001,
            psu_temperature: 25.0,
            cv_setpoint: 5.0,
            cc_setpoint: 2.0,
        }
    }
}

#[derive(Debug)]
pub struct ElectricalState {
    pub rails: HashMap<RailId, Rail>,
    pub ground_integrity: f64,
    pub transient_noise: f64,
    pub extra_load_a: f64,
    pub input: PowerInput,
    pub tick: u64,
    pub meter_attached: bool,
    pub meter_mode: Option<MeterMode>,
    pub meter_target: Option<RailId>,
    pub meter_reading: f64,
    pub meter_resolution: f64,
    pub meter_beep: bool,
    pub inrush_tracking: HashMap<RailId, InrushState>,
    pub dynamic_load: DynamicLoadState,
}

#[derive(Debug, Clone, Copy)]
pub struct InrushState {
    pub active: bool,
    pub start_time: f64,
    pub peak_current: f64,
    pub decay_time_constant: f64,
}

impl Default for InrushState {
    fn default() -> Self {
        Self {
            active: false,
            start_time: 0.0,
            peak_current: 0.0,
            decay_time_constant: 0.05,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct DynamicLoadState {
    pub base_cpu_load: f64,
    pub current_cpu_load: f64,
    pub charging_load: f64,
    pub peripheral_load: f64,
    pub time_since_last_update: f64,
}

impl Default for DynamicLoadState {
    fn default() -> Self {
        Self {
            base_cpu_load: 0.1,
            current_cpu_load: 0.1,
            charging_load: 0.0,
            peripheral_load: 0.05,
            time_since_last_update: 0.0,
        }
    }
}

impl ElectricalState {
    pub fn ensure_rail(&mut self, id: RailId) -> &mut Rail {
        self.rails.entry(id).or_insert_with(|| Rail::new(id))
    }

    pub fn total_load(&self) -> f64 {
        self.rails.values().map(|r| r.state.current).sum()
    }

    pub fn set_input_measured_current(&mut self, current: f64) {
        self.input.measured_current = current;
    }

    pub fn apply_psu_config(&mut self, voltage: f64, current_limit: f64, enabled: bool) {
        self.input.voltage = voltage;
        self.input.current_limit = current_limit;
        self.input.enabled = enabled;
        self.input.cv_setpoint = voltage;
        self.input.cc_setpoint = current_limit;

        if enabled {
            self.input.psu_mode = PsuMode::CV;
        } else {
            self.input.psu_mode = PsuMode::Off;
        }
    }

    pub fn set_psu_ovp(&mut self, threshold: f64) {
        self.input.ovp_threshold = threshold;
    }

    pub fn set_psu_uvp(&mut self, threshold: f64) {
        self.input.uvp_threshold = threshold;
    }

    pub fn set_psu_ripple(&mut self, ripple_vpp: f64) {
        self.input.output_ripple_pp = ripple_vpp;
    }

    pub fn set_psu_mode(&mut self, mode: PsuMode) {
        self.input.psu_mode = mode;
    }

    pub fn get_psu_status(&self) -> (&PsuMode, f64, f64, f64) {
        (
            &self.input.psu_mode,
            self.input.measured_current,
            self.input.voltage,
            self.input.psu_temperature,
        )
    }

    pub fn trigger_inrush(&mut self, rail_id: RailId, peak_current: f64, time: f64) {
        let inrush = InrushState {
            active: true,
            start_time: time,
            peak_current,
            decay_time_constant: 0.05,
        };
        self.inrush_tracking.insert(rail_id, inrush);
    }

    pub fn get_inrush_current(&mut self, rail_id: RailId, time: f64) -> f64 {
        if let Some(inrush) = self.inrush_tracking.get_mut(&rail_id) {
            if inrush.active {
                let elapsed = time - inrush.start_time;
                let decay = (-elapsed / inrush.decay_time_constant).exp();
                let current = inrush.peak_current * decay;

                if elapsed > 0.5 {
                    inrush.active = false;
                }

                return current;
            }
        }
        0.0
    }

    pub fn update_dynamic_load(&mut self, dt: f64, cpu_activity: f64) {
        self.dynamic_load.time_since_last_update += dt;

        let target_cpu = self.dynamic_load.base_cpu_load + cpu_activity;
        let current_cpu = self.dynamic_load.current_cpu_load;

        let smoothing = 1.0 - (-dt * 5.0).exp();
        self.dynamic_load.current_cpu_load = current_cpu + (target_cpu - current_cpu) * smoothing;

        self.dynamic_load.time_since_last_update = 0.0;
    }

    pub fn get_dynamic_load(&self) -> f64 {
        self.dynamic_load.current_cpu_load
            + self.dynamic_load.charging_load
            + self.dynamic_load.peripheral_load
    }

    pub fn set_charging_load(&mut self, charging: bool) {
        self.dynamic_load.charging_load = if charging { 0.5 } else { 0.0 };
    }
}

impl Default for ElectricalState {
    fn default() -> Self {
        Self {
            rails: HashMap::new(),
            ground_integrity: 1.0,
            transient_noise: 0.0,
            extra_load_a: 0.0,
            input: PowerInput::new(),
            tick: 0,
            meter_attached: false,
            meter_mode: None,
            meter_target: None,
            meter_reading: 0.0,
            meter_resolution: 0.0,
            meter_beep: false,
            inrush_tracking: HashMap::new(),
            dynamic_load: DynamicLoadState::default(),
        }
    }
}
