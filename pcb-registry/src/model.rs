use serde::{Deserialize, Serialize};
use serde_json::Value;

/* ============================================================
COMPONENT CATALOG - Real-world component definitions
============================================================ */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentCatalog {
    pub components: Vec<ComponentDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentDef {
    pub id: String,
    pub name: String,
    pub category: ComponentCategory,
    pub package: String,
    pub description: String,

    #[serde(default)]
    pub electrical: ComponentElectrical,

    #[serde(default)]
    pub failure_modes: Vec<FailureMode>,

    #[serde(default)]
    pub measurements: Vec<MeasurementPoint>,

    #[serde(default)]
    pub rail_connections: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ComponentCategory {
    #[serde(rename = "ic")]
    IC,
    #[serde(rename = "capacitor")]
    Capacitor,
    #[serde(rename = "resistor")]
    Resistor,
    #[serde(rename = "inductor")]
    Inductor,
    #[serde(rename = "mosfet")]
    MOSFET,
    #[serde(rename = "diode")]
    Diode,
    #[serde(rename = "connector")]
    Connector,
    #[serde(rename = "battery")]
    Battery,
    #[serde(rename = "sensor")]
    Sensor,
    #[serde(rename = "晶体")]
    Crystal,
    #[serde(rename = "led")]
    LED,
    #[serde(rename = "fuse")]
    Fuse,
    #[serde(rename = "switch")]
    Switch,
    #[serde(rename = "other")]
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ComponentElectrical {
    pub voltage_rating: Option<f64>,
    pub current_rating: Option<f64>,
    pub power_rating: Option<f64>,
    pub resistance: Option<f64>,
    pub capacitance: Option<f64>,
    pub inductance: Option<f64>,
    pub forward_voltage: Option<f64>,
    pub vgs_threshold: Option<f64>,
    pub rds_on: Option<f64>,
    pub impedance: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailureMode {
    pub name: String,
    pub probability: f64,
    pub symptoms: Vec<String>,
    pub detection_method: String,
    pub severity: FailureSeverity,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FailureSeverity {
    #[serde(rename = "critical")]
    Critical,
    #[serde(rename = "high")]
    High,
    #[serde(rename = "medium")]
    Medium,
    #[serde(rename = "low")]
    Low,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeasurementPoint {
    pub name: String,
    pub pin: String,
    pub expected_voltage: Option<f64>,
    pub tolerance: Option<f64>,
    pub mode: MeasurementMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MeasurementMode {
    #[serde(rename = "voltage")]
    Voltage,
    #[serde(rename = "resistance")]
    Resistance,
    #[serde(rename = "continuity")]
    Continuity,
    #[serde(rename = "diode")]
    Diode,
    #[serde(rename = "current")]
    Current,
}

/* ============================================================
PCB INSTANCE - Actual board with components
============================================================ */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PCBInstance {
    pub board_id: String,
    pub serial_number: String,
    pub components: Vec<PCBComponent>,
    pub rails: Vec<PCBRail>,
    pub netlist: NetList,
    pub fault_status: FaultStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PCBComponent {
    pub component_id: String,
    pub refdes: String,
    pub part_number: Option<String>,
    pub location: ComponentLocation,
    pub health: ComponentHealth,
    pub measurements: Vec<Measurement>,
    pub faults: Vec<ComponentFault>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentLocation {
    pub x: f64,
    pub y: f64,
    pub rotation: f64,
    pub layer: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentHealth {
    pub overall: f64,
    pub thermal: f64,
    pub electrical: f64,
    pub mechanical: f64,
    pub last_updated: u64,
    pub degradation_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Measurement {
    pub timestamp: u64,
    pub point: String,
    pub value: f64,
    pub expected: f64,
    pub tolerance: f64,
    pub status: MeasurementStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MeasurementStatus {
    #[serde(rename = "ok")]
    OK,
    #[serde(rename = "warning")]
    Warning,
    #[serde(rename = "error")]
    Error,
    #[serde(rename = "critical")]
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentFault {
    pub fault_type: String,
    pub detected_at: u64,
    pub severity: FailureSeverity,
    pub description: String,
    pub measurements_indicating: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PCBRail {
    pub id: String,
    pub name: String,
    pub voltage: f64,
    pub current: f64,
    pub source: RailSource,
    pub loads: Vec<String>,
    pub protection: Vec<String>,
    pub status: RailStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RailSource {
    #[serde(rename = "battery")]
    Battery,
    #[serde(rename = "pmic")]
    PMIC,
    #[serde(rename = "charger")]
    Charger,
    #[serde(rename = "boost")]
    Boost,
    #[serde(rename = "ldo")]
    LDO,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RailStatus {
    #[serde(rename = "ok")]
    OK,
    #[serde(rename = "undervoltage")]
    Undervoltage,
    #[serde(rename = "overvoltage")]
    Overvoltage,
    #[serde(rename = "disabled")]
    Disabled,
    #[serde(rename = "fault")]
    Fault,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetList {
    pub nets: Vec<Net>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Net {
    pub name: String,
    pub nodes: Vec<NetNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetNode {
    pub component: String,
    pub pin: String,
}

/* ============================================================
FAULT STATUS
============================================================ */

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FaultStatus {
    pub active_faults: Vec<ActiveFault>,
    pub resolved_faults: Vec<ResolvedFault>,
    pub health_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveFault {
    pub id: String,
    pub component: String,
    pub fault_type: String,
    pub severity: FailureSeverity,
    pub detected_at: u64,
    pub symptoms: Vec<String>,
    pub recommended_actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedFault {
    pub id: String,
    pub component: String,
    pub fault_type: String,
    pub resolved_at: u64,
    pub resolution: String,
}

/* ============================================================
ANALYSIS REQUEST/RESPONSE
============================================================ */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisRequest {
    pub board_id: String,
    pub components: Vec<ComponentMeasurementInput>,
    pub rails: Vec<RailMeasurementInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentMeasurementInput {
    pub refdes: String,
    pub measurements: Vec<MeasurementInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeasurementInput {
    pub point: String,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RailMeasurementInput {
    pub rail_id: String,
    pub voltage: f64,
    pub current: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResponse {
    pub summary: AnalysisSummary,
    pub component_analysis: Vec<ComponentAnalysis>,
    pub rail_analysis: Vec<RailAnalysis>,
    pub recommendations: Vec<String>,
    pub risk_assessment: RiskAssessment,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisSummary {
    pub overall_health: f64,
    pub fault_count: usize,
    pub warning_count: usize,
    pub critical_count: usize,
    pub estimated_repair_cost: f64,
    pub repair_difficulty: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentAnalysis {
    pub refdes: String,
    pub status: ComponentStatus,
    pub health: f64,
    pub issues: Vec<String>,
    pub recommendations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ComponentStatus {
    #[serde(rename = "healthy")]
    Healthy,
    #[serde(rename = "degraded")]
    Degraded,
    #[serde(rename = "fault")]
    Fault,
    #[serde(rename = "unknown")]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RailAnalysis {
    pub rail_id: String,
    pub status: RailStatus,
    pub voltage_deviation: f64,
    pub current_load: f64,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskAssessment {
    pub level: String,
    pub factors: Vec<String>,
    pub likelihood: f64,
    pub impact: String,
}

/* ============================================================
SEARCH & FILTER
============================================================ */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentQuery {
    pub search: Option<String>,
    pub category: Option<ComponentCategory>,
    pub rail: Option<String>,
    pub status: Option<ComponentStatus>,
    pub min_health: Option<f64>,
    pub max_health: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub components: Vec<ComponentSearchItem>,
    pub total: usize,
    pub page: usize,
    pub per_page: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentSearchItem {
    pub refdes: String,
    pub name: String,
    pub category: ComponentCategory,
    pub health: f64,
    pub status: ComponentStatus,
    pub location: ComponentLocation,
}

/* ============================================================
MANIFEST (existing - enhanced)
============================================================ */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub version: u32,
    pub boards: Vec<BoardListItem>,
    pub catalog_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardListItem {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub board_url: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub difficulty: Option<String>,
}

/* ============================================================
BOARD FILE (existing - enhanced)
============================================================ */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardFile {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub image: ImageMeta,
    pub tiles: TilesMeta,
    pub units: UnitsMeta,
    pub transform: AffineTransform,
    #[serde(default)]
    pub components_url: Option<String>,
    #[serde(default)]
    pub rails_url: Option<String>,
    #[serde(default)]
    pub topology_url: Option<String>,
    #[serde(default)]
    pub thermal_url: Option<String>,
    #[serde(default)]
    pub schematic_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageMeta {
    pub full_width_px: u32,
    pub full_height_px: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TilesMeta {
    #[serde(rename = "type")]
    pub kind: String,
    pub tile_size: u32,
    pub overlap: u32,
    pub format: String,
    pub max_level: u32,
    pub url_template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitsMeta {
    pub mm_per_px: f64,
    pub origin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AffineTransform {
    #[serde(rename = "type")]
    pub kind: String,
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub tx: f64,
    pub ty: f64,
}

/* ============================================================
COMPONENTS (existing - enhanced)
============================================================ */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentsFile {
    pub version: u32,
    #[serde(default)]
    pub components: Vec<ComponentItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentItem {
    pub id: String,
    pub refdes: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub bbox: Option<BBox>,
    #[serde(default)]
    pub shape: Option<ComponentShape>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub hints: Option<Value>,
    #[serde(default)]
    pub category: Option<ComponentCategory>,
    #[serde(default)]
    pub electrical: Option<ComponentElectrical>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentShape {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub points: Vec<[f64; 2]>,
}

/* ============================================================
RAILS (existing - enhanced)
============================================================ */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RailsFile {
    pub version: u32,
    #[serde(default)]
    pub defaults: Option<Value>,
    #[serde(default)]
    pub psu_injection: Option<PsuInjection>,
    #[serde(default)]
    pub rails: Vec<RailItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RailItem {
    pub id: String,
    pub label: String,
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub overlay: Option<RailOverlay>,
    #[serde(default)]
    pub probe_points: Vec<ProbePoint>,
    #[serde(default)]
    pub source: Option<RailSource>,
    #[serde(default)]
    pub expected: Option<RailExpected>,
    #[serde(default)]
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RailExpected {
    #[serde(default)]
    pub voltage_v: Option<VoltageRange>,
    #[serde(default)]
    pub diode_drop_v: Option<VoltageRange>,
    #[serde(default)]
    pub r2g_ohms: Option<R2gOhms>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum R2gOhms {
    Number(f64),
    Object { nominal: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VoltageRange {
    pub min: Option<f64>,
    pub max: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbePoint {
    pub x: f64,
    pub y: f64,
    pub id: Option<String>,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RailOverlay {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub polys: Vec<Vec<[f64; 2]>>,
    #[serde(flatten)]
    #[serde(default)]
    pub extra: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PsuInjection {
    pub enabled: bool,
    pub path: PsuInjectionPath,
    pub series_resistance_ohm: f64,
    pub max_voltage_v: f64,
    pub max_current_a: f64,
    #[serde(default)]
    pub backfeed: Option<PsuBackfeed>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PsuInjectionPath {
    Single(String),
    Multiple(Vec<String>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PsuBackfeed {
    pub allowed: bool,
    #[serde(default)]
    pub targets: Vec<String>,
    pub equiv_resistance_ohm: f64,
}

/* ============================================================
TOPOLOGY (power rail topology)
============================================================ */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyFile {
    pub version: u32,
    #[serde(default)]
    pub nodes: Vec<String>,
    #[serde(default)]
    pub edges: Vec<TopologyEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyEdge {
    pub from: String,
    pub to: String,
    pub kind: String,
}

/* ============================================================
THERMAL (thermal zones)
============================================================ */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThermalFile {
    pub version: u32,
    #[serde(default = "default_ambient_c")]
    pub ambient_c: f64,
    #[serde(default)]
    pub zones: Vec<ThermalZone>,
    #[serde(default)]
    pub links: Vec<ThermalLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThermalZone {
    pub id: String,
    #[serde(default)]
    pub components: Vec<String>,
    #[serde(default)]
    pub thermal_mass: Option<f64>,
    #[serde(default)]
    pub heat_dissipation: Option<f64>,
    #[serde(default)]
    pub convection_coefficient: Option<f64>,
    #[serde(default)]
    pub surface_area: Option<f64>,
    #[serde(default)]
    pub is_heatsink: Option<bool>,
    #[serde(default)]
    pub throttling_threshold: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThermalLink {
    pub a: String,
    pub b: String,
    pub conductance: f64,
}

fn default_ambient_c() -> f64 {
    27.0
}
