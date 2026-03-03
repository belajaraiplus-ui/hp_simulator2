use clap::{Parser, Subcommand};
use std::fs;
use std::path::Path;

use engine::scenario_dsl::model::ScenarioDsl;
use engine::scenario::presets as scenario_presets;

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
    Validate {
        file: String,
    },

    /// Tampilkan ringkasan scenario (tanpa interpretasi teknis)
    Inspect {
        file: String,
    },

    /// Validasi semua scenario JSON di dalam direktori
    ValidateAll {
        dir: String,
    },
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
    let raw = fs::read_to_string(file)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    serde_json::from_str(&raw)
        .map_err(|e| format!("Invalid DSL structure: {}", e))
}

fn validate(file: &str) -> Result<(), String> {
    let dsl = load(file)?;

    // =======================
    // WORLD PROFILE CHECK
    // =======================
    let known_worlds = [
        "IDEAL_BENCH",
        "HOT_HUMID_WORKSHOP",
        "PREVIOUSLY_REPAIRED_DEVICE",
        "POST_PREVIOUS_REPAIR",
        "STABLE_LAB",
        "NOISY_POWER_ENV",
        "POST_WATER_EXPOSURE",
        "RF_UNSTABLE_ENVIRONMENT",
        scenario_presets::RF_UNSTABLE_ENVIRONMENT.name,
    ];

    if !known_worlds.contains(&dsl.world_profile.as_str()) {
        return Err(format!(
            "Unknown world_profile: {}",
            dsl.world_profile
        ));
    }

    // =======================
    // PHILOSOPHY GUARDS
    // =======================
    let forbidden = [
        "IC", "PA", "PMIC", "short", "konslet", "ganti",
        "rusak", "solusi", "NTC", "baseband",
    ];

    let text = format!(
        "{} {} {} {}",
        dsl.title,
        dsl.customer_complaint,
        dsl.background_story,
        dsl.notes.clone().unwrap_or_default()
    ).to_lowercase();

    let tokens: std::collections::HashSet<&str> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .collect();

    for word in forbidden {
        if tokens.contains(word.to_lowercase().as_str()) {
            return Err(format!(
                "Forbidden technical term detected: '{}'",
                word
            ));
        }
    }

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

    for f in &files {
        let display = f.display().to_string();
        validate(&display).map_err(|e| format!("{} => {}", display, e))?;
    }

    println!("OK: validated {} scenario file(s)", files.len());
    Ok(())
}
