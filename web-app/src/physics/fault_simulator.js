import { State } from "../state.js";
import { voltageHistory, thermalHistory, distressHistory, diagnosticHistory } from "../state.js";
import { measurementEffects, componentDegradation, environmentEffects, toolCalibration } from "../physics/effects.js";

// Legacy prototype only.
// This module is intentionally no longer wired into scenario selection because
// it uses old scenario IDs and does not drive the board power/runtime graph.
// Keep it as reference until the structured case/fault engine replaces it.
class FaultSimulator {
    constructor() {
        this.activeFaults = {};
        this.faultHistory = [];
        this.simulationRunning = false;
    }

    initializeForScenario(scenarioId) {
        this.reset();
        
        const scenarioFaults = {
            'default': [],
            'power_drain_intermit': [
                { type: 'parasitic_drain', target: 'VBAT', severity: 0.3, probability: 0.4 },
                { type: 'weak_battery', target: 'VBAT', severity: 0.2, probability: 0.5 }
            ],
            'fake_charging_drop': [
                { type: 'charging_ic_fault', target: 'VCHG', severity: 0.4, probability: 0.3 },
                { type: 'voltage_drop', target: 'USB', severity: 0.3, probability: 0.4 }
            ],
            'rf_no_service_intermit': [
                { type: 'rf_ground_fault', target: 'RF', severity: 0.5, probability: 0.2 },
                { type: 'intermittent_contact', target: 'ANT', severity: 0.3, probability: 0.5 }
            ],
            'thermal_shutdown': [
                { type: 'thermal_runaway', target: 'CPU', severity: 0.6, probability: 0.3 },
                { type: 'cooling_failure', target: 'THERMAL', severity: 0.5, probability: 0.4 }
            ],
            'usb_not_recognized': [
                { type: 'usb_ic_fault', target: 'USB_IC', severity: 0.5, probability: 0.3 },
                { type: 'data_line_damage', target: 'D+', severity: 0.4, probability: 0.4 }
            ],
            'audio_no_sound': [
                { type: 'audio_ic_fault', target: 'AUDIO', severity: 0.5, probability: 0.3 },
                { type: 'speaker_damage', target: 'SPK', severity: 0.4, probability: 0.4 }
            ],
            'touch_not_responsive': [
                { type: 'touch_controller_fault', target: 'TOUCH', severity: 0.4, probability: 0.3 },
                { type: 'connection_fault', target: 'TOUCH_FLEX', severity: 0.3, probability: 0.5 }
            ],
            'bootloop': [
                { type: 'nand_corruption', target: 'STORAGE', severity: 0.7, probability: 0.2 },
                { type: 'pmic_fault', target: 'PMIC', severity: 0.5, probability: 0.3 }
            ],
            'no_power_at_all': [
                { type: 'pmic_dead', target: 'PMIC', severity: 0.9, probability: 0.1 },
                { type: 'short_circuit', target: 'VBUS', severity: 0.8, probability: 0.2 },
                { type: 'battery_dead', target: 'VBAT', severity: 1.0, probability: 0.3 }
            ]
        };

        const faults = scenarioFaults[scenarioId] || [];
        
        faults.forEach(fault => {
            if (Math.random() < fault.probability) {
                this.injectFault(fault);
            }
        });

        console.log('Faults initialized for scenario:', scenarioId, this.activeFaults);
    }

    injectFault(faultDef) {
        const fault = {
            ...faultDef,
            id: Date.now() + Math.random(),
            active: true,
            triggered: false,
            triggerTime: null
        };
        
        this.activeFaults[faultDef.target] = fault;
        this.faultHistory.push(fault);
    }

    applyFaults(phoneState) {
        if (!phoneState || !phoneState.electrical || !phoneState.electrical.rails) return;

        Object.keys(this.activeFaults).forEach(target => {
            const fault = this.activeFaults[target];
            if (!fault || !fault.active) return;

            const railKey = target.toUpperCase();
            const rail = phoneState.electrical.rails.get(railKey);

            if (rail) {
                switch (fault.type) {
                    case 'parasitic_drain':
                        rail.state.extra_load_a += fault.severity * 0.05;
                        break;
                    case 'weak_battery':
                        rail.state.voltage *= (1 - fault.severity * 0.1);
                        break;
                    case 'charging_ic_fault':
                        rail.state.voltage *= 0.7;
                        rail.state.resistance += fault.severity * 10;
                        break;
                    case 'voltage_drop':
                        rail.state.voltage -= fault.severity * 0.5;
                        break;
                    case 'rf_ground_fault':
                        rail.state.noise += fault.severity * 0.1;
                        break;
                    case 'thermal_runaway':
                        phoneState.thermal.zones.forEach(zone => {
                            if (zone.id.includes('CPU')) {
                                zone.temperature += fault.severity * 0.5;
                            }
                        });
                        break;
                    case 'pmic_dead':
                        rail.state.voltage = 0;
                        break;
                    case 'short_circuit':
                        rail.state.current_limit *= 0.1;
                        break;
                    case 'battery_dead':
                        rail.state.voltage = 0;
                        break;
                }

                fault.triggered = true;
                fault.triggerTime = Date.now();
            }
        });
    }

    checkFaultTriggers(phoneState) {
        const events = [];
        
        const distress = distressHistory[distressHistory.length - 1] || 0;
        if (distress > 0.7) {
            events.push({
                type: 'WARNING',
                message: 'System distress high - risk of permanent damage',
                severity: 'high'
            });
        }

        Object.keys(voltageHistory).forEach(rail => {
            const history = voltageHistory[rail];
            if (history.length < 5) return;
            
            const recent = history.slice(-5);
            const variance = this.calculateVariance(recent);
            
            if (variance > 0.5) {
                events.push({
                    type: 'VOLTAGE_UNSTABLE',
                    message: `Unstable voltage detected on ${rail}`,
                    severity: 'medium'
                });
            }
        });

        return events;
    }

    calculateVariance(values) {
        if (!values || values.length === 0) return 0;
        const valid = values.filter(v => v != null);
        if (valid.length === 0) return 0;
        
        const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
        return valid.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / valid.length;
    }

    getActiveFaults() {
        return Object.values(this.activeFaults).filter(f => f.active);
    }

    clearFault(target) {
        if (this.activeFaults[target]) {
            this.activeFaults[target].active = false;
        }
    }

    reset() {
        this.activeFaults = {};
        this.faultHistory = [];
    }

    getFaultReport() {
        return {
            active: this.getActiveFaults(),
            history: this.faultHistory,
            total: this.faultHistory.length
        };
    }
}

export const faultSimulator = new FaultSimulator();

export class DiagnosticExpert {
    constructor() {
        this.knowledgeBase = this.initializeKnowledgeBase();
    }

    initializeKnowledgeBase() {
        return {
            'VBAT': {
                low: ['Battery weak/dead', 'PMIC fault', 'Parasitic drain', 'Charging circuit fault'],
                high: ['PMIC overvoltage', 'Charger IC fault', 'Regulation failure'],
                unstable: ['Battery internal resistance high', 'Loose connection', 'PCB trace damage']
            },
            'VCHG': {
                low: ['Charger IC fault', 'USB port damage', 'Charging path broken', 'Battery reject charge'],
                zero: ['Charger IC dead', 'No power from USB', 'Fuse blown'],
                unstable: ['Intermittent charger connection', 'Dirty USB port', 'Faulty charging IC']
            },
            'VCORE': {
                low: ['CPU not requesting power', 'PMIC undervoltage', 'CPU damaged'],
                high: ['PMIC overvoltage', 'CPU short'],
                unstable: ['CPU thermal throttling', 'Power rail instability']
            },
            'VIO': {
                low: ['Peripheral IC not powered', 'I/O rail fault'],
                high: ['I/O overvoltage', 'PMIC fault'],
                unstable: ['Peripheral IC unstable', 'PCB trace issue']
            }
        };
    }

    diagnose(railName, value, expectedValue) {
        const rail = railName.toUpperCase();
        const knowledge = this.knowledgeBase[rail];
        
        if (!knowledge) {
            return { conclusion: 'No diagnostic data available for this rail', confidence: 0 };
        }

        const diagnoses = [];
        let confidence = 0;

        if (value < expectedValue * 0.5) {
            diagnoses.push(...(knowledge.low || []));
            confidence = 0.7;
        } else if (value > expectedValue * 1.5) {
            diagnoses.push(...(knowledge.high || []));
            confidence = 0.6;
        } else if (Math.abs(value - expectedValue) > expectedValue * 0.1) {
            diagnoses.push(...(knowledge.unstable || []));
            confidence = 0.5;
        } else {
            return { conclusion: 'Rail appears normal', confidence: 0.9 };
        }

        return {
            conclusion: diagnoses.slice(0, 3).join(' OR '),
            possible_causes: diagnoses,
            confidence: Math.min(0.85, confidence),
            recommendation: this.getRecommendation(railName, value, expectedValue)
        };
    }

    getRecommendation(rail, value, expected) {
        const ratio = value / expected;
        
        if (ratio < 0.1) {
            return 'CRITICAL: Do not apply power further - risk of damage. Check for short circuits first.';
        } else if (ratio < 0.5) {
            return 'WARNING: Low voltage detected. Check power path, battery health, and PMIC.';
        } else if (ratio < 0.9) {
            return 'CAUTION: Voltage below expected. Verify connections and check for loading issues.';
        } else if (ratio > 1.5) {
            return 'DANGER: Overvoltage detected! Immediately disconnect power to prevent damage.';
        } else if (ratio > 1.1) {
            return 'WARNING: Voltage higher than expected. Check regulator and PMIC.';
        }
        
        return 'Monitor and continue diagnosis if needed.';
    }
}

export const diagnosticExpert = new DiagnosticExpert();
