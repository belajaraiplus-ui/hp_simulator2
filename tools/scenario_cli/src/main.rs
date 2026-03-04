#![deny(warnings)]

use clap::{Parser, Subcommand};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use engine::scenario::presets as scenario_presets;
use engine::scenario_dsl::model::ScenarioDsl;

#[derive(Parser)]
#[command(name = "hp-sim-scenario")]
#[command(about = "Scenario DSL authoring & validation tool")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Validasi file scenario DSL
    Validate { file: String },

    /// Tampilkan ringkasan scenario (tanpa interpretasi teknis)
    Inspect { file: String },

    /// Validasi semua scenario JSON di dalam direktori
    ValidateAll { dir: String },
}

fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Validate { file } => validate(&file),
        Commands::Inspect { file } => inspect(&file),
        Commands::ValidateAll { dir } => validate_all(&dir),
    };

    if let Err(e) = result {
        eprintln!("ERROR: {}", e);
        std::process::exit(1);
    }
}

fn load(file: &str) -> Result<ScenarioDsl, String> {
    let raw = fs::read_to_string(file).map_err(|e| format!("Failed to read file: {}", e))?;

    serde_json::from_str(&raw).map_err(|e| format!("Invalid DSL structure: {}", e))
}

fn known_worlds() -> [&'static str; 9] {
    [
        "IDEAL_BENCH",
        "HOT_HUMID_WORKSHOP",
        "PREVIOUSLY_REPAIRED_DEVICE",
        "POST_PREVIOUS_REPAIR",
        "STABLE_LAB",
        "NOISY_POWER_ENV",
        "POST_WATER_EXPOSURE",
        "RF_UNSTABLE_ENVIRONMENT",
        scenario_presets::RF_UNSTABLE_ENVIRONMENT.name,
    ]
}

fn validate_dsl(dsl: &ScenarioDsl) -> Result<(), String> {
    if !known_worlds().contains(&dsl.world_profile.as_str()) {
        return Err(format!("Unknown world_profile: {}", dsl.world_profile));
    }

    let forbidden = [
        "IC", "PA", "PMIC", "short", "konslet", "ganti", "rusak", "solusi", "NTC",
        "baseband",
    ];

    let text = format!(
        "{} {} {} {}",
        dsl.title,
        dsl.customer_complaint,
        dsl.background_story,
        dsl.notes.clone().unwrap_or_default()
    )
    .to_lowercase();

    let tokens: std::collections::HashSet<&str> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .collect();

    for word in forbidden {
        if tokens.contains(word.to_lowercase().as_str()) {
            return Err(format!("Forbidden technical term detected: '{}'", word));
        }
    }

    Ok(())
}

fn validate(file: &str) -> Result<(), String> {
    let dsl = load(file)?;
    validate_dsl(&dsl)?;
    println!("OK: scenario DSL valid");
    Ok(())
}

fn inspect(file: &str) -> Result<(), String> {
    let dsl = load(file)?;

    println!("ID: {}", dsl.id);
    println!("Title: {}", dsl.title);
    println!("World: {}", dsl.world_profile);
    println!("Complaint: {}", dsl.customer_complaint);
    println!("Background: {}", dsl.background_story);

    if let Some(c) = dsl.constraints {
        if let Some(t) = c.tools {
            println!("Tools: {}", t);
        }
        if let Some(tp) = c.time_pressure {
            println!("Time Pressure: {}", tp);
        }
    }

    if let Some(n) = dsl.notes {
        println!("Notes: {}", n);
    }

    Ok(())
}

fn validate_all(dir: &str) -> Result<(), String> {
    let path = Path::new(dir);
    if !path.exists() {
        return Err(format!("Directory not found: {}", dir));
    }

    let mut files = Vec::new();
    for entry in fs::read_dir(path).map_err(|e| format!("Failed to read dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
        let p = entry.path();
        if p.extension().and_then(|x| x.to_str()) == Some("json") {
            files.push(p);
        }
    }

    files.sort();

    if files.is_empty() {
        return Err(format!("No scenario JSON files found in {}", dir));
    }

    let mut ids: HashMap<String, String> = HashMap::new();

    for f in &files {
        let display = f.display().to_string();
        let dsl = load(&display).map_err(|e| format!("{} => {}", display, e))?;
        validate_dsl(&dsl).map_err(|e| format!("{} => {}", display, e))?;

        if let Some(prev) = ids.insert(dsl.id.clone(), display.clone()) {
            return Err(format!(
                "Duplicate scenario id '{}' found in {} and {}",
                dsl.id, prev, display
            ));
        }

        println!("OK: scenario DSL valid");
    }

    println!("OK: validated {} scenario file(s)", files.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine::scenario_dsl::model::{ConstraintsDsl, ScenarioDsl};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn sample_scenario() -> ScenarioDsl {
        ScenarioDsl {
            id: "test".to_string(),
            title: "Judul Kasus".to_string(),
            world_profile: "STABLE_LAB".to_string(),
            customer_complaint: "Perangkat restart acak".to_string(),
            background_story: "Riwayat penggunaan normal".to_string(),
            constraints: Some(ConstraintsDsl {
                tools: Some("Multimeter".to_string()),
                time_pressure: Some("sedang".to_string()),
            }),
            notes: Some("Perlu verifikasi bertahap".to_string()),
        }
    }

    #[test]
    fn validate_dsl_accepts_known_world() {
        let dsl = sample_scenario();
        assert!(validate_dsl(&dsl).is_ok());
    }

    #[test]
    fn validate_dsl_rejects_unknown_world() {
        let mut dsl = sample_scenario();
        dsl.world_profile = "UNKNOWN_WORLD".to_string();
        let err = validate_dsl(&dsl).expect_err("expected unknown world to fail");
        assert!(err.contains("Unknown world_profile"));
    }

    #[test]
    fn validate_dsl_rejects_forbidden_terms() {
        let mut dsl = sample_scenario();
        dsl.notes = Some("indikasi short muncul".to_string());
        let err = validate_dsl(&dsl).expect_err("expected forbidden term to fail");
        assert!(err.contains("Forbidden technical term"));
    }

    #[test]
    fn validate_all_rejects_duplicate_ids() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("hp_sim_scenario_cli_dup_{nonce}"));
        std::fs::create_dir_all(&temp).expect("create temp dir");

        let payload = r#"{"id":"dup_id","title":"Judul","world_profile":"STABLE_LAB","customer_complaint":"Keluhan","background_story":"Latar"}"#;
        std::fs::write(temp.join("one.json"), payload).expect("write one");
        std::fs::write(temp.join("two.json"), payload).expect("write two");

        let err = validate_all(temp.to_str().expect("utf8 path"))
            .expect_err("expected duplicate id to fail");
        assert!(err.contains("Duplicate scenario id"));

        std::fs::remove_dir_all(temp).expect("cleanup temp dir");
    }

    #[test]
    fn validate_all_rejects_empty_dir() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("hp_sim_scenario_cli_{nonce}"));
        std::fs::create_dir_all(&temp).expect("create temp dir");

        let err = validate_all(temp.to_str().expect("utf8 path"))
            .expect_err("expected empty directory to fail");
        assert!(err.contains("No scenario JSON files found"));

        std::fs::remove_dir_all(temp).expect("cleanup temp dir");
    }
}
