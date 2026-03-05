use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActionEvent {
    pub tool: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setting: Option<String>,
    pub target: String,
    pub at_tick: u64,
    pub metadata: ActionMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ActionMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_intent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConsequenceLevel {
    Safe,
    Risky,
    DamageSecondary,
    MisleadingMeasurement,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConsequenceEvent {
    pub level: ConsequenceLevel,
    pub reason_code: String,
    pub description: String,
    pub probability: f64,
    pub applied_state_delta_summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrainingMode {
    Guided,
    Standard,
    Strict,
}

#[derive(Debug, Clone)]
pub struct RiskContext {
    pub thermal_stress: f64,
    pub electrical_stress: f64,
    pub active_faults: Vec<String>,
    pub world_profile: String,
    pub has_stable_ground_reference: bool,
    pub current_a: f64,
    pub voltage_v: f64,
    pub charger_negotiation_valid: bool,
    pub protection_bypassed: bool,
    pub measurement_noise: f64,
}

#[derive(Debug, Clone)]
pub struct RiskRule {
    pub id: &'static str,
    pub precondition: fn(&ActionEvent, &RiskContext) -> bool,
    pub base_probability: f64,
    pub consequence: ConsequenceLevel,
    pub description: &'static str,
    pub delta_summary: &'static str,
    pub misleading: Option<&'static str>,
}

pub struct RiskModel;

impl RiskModel {
    pub fn evaluate(
        action: &ActionEvent,
        context: &RiskContext,
        mode: TrainingMode,
    ) -> ConsequenceEvent {
        let rules = Self::rules();
        let matched = rules
            .into_iter()
            .find(|r| (r.precondition)(action, context));
        if let Some(rule) = matched {
            let probability = Self::mode_adjusted_probability(rule.base_probability, mode);
            let level = if rule.misleading.is_some() && context.measurement_noise > 0.6 {
                ConsequenceLevel::MisleadingMeasurement
            } else {
                rule.consequence
            };
            let description = if let Some(misleading) = rule.misleading {
                if level == ConsequenceLevel::MisleadingMeasurement {
                    misleading.to_string()
                } else {
                    rule.description.to_string()
                }
            } else {
                rule.description.to_string()
            };
            return ConsequenceEvent {
                level,
                reason_code: rule.id.to_string(),
                description,
                probability,
                applied_state_delta_summary: rule.delta_summary.to_string(),
            };
        }

        ConsequenceEvent {
            level: ConsequenceLevel::Safe,
            reason_code: "SAFE_BASELINE".to_string(),
            description: "Action is within safe operating envelope".to_string(),
            probability: 0.0,
            applied_state_delta_summary: "No damaging state delta".to_string(),
        }
    }

    fn mode_adjusted_probability(base: f64, mode: TrainingMode) -> f64 {
        let adjusted = match mode {
            TrainingMode::Guided => base * 0.75,
            TrainingMode::Standard => base,
            TrainingMode::Strict => (base * 1.25) + 0.05,
        };
        adjusted.clamp(0.0, 1.0)
    }

    pub fn rules() -> Vec<RiskRule> {
        vec![
            RiskRule {
                id: "OVER_VOLTAGE_INJECTION",
                precondition: |a, c| a.tool == "psu" && c.voltage_v > 4.5,
                base_probability: 0.8,
                consequence: ConsequenceLevel::DamageSecondary,
                description: "Over-voltage injection can puncture PMIC input stage",
                delta_summary: "PMIC leakage increased, downstream rail instability",
                misleading: None,
            },
            RiskRule {
                id: "PROBE_NO_GROUND",
                precondition: |a, c| a.tool == "multimeter" && !c.has_stable_ground_reference,
                base_probability: 0.6,
                consequence: ConsequenceLevel::Risky,
                description: "Probe without stable ground reference introduces floating readings",
                delta_summary: "Measurement baseline offset + transient stress",
                misleading: Some("Floating ground produced misleading voltage reading"),
            },
            RiskRule {
                id: "RAIL_SHORT",
                precondition: |a, _| a.tool == "jumper" && a.target.contains("rail"),
                base_probability: 0.9,
                consequence: ConsequenceLevel::DamageSecondary,
                description: "Shorting rails causes high current surge and collateral damage",
                delta_summary: "Thermal hotspot on power path and fuse fatigue",
                misleading: None,
            },
            RiskRule {
                id: "BAD_CHARGER_NEGOTIATION",
                precondition: |a, c| a.tool == "usb_trigger" && !c.charger_negotiation_valid,
                base_probability: 0.7,
                consequence: ConsequenceLevel::Risky,
                description: "Forced charger negotiation mismatch stresses charger IC",
                delta_summary: "Charge current oscillation and protocol fallback",
                misleading: Some("Negotiation fallback masks true charging state"),
            },
            RiskRule {
                id: "HIGH_CURRENT_OVERHEAT",
                precondition: |a, c| a.tool == "psu" && c.current_a > 2.8 && c.thermal_stress > 0.5,
                base_probability: 0.85,
                consequence: ConsequenceLevel::DamageSecondary,
                description: "Prolonged high current drives thermal runaway",
                delta_summary: "Board thermal rise and solder fatigue progression",
                misleading: None,
            },
            RiskRule {
                id: "PROTECTION_BYPASS",
                precondition: |a, c| a.tool == "bypass" || c.protection_bypassed,
                base_probability: 0.88,
                consequence: ConsequenceLevel::DamageSecondary,
                description: "Bypassing protection component removes safety boundary",
                delta_summary: "Transient spikes propagate into sensitive rails",
                misleading: None,
            },
            RiskRule {
                id: "FAULTY_INJECTION_ON_ACTIVE_FAULT",
                precondition: |a, c| a.tool == "inject" && !c.active_faults.is_empty(),
                base_probability: 0.73,
                consequence: ConsequenceLevel::Risky,
                description: "Injection on active faults amplifies latent defects",
                delta_summary: "Fault spread to neighboring nets",
                misleading: None,
            },
            RiskRule {
                id: "THERMAL_PROBE_DELAY",
                precondition: |a, c| a.tool == "thermal_cam" && c.thermal_stress > 0.7,
                base_probability: 0.55,
                consequence: ConsequenceLevel::Risky,
                description: "Late thermal probing misses transient peaks",
                delta_summary: "Incomplete thermal evidence captured",
                misleading: Some("Thermal image appears normal despite intermittent hotspot"),
            },
            RiskRule {
                id: "NOISY_WORLD_MEASUREMENT",
                precondition: |a, c| {
                    a.tool == "multimeter"
                        && c.world_profile.contains("emi")
                        && c.measurement_noise > 0.4
                },
                base_probability: 0.65,
                consequence: ConsequenceLevel::MisleadingMeasurement,
                description: "EMI-heavy environment distorts low-level measurements",
                delta_summary: "Noise floor elevated and repeatability reduced",
                misleading: Some("EMI introduced plausible but wrong measurement plateau"),
            },
            RiskRule {
                id: "BLIND_COMPONENT_SWAP",
                precondition: |a, c| a.tool == "replace" && c.electrical_stress > 0.6,
                base_probability: 0.62,
                consequence: ConsequenceLevel::Risky,
                description: "Component swap before isolation increases rework risk",
                delta_summary: "Unknown fault branch remains untested",
                misleading: None,
            },
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> RiskContext {
        RiskContext {
            thermal_stress: 0.8,
            electrical_stress: 0.7,
            active_faults: vec!["short_vbat".into()],
            world_profile: "emi_lab".into(),
            has_stable_ground_reference: false,
            current_a: 3.1,
            voltage_v: 5.2,
            charger_negotiation_valid: false,
            protection_bypassed: false,
            measurement_noise: 0.7,
        }
    }

    #[test]
    fn has_at_least_ten_rules() {
        assert!(RiskModel::rules().len() >= 10);
    }

    #[test]
    fn strict_mode_is_harsher_than_guided() {
        let action = ActionEvent {
            tool: "psu".into(),
            setting: None,
            target: "vbat".into(),
            at_tick: 1,
            metadata: ActionMetadata::default(),
        };
        let guided = RiskModel::evaluate(&action, &ctx(), TrainingMode::Guided);
        let strict = RiskModel::evaluate(&action, &ctx(), TrainingMode::Strict);
        assert!(strict.probability > guided.probability);
    }

    #[test]
    fn no_ground_probe_can_be_misleading() {
        let action = ActionEvent {
            tool: "multimeter".into(),
            setting: None,
            target: "rail:vbat".into(),
            at_tick: 1,
            metadata: ActionMetadata::default(),
        };
        let res = RiskModel::evaluate(&action, &ctx(), TrainingMode::Standard);
        assert_eq!(res.reason_code, "PROBE_NO_GROUND");
        assert_eq!(res.level, ConsequenceLevel::MisleadingMeasurement);
    }
}
