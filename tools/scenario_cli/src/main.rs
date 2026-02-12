use clap::{Parser, Subcommand};
use std::fs;

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
}

fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Validate { file } => validate(&file),
        Commands::Inspect { file } => inspect(&file),
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
