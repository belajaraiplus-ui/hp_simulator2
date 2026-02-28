use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApiVersion {
    V1,
}

impl ApiVersion {
    pub fn current() -> Self {
        Self::V1
    }

    pub fn is_valid(v: Option<u32>) -> bool {
        matches!(v, Some(1))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionKind {
    Step,
    Measure,
    Snapshot,
    Stop,
    Tool,
    Scenario,
}

impl ActionKind {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "step" => Some(Self::Step),
            "measure" => Some(Self::Measure),
            "snapshot" => Some(Self::Snapshot),
            "stop" => Some(Self::Stop),
            "tool" => Some(Self::Tool),
            "scenario" => Some(Self::Scenario),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Step => "step",
            Self::Measure => "measure",
            Self::Snapshot => "snapshot",
            Self::Stop => "stop",
            Self::Tool => "tool",
            Self::Scenario => "scenario",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidJson,
    InvalidVersion,
    InvalidKind,
    NotInitialized,
    LockFailed,
    InvalidParams,
    UnknownAction,
    MeasurementFailed,
    ToolFailed,
    ScenarioFailed,
    InternalError,
}

impl ErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::InvalidJson => "ERR_INVALID_JSON",
            Self::InvalidVersion => "ERR_INVALID_VERSION",
            Self::InvalidKind => "ERR_INVALID_KIND",
            Self::NotInitialized => "ERR_NOT_INITIALIZED",
            Self::LockFailed => "ERR_LOCK_FAILED",
            Self::InvalidParams => "ERR_INVALID_PARAMS",
            Self::UnknownAction => "ERR_UNKNOWN_ACTION",
            Self::MeasurementFailed => "ERR_MEASUREMENT_FAILED",
            Self::ToolFailed => "ERR_TOOL_FAILED",
            Self::ScenarioFailed => "ERR_SCENARIO_FAILED",
            Self::InternalError => "ERR_INTERNAL_ERROR",
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct ApiError {
    pub ok: bool,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{{\"ok\":false,\"code\":\"{}\",\"message\":\"{}\"}}",
            self.code,
            self.message.replace('"', "\\\"")
        )
    }
}

impl std::fmt::Debug for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ApiError({}, {})", self.code, self.message)
    }
}

impl ApiError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            code: code.as_str().to_string(),
            message: message.into(),
            details: None,
        }
    }

    pub fn to_json_string(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| {
            format!(
                "{{\"ok\":false,\"code\":\"{}\",\"message\":\"{}\"}}",
                self.code,
                self.message.replace('"', "\\\"")
            )
        })
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }

    pub fn invalid_json(e: &str) -> Self {
        Self::new(ErrorCode::InvalidJson, format!("Invalid JSON: {}", e))
    }

    pub fn invalid_version(v: Option<u32>) -> Self {
        let v_str = v
            .map(|n| n.to_string())
            .unwrap_or_else(|| "null".to_string());
        Self::new(
            ErrorCode::InvalidVersion,
            format!("Invalid API version: {}. Supported: 1", v_str),
        )
    }

    pub fn invalid_kind(kind: &str) -> Self {
        Self::new(
            ErrorCode::InvalidKind,
            format!(
                "Invalid action kind: '{}'. Valid: step, measure, snapshot, stop, tool, scenario",
                kind
            ),
        )
    }

    pub fn not_initialized() -> Self {
        Self::new(
            ErrorCode::NotInitialized,
            "Engine not initialized. Call init() first.",
        )
    }

    pub fn lock_failed() -> Self {
        Self::new(
            ErrorCode::LockFailed,
            "Failed to acquire engine context lock.",
        )
    }

    pub fn invalid_params(msg: &str) -> Self {
        Self::new(ErrorCode::InvalidParams, msg)
    }

    pub fn unknown_action(kind: &str) -> Self {
        Self::new(
            ErrorCode::UnknownAction,
            format!("Unhandled action: {}", kind),
        )
    }

    pub fn measurement_failed(msg: &str) -> Self {
        Self::new(ErrorCode::MeasurementFailed, msg)
    }

    pub fn tool_failed(msg: &str) -> Self {
        Self::new(ErrorCode::ToolFailed, msg)
    }

    pub fn scenario_failed(msg: &str) -> Self {
        Self::new(ErrorCode::ScenarioFailed, msg)
    }

    pub fn internal_error(msg: &str) -> Self {
        Self::new(ErrorCode::InternalError, msg)
    }
}

impl From<serde_json::Error> for ApiError {
    fn from(e: serde_json::Error) -> Self {
        ApiError::invalid_json(&e.to_string())
    }
}

#[derive(Serialize, Deserialize)]
pub struct ApiResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub measurement: Option<Value>,
}

impl ApiResponse {
    pub fn ok() -> Self {
        Self {
            ok: true,
            code: None,
            message: None,
            snapshot: None,
            measurement: None,
        }
    }

    pub fn with_snapshot(mut self, snapshot: Value) -> Self {
        self.snapshot = Some(snapshot);
        self
    }

    pub fn with_measurement(mut self, measurement: Value) -> Self {
        self.measurement = Some(measurement);
        self
    }

    pub fn with_message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }

    pub fn error(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            code: Some(code.as_str().to_string()),
            message: Some(message.into()),
            snapshot: None,
            measurement: None,
        }
    }

    pub fn to_json_string(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| format!("{{\"ok\":{}}}", self.ok))
    }
}

impl std::fmt::Display for ApiResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_json_string())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActionRequest {
    pub version: Option<u32>,
    pub kind: String,
    pub tool: Option<String>,
    pub params: Option<Value>,
    pub tool_action: Option<ToolAction>,
    pub scenario: Option<String>,
}

impl ActionRequest {
    pub fn validate(&self) -> Result<(), ApiError> {
        if !ApiVersion::is_valid(self.version) {
            return Err(ApiError::invalid_version(self.version));
        }

        if self.kind.is_empty() {
            return Err(ApiError::invalid_kind("empty"));
        }

        if ActionKind::from_str(&self.kind).is_none() {
            return Err(ApiError::invalid_kind(&self.kind));
        }

        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActionResult {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MeterMode {
    Voltage,
    Resistance,
    Continuity,
    Diode,
    Current,
    Temperature,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum ToolAction {
    SetPSUVoltage {
        voltage: f64,
    },
    SetPSUCurrent {
        current: f64,
    },
    ReadPSU {},
    TogglePSU {
        enabled: bool,
    },
    SetPSUTargetRail {
        rail: String,
    },
    ClearPSUTargetRail {},
    SetPSUMode {
        mode: String,
    },
    SetPSUOVP {
        threshold: f64,
    },
    SetPSUUVP {
        threshold: f64,
    },
    SetPSURipple {
        ripple_vpp: f64,
    },
    ResetPSUFault {},
    LoadTopologyGraph {
        topology: Value,
    },
    ToggleVCHG {
        enabled: bool,
    },
    SetVCHGVoltage {
        voltage: f64,
    },
    MultimeterMeasure {
        mode: MeterMode,
        a: String,
        b: Option<String>,
    },
    MultimeterAttach {
        mode: MeterMode,
        point: String,
    },
    MultimeterDetach {},
    SetAmbientTemp {
        ambient_c: f64,
    },
    UpsertThermalZone {
        id: String,
        thermal_mass: f64,
        heat_dissipation: f64,
    },
    SetThermalLinks {
        links: Vec<(String, String, f64)>, // (a, b, conductance)
    },
    SetRailThermalZone {
        rail: String,
        zone: String,
    },
    SetCPULoad {
        load: f64,
    },
    SetCharging {
        charging: bool,
    },
    SetRailFuse {
        rail: String,
        rating_a: f64,
    },
    SetRailOCP {
        rail: String,
        threshold_a: f64,
        delay_s: f64,
    },
    BlowRailFuse {
        rail: String,
    },
    ResetRailFuse {
        rail: String,
    },
    AddParallelRegulator {
        target: String,
        source: String,
        current_limit_a: f64,
    },
    SetFanSpeed {
        speed: f64,
    },
    SetZoneThrottling {
        zone: String,
        threshold_c: f64,
    },
}
