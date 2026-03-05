use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand, ValueEnum};
use rand::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Parser)]
#[command(name = "calibration-cli")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Ingest {
        #[arg(long)]
        dataset: PathBuf,
    },
    Simulate {
        #[arg(long)]
        dataset: PathBuf,
        #[arg(long)]
        config: PathBuf,
    },
    Fit {
        #[arg(long)]
        dataset: PathBuf,
        #[arg(long)]
        config: PathBuf,
        #[arg(long)]
        out: PathBuf,
        #[arg(long, value_enum, default_value_t = FitMode::FullFit)]
        mode: FitMode,
    },
    Report {
        #[arg(long)]
        dataset: PathBuf,
        #[arg(long)]
        config: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum FitMode {
    QuickFit,
    FullFit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CalibrationConfig {
    seed: u64,
    noise: NoiseParams,
    leakage: LeakageParams,
    thermal: ThermalParams,
    bounds: Bounds,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NoiseParams {
    measurement_offset: f64,
    measurement_jitter: f64,
    current_dependent_bias: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LeakageParams {
    leakage_resistance_per_domain: RailVoltage,
    thermal_leakage_coefficient: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ThermalParams {
    thermal_mass: f64,
    heat_dissipation_factor: f64,
    thermal_coupling_matrix: [[f64; 3]; 3],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Bounds {
    measurement_offset: [f64; 2],
    measurement_jitter: [f64; 2],
    current_dependent_bias: [f64; 2],
    leakage_resistance_per_domain: [f64; 2],
    thermal_leakage_coefficient: [f64; 2],
    thermal_mass: [f64; 2],
    heat_dissipation_factor: [f64; 2],
    thermal_coupling_matrix: [f64; 2],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MeasurementTrace {
    metadata: Metadata,
    scenario: Scenario,
    quality: Quality,
    trace: Vec<Sample>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Metadata {
    board_id: String,
    ambient_temp_c: f64,
    humidity: f64,
    battery_soc: f64,
    charger_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Scenario {
    use_case: String,
    world_profile: String,
    initial_fault_assumption: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Quality {
    instrument_grade: String,
    missing_data_policy: String,
    outlier_policy: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Sample {
    timestamp_ms: f64,
    rail_voltage_v: RailVoltage,
    input_current_a: f64,
    surface_temp_c: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RailVoltage {
    #[serde(rename = "VBAT")]
    vbat: f64,
    #[serde(rename = "VBUS")]
    vbus: f64,
    #[serde(rename = "VSYS")]
    vsys: f64,
}

#[derive(Debug, Clone, Serialize)]
struct Metrics {
    voltage_mae: RailVoltage,
    current_mape: f64,
    thermal_mae: f64,
    composite_score: f64,
}

#[derive(Default)]
struct Acc {
    vbat_abs: f64,
    vbus_abs: f64,
    vsys_abs: f64,
    i_pct: f64,
    t_abs: f64,
    n: f64,
    t_n: f64,
}

fn clamp(v: f64, b: [f64; 2]) -> f64 {
    v.max(b[0]).min(b[1])
}

fn enforce_bounds(cfg: &mut CalibrationConfig) {
    cfg.noise.measurement_offset = clamp(cfg.noise.measurement_offset, cfg.bounds.measurement_offset);
    cfg.noise.measurement_jitter = clamp(cfg.noise.measurement_jitter, cfg.bounds.measurement_jitter);
    cfg.noise.current_dependent_bias =
        clamp(cfg.noise.current_dependent_bias, cfg.bounds.current_dependent_bias);
    cfg.leakage.thermal_leakage_coefficient =
        clamp(cfg.leakage.thermal_leakage_coefficient, cfg.bounds.thermal_leakage_coefficient);
    cfg.thermal.thermal_mass = clamp(cfg.thermal.thermal_mass, cfg.bounds.thermal_mass);
    cfg.thermal.heat_dissipation_factor =
        clamp(cfg.thermal.heat_dissipation_factor, cfg.bounds.heat_dissipation_factor);
    for val in [
        &mut cfg.leakage.leakage_resistance_per_domain.vbat,
        &mut cfg.leakage.leakage_resistance_per_domain.vbus,
        &mut cfg.leakage.leakage_resistance_per_domain.vsys,
    ] {
        *val = clamp(*val, cfg.bounds.leakage_resistance_per_domain);
    }
    for row in cfg.thermal.thermal_coupling_matrix.iter_mut() {
        for item in row.iter_mut() {
            *item = clamp(*item, cfg.bounds.thermal_coupling_matrix);
        }
    }
}

fn read_dataset(dataset_root: &Path) -> Result<Vec<MeasurementTrace>> {
    let mut traces = Vec::new();
    for use_case in ["no_power", "fake_charging", "thermal_runaway"] {
        let folder = dataset_root.join(use_case);
        if !folder.exists() {
            continue;
        }
        for entry in fs::read_dir(&folder).with_context(|| format!("reading {}", folder.display()))? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            if entry.path().extension().and_then(|v| v.to_str()) != Some("json") {
                continue;
            }
            let body = fs::read_to_string(entry.path())?;
            let trace: MeasurementTrace = serde_json::from_str(&body)
                .with_context(|| format!("parsing trace {}", entry.path().display()))?;
            traces.push(trace);
        }
    }
    Ok(traces)
}

fn read_config(path: &Path) -> Result<CalibrationConfig> {
    let body = fs::read_to_string(path)?;
    let mut cfg: CalibrationConfig = serde_json::from_str(&body)?;
    enforce_bounds(&mut cfg);
    Ok(cfg)
}

fn deterministic_jitter(seed: u64, time_ms: f64, jitter: f64) -> f64 {
    let phase = ((seed as f64) * 0.013 + time_ms * 0.0017).sin();
    phase * jitter
}

fn simulate_sample(sample: &Sample, cfg: &CalibrationConfig) -> Sample {
    let leakage_drop = |voltage: f64, resistance: f64| voltage / resistance.max(1.0);
    let current_bias = cfg.noise.current_dependent_bias * sample.input_current_a;
    let jitter = deterministic_jitter(cfg.seed, sample.timestamp_ms, cfg.noise.measurement_jitter);
    let vbat = sample.rail_voltage_v.vbat + cfg.noise.measurement_offset + jitter
        - leakage_drop(sample.rail_voltage_v.vbat, cfg.leakage.leakage_resistance_per_domain.vbat);
    let vbus = sample.rail_voltage_v.vbus + cfg.noise.measurement_offset + jitter
        - leakage_drop(sample.rail_voltage_v.vbus, cfg.leakage.leakage_resistance_per_domain.vbus);
    let vsys = sample.rail_voltage_v.vsys + cfg.noise.measurement_offset + jitter
        - leakage_drop(sample.rail_voltage_v.vsys, cfg.leakage.leakage_resistance_per_domain.vsys);

    let avg_coupling = cfg
        .thermal
        .thermal_coupling_matrix
        .iter()
        .flatten()
        .copied()
        .sum::<f64>()
        / 9.0;
    let temp = sample.surface_temp_c.map(|t| {
        t + (sample.input_current_a * cfg.leakage.thermal_leakage_coefficient * cfg.thermal.thermal_mass * 0.05)
            - (cfg.thermal.heat_dissipation_factor * 2.0)
            + (avg_coupling * 0.1)
    });

    Sample {
        timestamp_ms: sample.timestamp_ms,
        rail_voltage_v: RailVoltage { vbat, vbus, vsys },
        input_current_a: (sample.input_current_a * (1.0 + current_bias) + jitter).max(0.0),
        surface_temp_c: temp,
    }
}

fn compute_metrics(traces: &[MeasurementTrace], cfg: &CalibrationConfig) -> Metrics {
    let mut acc = Acc::default();
    for trace in traces {
        for sample in &trace.trace {
            let pred = simulate_sample(sample, cfg);
            acc.vbat_abs += (pred.rail_voltage_v.vbat - sample.rail_voltage_v.vbat).abs();
            acc.vbus_abs += (pred.rail_voltage_v.vbus - sample.rail_voltage_v.vbus).abs();
            acc.vsys_abs += (pred.rail_voltage_v.vsys - sample.rail_voltage_v.vsys).abs();
            let denom = sample.input_current_a.abs().max(0.01);
            acc.i_pct += ((pred.input_current_a - sample.input_current_a).abs() / denom) * 100.0;
            if let (Some(pred_t), Some(obs_t)) = (pred.surface_temp_c, sample.surface_temp_c) {
                acc.t_abs += (pred_t - obs_t).abs();
                acc.t_n += 1.0;
            }
            acc.n += 1.0;
        }
    }

    let voltage_mae = RailVoltage {
        vbat: acc.vbat_abs / acc.n.max(1.0),
        vbus: acc.vbus_abs / acc.n.max(1.0),
        vsys: acc.vsys_abs / acc.n.max(1.0),
    };
    let current_mape = acc.i_pct / acc.n.max(1.0);
    let thermal_mae = if acc.t_n > 0.0 { acc.t_abs / acc.t_n } else { 0.0 };
    let avg_v_mae = (voltage_mae.vbat + voltage_mae.vbus + voltage_mae.vsys) / 3.0;
    let composite_score = (0.4 * avg_v_mae) + (0.3 * current_mape) + (0.3 * thermal_mae);
    Metrics {
        voltage_mae,
        current_mape,
        thermal_mae,
        composite_score,
    }
}

fn split_train_validation(traces: &[MeasurementTrace]) -> (Vec<MeasurementTrace>, Vec<MeasurementTrace>) {
    let mut grouped: BTreeMap<String, Vec<MeasurementTrace>> = BTreeMap::new();
    for t in traces {
        grouped
            .entry(t.scenario.use_case.clone())
            .or_default()
            .push(t.clone());
    }

    let mut train = Vec::new();
    let mut val = Vec::new();
    for (_, mut g) in grouped {
        g.sort_by(|a, b| a.metadata.board_id.cmp(&b.metadata.board_id));
        let train_n = ((g.len() as f64) * 0.7).floor() as usize;
        let train_n = train_n.clamp(1.min(g.len()), g.len().saturating_sub(1).max(1));
        for (idx, item) in g.into_iter().enumerate() {
            if idx < train_n {
                train.push(item);
            } else {
                val.push(item);
            }
        }
    }

    if val.is_empty() {
        val = train.clone();
    }
    (train, val)
}

fn quick_fit(train: &[MeasurementTrace], mut cfg: CalibrationConfig) -> CalibrationConfig {
    let mut voltage_residual = 0.0;
    let mut current_ratio = 0.0;
    let mut temp_residual = 0.0;
    let mut n: f64 = 0.0;
    let mut t_n: f64 = 0.0;
    for trace in train {
        for sample in &trace.trace {
            let pred = simulate_sample(sample, &cfg);
            let avg_obs_v = (sample.rail_voltage_v.vbat + sample.rail_voltage_v.vbus + sample.rail_voltage_v.vsys) / 3.0;
            let avg_pred_v = (pred.rail_voltage_v.vbat + pred.rail_voltage_v.vbus + pred.rail_voltage_v.vsys) / 3.0;
            voltage_residual += avg_obs_v - avg_pred_v;
            current_ratio += (sample.input_current_a - pred.input_current_a) / sample.input_current_a.max(0.1);
            if let (Some(obs_t), Some(pred_t)) = (sample.surface_temp_c, pred.surface_temp_c) {
                temp_residual += obs_t - pred_t;
                t_n += 1.0;
            }
            n += 1.0;
        }
    }

    let mean_v = voltage_residual / n.max(1.0);
    let mean_i = current_ratio / n.max(1.0);
    let mean_t = temp_residual / t_n.max(1.0);

    cfg.noise.measurement_offset += mean_v;
    cfg.noise.current_dependent_bias += mean_i * 0.1;
    cfg.thermal.heat_dissipation_factor -= mean_t * 0.05;
    cfg.leakage.thermal_leakage_coefficient += mean_t * 0.001;
    enforce_bounds(&mut cfg);
    cfg
}

fn random_neighbor(rng: &mut StdRng, base: &CalibrationConfig) -> CalibrationConfig {
    let mut c = base.clone();
    c.noise.measurement_offset += rng.gen_range(-0.01..0.01);
    c.noise.measurement_jitter += rng.gen_range(-0.002..0.002);
    c.noise.current_dependent_bias += rng.gen_range(-0.01..0.01);
    c.leakage.thermal_leakage_coefficient += rng.gen_range(-0.01..0.01);
    c.thermal.thermal_mass += rng.gen_range(-1.0..1.0);
    c.thermal.heat_dissipation_factor += rng.gen_range(-0.02..0.02);
    c.leakage.leakage_resistance_per_domain.vbat += rng.gen_range(-20.0..20.0);
    c.leakage.leakage_resistance_per_domain.vbus += rng.gen_range(-20.0..20.0);
    c.leakage.leakage_resistance_per_domain.vsys += rng.gen_range(-20.0..20.0);
    enforce_bounds(&mut c);
    c
}

fn full_fit(train: &[MeasurementTrace], start: CalibrationConfig) -> CalibrationConfig {
    let mut rng = StdRng::seed_from_u64(start.seed);
    let mut best = start;
    let mut best_score = compute_metrics(train, &best).composite_score;

    for _ in 0..64 {
        let candidate = random_neighbor(&mut rng, &best);
        let score = compute_metrics(train, &candidate).composite_score;
        if score < best_score {
            best = candidate;
            best_score = score;
        }
    }

    for _ in 0..20 {
        let candidate = random_neighbor(&mut rng, &best);
        let score = compute_metrics(train, &candidate).composite_score;
        if score < best_score {
            best = candidate;
            best_score = score;
        }
    }
    best
}


fn metrics_by_use_case(traces: &[MeasurementTrace], cfg: &CalibrationConfig) -> BTreeMap<String, Metrics> {
    let mut grouped: BTreeMap<String, Vec<MeasurementTrace>> = BTreeMap::new();
    for trace in traces {
        grouped.entry(trace.scenario.use_case.clone()).or_default().push(trace.clone());
    }
    grouped
        .into_iter()
        .map(|(k, v)| (k, compute_metrics(&v, cfg)))
        .collect()
}

fn ingest(dataset: &Path) -> Result<()> {
    let traces = read_dataset(dataset)?;
    let mut per_case: BTreeMap<String, usize> = BTreeMap::new();
    for trace in &traces {
        *per_case.entry(trace.scenario.use_case.clone()).or_default() += 1;
    }
    let payload = serde_json::json!({
        "dataset": dataset.display().to_string(),
        "trace_count": traces.len(),
        "per_use_case": per_case,
    });
    println!("{}", serde_json::to_string_pretty(&payload)?);
    Ok(())
}

fn simulate(dataset: &Path, config: &Path) -> Result<()> {
    let traces = read_dataset(dataset)?;
    if traces.is_empty() {
        bail!("dataset has no trace files");
    }
    let cfg = read_config(config)?;
    let metrics = compute_metrics(&traces, &cfg);
    println!("{}", serde_json::to_string_pretty(&metrics)?);
    Ok(())
}

fn fit(dataset: &Path, config: &Path, out: &Path, mode: FitMode) -> Result<()> {
    let traces = read_dataset(dataset)?;
    let base = read_config(config)?;
    let (train, val) = split_train_validation(&traces);
    let quick = quick_fit(&train, base.clone());
    let calibrated = match mode {
        FitMode::QuickFit => quick,
        FitMode::FullFit => full_fit(&train, quick),
    };
    let train_metrics = compute_metrics(&train, &calibrated);
    let val_metrics = compute_metrics(&val, &calibrated);

    if val_metrics.composite_score > train_metrics.composite_score * 1.35 {
        eprintln!("warning: potential overfitting detected on validation split");
    }

    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(out, serde_json::to_string_pretty(&calibrated)?)?;

    let payload = serde_json::json!({
        "mode": match mode { FitMode::QuickFit => "quick-fit", FitMode::FullFit => "full-fit" },
        "train_composite": train_metrics.composite_score,
        "validation_composite": val_metrics.composite_score,
        "out": out.display().to_string()
    });
    println!("{}", serde_json::to_string_pretty(&payload)?);
    Ok(())
}

fn report(dataset: &Path, config: &Path, out: &Path) -> Result<()> {
    let traces = read_dataset(dataset)?;
    let cfg = read_config(config)?;
    let global = compute_metrics(&traces, &cfg);
    let per_use_case = metrics_by_use_case(&traces, &cfg);

    let mut dataset_counts: BTreeMap<String, usize> = BTreeMap::new();
    for trace in &traces {
        *dataset_counts.entry(trace.scenario.use_case.clone()).or_default() += 1;
    }

    fs::create_dir_all(out.join("plots"))?;

    let summary = serde_json::json!({
        "dataset_counts": dataset_counts,
        "global_metrics": global,
        "per_use_case_metrics": per_use_case,
        "composite_score": compute_metrics(&traces, &cfg).composite_score
    });
    fs::write(out.join("summary.json"), serde_json::to_string_pretty(&summary)?)?;

    let summary_md = format!(
        "# Calibration Summary

- Dataset: `{}`
- Composite score: `{:.6}`

## Global Metrics
- Voltage MAE (VBAT/VBUS/VSYS): `{:.6}` / `{:.6}` / `{:.6}`
- Current MAPE: `{:.6}`
- Thermal MAE: `{:.6}`
",
        dataset.display(),
        global.composite_score,
        global.voltage_mae.vbat,
        global.voltage_mae.vbus,
        global.voltage_mae.vsys,
        global.current_mape,
        global.thermal_mae
    );
    fs::write(out.join("summary.md"), summary_md)?;

    let residual = serde_json::json!({
      "unmodeled_effects": [
        "Battery internal resistance aging drift across SOC",
        "Charge-pump transient ringing during adapter negotiation",
        "Spatial thermal gradients beyond single surface sensor"
      ],
      "gameplay_sensitive_regions": [
        {
          "region": "low_soc_boot_boundary",
          "why_sensitive": "small VBAT errors near UVLO create binary boot/no-boot outcomes"
        },
        {
          "region": "fake_charge_indicator_threshold",
          "why_sensitive": "current estimation drift impacts player-visible charging icon realism"
        },
        {
          "region": "thermal_throttle_onset",
          "why_sensitive": "thermal MAE near throttle threshold changes failure diagnosis timing"
        }
      ]
    });
    fs::write(out.join("residual_gaps.json"), serde_json::to_string_pretty(&residual)?)?;

    let mut csv = String::from("use_case,voltage_mae_vbat,voltage_mae_vbus,voltage_mae_vsys,current_mape,thermal_mae,composite_score
");
    for (use_case, m) in metrics_by_use_case(&traces, &cfg) {
        csv.push_str(&format!(
            "{},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6}
",
            use_case,
            m.voltage_mae.vbat,
            m.voltage_mae.vbus,
            m.voltage_mae.vsys,
            m.current_mape,
            m.thermal_mae,
            m.composite_score
        ));
    }
    fs::write(out.join("plots/metrics_by_use_case.csv"), csv)?;

    println!("wrote report to {}", out.display());
    Ok(())
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Ingest { dataset } => ingest(&dataset),
        Commands::Simulate { dataset, config } => simulate(&dataset, &config),
        Commands::Fit {
            dataset,
            config,
            out,
            mode,
        } => fit(&dataset, &config, &out, mode),
        Commands::Report {
            dataset,
            config,
            out,
        } => report(&dataset, &config, &out),
    }
}
