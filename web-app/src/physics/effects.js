import { State } from "../state.js";

export class MeasurementEffects {
    constructor() {
        this.probes = {};
        this.measurementCount = {};
        this.componentHealth = {};
        this.stressAccumulator = {};
    }

    recordMeasurement(target, mode, value) {
        if (!this.measurementCount[target]) {
            this.measurementCount[target] = { voltage: 0, ohm: 0, diode: 0, continuity: 0 };
            this.stressAccumulator[target] = 0;
            this.componentHealth[target] = 100;
        }

        this.measurementCount[target][mode]++;

        if (mode === 'voltage') {
            this.stressAccumulator[target] += 0.5;
        } else if (mode === 'ohm' || mode === 'continuity') {
            this.stressAccumulator[target] += 1.0;
        } else if (mode === 'diode') {
            this.stressAccumulator[target] += 0.8;
        }

        this.updateComponentHealth(target);

        return {
            actualValue: value,
            stress: this.stressAccumulator[target],
            health: this.componentHealth[target],
            measurementCount: this.measurementCount[target]
        };
    }

    updateComponentHealth(target) {
        const stress = this.stressAccumulator[target];
        
        if (stress < 5) {
            this.componentHealth[target] = 100;
        } else if (stress < 20) {
            this.componentHealth[target] = Math.max(70, 100 - (stress - 5) * 0.5);
        } else if (stress < 50) {
            this.componentHealth[target] = Math.max(40, 70 - (stress - 20) * 0.8);
        } else {
            this.componentHealth[target] = Math.max(10, 40 - (stress - 50) * 0.5);
        }
    }

    getHealth(target) {
        return this.componentHealth[target] || 100;
    }

    getStress(target) {
        return this.stressAccumulator[target] || 0;
    }

    getTotalMeasurements(target) {
        if (!this.measurementCount[target]) return 0;
        const counts = this.measurementCount[target];
        return counts.voltage + counts.ohm + counts.diode + counts.continuity;
    }

    applyMeasurementBias(measuredValue, target, mode, profile) {
        const bias = profile?.measurement_bias || 0;
        
        if (bias === 0) return measuredValue;

        let noise = (Math.random() - 0.5) * bias * 2;
        
        if (mode === 'voltage') {
            noise *= measuredValue * 0.1;
        } else if (mode === 'ohm') {
            noise = (Math.random() - 0.5) * bias * 1000;
        }

        return measuredValue + noise;
    }

    applyLoadingEffect(target, mode, value, profile) {
        const psuQuality = profile?.psu_quality || 1.0;
        
        if (mode === 'voltage') {
            const loadDrop = (1 - psuQuality) * 0.05 * value;
            return Math.max(0, value - loadDrop);
        }
        
        return value;
    }

    reset() {
        this.probes = {};
        this.measurementCount = {};
        this.componentHealth = {};
        this.stressAccumulator = {};
    }

    getReport() {
        return {
            measurements: this.measurementCount,
            health: this.componentHealth,
            stress: this.stressAccumulator
        };
    }
}

export const measurementEffects = new MeasurementEffects();

export class ComponentDegradation {
    constructor() {
        this.heatDamage = {};
        this.physicalStress = {};
        this.electricalOverload = {};
    }

    applyHeat(zone, temperature, duration) {
        if (!this.heatDamage[zone]) {
            this.heatDamage[zone] = 0;
        }

        if (temperature > 80) {
            this.heatDamage[zone] += (temperature - 80) * duration * 0.01;
        }
    }

    applyPhysicalStress(component, force) {
        if (!this.physicalStress[component]) {
            this.physicalStress[component] = 0;
        }
        this.physicalStress[component] += force * 0.1;
    }

    applyElectricalOverload(component, current, voltage) {
        if (!this.electricalOverload[component]) {
            this.electricalOverload[component] = 0;
        }
        
        const power = current * voltage;
        if (power > 5) {
            this.electricalOverload[component] += (power - 5) * 0.05;
        }
    }

    getComponentStatus(component) {
        const heat = this.heatDamage[component] || 0;
        const physical = this.physicalStress[component] || 0;
        const electrical = this.electricalOverload[component] || 0;
        
        const total = heat + physical + electrical;
        
        let status = 'healthy';
        if (total > 50) status = 'critical';
        else if (total > 25) status = 'damaged';
        else if (total > 10) status = 'degraded';
        
        return {
            status,
            heat: heat.toFixed(2),
            physical: physical.toFixed(2),
            electrical: electrical.toFixed(2),
            total: total.toFixed(2)
        };
    }

    reset() {
        this.heatDamage = {};
        this.physicalStress = {};
        this.electricalOverload = {};
    }
}

export const componentDegradation = new ComponentDegradation();

export class ToolCalibration {
    constructor() {
        this.tools = {
            multimeter: { accuracy: 0.99, lastCalibrated: Date.now() },
            psu: { accuracy: 0.98, lastCalibrated: Date.now() },
            oscilloscope: { accuracy: 0.95, lastCalibrated: Date.now() }
        };
    }

    getAccuracy(tool) {
        return this.tools[tool]?.accuracy || 0.95;
    }

    applyMeasurementError(value, tool, mode) {
        const accuracy = this.getAccuracy(tool);
        const error = (1 - accuracy) * (Math.random() - 0.5) * 2;
        
        if (mode === 'voltage') {
            return value * (1 + error * 0.01);
        } else if (mode === 'ohm') {
            return value + error * 10;
        }
        
        return value;
    }

    needsCalibration(tool) {
        const lastCal = this.tools[tool]?.lastCalibrated || 0;
        const daysSince = (Date.now() - lastCal) / (1000 * 60 * 60 * 24);
        return daysSince > 30;
    }

    degrade(tool, amount = 0.001) {
        if (this.tools[tool]) {
            this.tools[tool].accuracy = Math.max(0.8, this.tools[tool].accuracy - amount);
        }
    }

    calibrate(tool) {
        if (this.tools[tool]) {
            this.tools[tool].accuracy = 0.99;
            this.tools[tool].lastCalibrated = Date.now();
            return true;
        }
        return false;
    }
}

export const toolCalibration = new ToolCalibration();

export class EnvironmentEffects {
    constructor() {
        this.emiNoise = 0;
        this.temperature = 25;
        this.humidity = 0;
    }

    setEnvironment(ambientTemp, humidity, emiNoise) {
        this.temperature = ambientTemp;
        this.humidity = humidity;
        this.emiNoise = emiNoise;
    }

    applyNoise(measurement, source) {
        if (this.emiNoise > 0) {
            const noise = (Math.random() - 0.5) * this.emiNoise * measurement * 0.1;
            return measurement + noise;
        }
        return measurement;
    }

    getTemperatureEffect() {
        if (this.temperature > 35) {
            return (this.temperature - 35) * 0.01;
        }
        return 0;
    }

    getHumidityEffect() {
        return this.humidity * 0.02;
    }
}

export const environmentEffects = new EnvironmentEffects();
