# Thermal System Analysis Report

## Overview

This document analyzes the current thermal physics and logic implementation in the HP Simulator engine.

---

## 1. Data Structures

### 1.1 ThermalZone (`engine/src/state/mod.rs:14-19`)

```rust
pub struct ThermalZone {
    pub id: String,              // Unique identifier (e.g., "soc", "pmic_zone", "board")
    pub temp_c: f64,             // Current temperature in Celsius
    pub thermal_mass: f64,       // Thermal mass (J/°C) - capacity to store heat
    pub heat_dissipation: f64,   // Heat dissipation coefficient (W/°C)
}
```

**Parameters:**
| Parameter | Unit | Description |
|-----------|------|-------------|
| `thermal_mass` | J/°C | Higher = slower temperature changes |
| `heat_dissipation` | W/°C | Higher = faster heat removal to ambient |

### 1.2 ThermalLink (`engine/src/state/mod.rs:21-26`)

```rust
pub struct ThermalLink {
    pub a: String,       // First zone ID
    pub b: String,      // Second zone ID  
    pub conductance: f64, // Thermal conductance between zones (W/°C)
}
```

### 1.3 ThermalState (`engine/src/state/mod.rs:28-34`)

```rust
pub struct ThermalState {
    pub ambient_c: f64,           // Ambient temperature (°C)
    pub zones: HashMap<String, ThermalZone>,
    pub links: Vec<ThermalLink>,
    pub rail_zone: HashMap<String, String>, // Rail to thermal zone mapping
}
```

---

## 2. Physics Model

### 2.1 Heat Balance Equation

The core thermal simulation uses:

```
dT/dt = (P_in - P_loss) / thermal_mass
```

Where:
- `P_in` = Power dissipated in zone (Watts)
- `P_loss` = Heat dissipation = heat_dissipation × (T_zone - T_ambient)
- `thermal_mass` = Zone's heat capacity

### 2.2 Zone Temperature Evolution (`engine/src/state/mod.rs:68-77`)

```rust
for (id, z) in self.zones.iter() {
    let p = *power_w.get(id).unwrap_or(&0.0);      // Power input
    let loss = z.heat_dissipation * (z.temp_c - self.ambient_c);  // Heat loss
    let net = p - loss;                            // Net power
    let m = z.thermal_mass.max(1e-6);
    d_t.insert(id.clone(), (net / m) * dt);        // Temperature change
}
```

### 2.3 Inter-Zone Heat Flow (`engine/src/state/mod.rs:79-88`)

Heat flows between linked zones based on temperature difference:

```rust
for l in &self.links {
    let flow = conductance * (temp_a - temp_b);  // Fourier's law
    // Apply heat flow weighted by thermal masses
    d_t[zone_a] += -flow / mass_a;
    d_t[zone_b] += +flow / mass_b;
}
```

### 2.4 Temperature Clamping

```rust
z.temp_c = (z.temp_c + delta).clamp(-50.0_f64, 200.0_f64);
```

---

## 3. Power to Thermal Coupling

### 3.1 Rail Power Injection (`engine/src/core/engine.rs:60-69`)

Power from electrical rails is converted to heat:

```rust
// PSU input power
if let Some(zone_id) = state.thermal.rail_zone.get("psu_input").cloned() {
    let p = state.electrical.input.voltage * state.electrical.input.measured_current;
    state.thermal.add_power(&zone_id, p * 0.15, &mut power_map);  // 15% efficiency loss
}

// Per-rail power
for (rail_id, rail) in state.electrical.rails.iter() {
    if let Some(zone_id) = state.thermal.rail_zone.get(&rail_key).cloned() {
        let p = rail.state.voltage * rail.state.current;
        state.thermal.add_power(&zone_id, p * 0.1, &mut power_map);  // 10% conversion
    }
}
```

### 3.2 Coupling Efficiency

| Source | Efficiency | Notes |
|--------|-----------|-------|
| PSU Input | 15% | Represents switching losses |
| Rail Power | 10% | Represents power conversion inefficiency |

---

## 4. Thermal-Electrical Interaction

### 4.1 Thermal Derating (`engine/src/physics/electrical.rs:12-14`)

Current limit decreases as thermal stress increases:

```rust
let thermal_factor: f64 = 
    (1.0_f64 - state.stress.electrical * 0.02_f64).clamp(0.7_f64, 1.0_f64);
current_limit *= thermal_factor;
```

This simulates thermal throttling - as the system heats up, the available current limit decreases.

### 4.2 Stress Accumulation (`engine/src/state/mod.rs:90-96`)

```rust
let mut stress_delta = 0.0;
for (id, delta) in d_t {
    if let Some(z) = self.zones.get_mut(&id) {
        z.temp_c = (z.temp_c + delta).clamp(-50.0_f64, 200.0_f64);
        stress_delta += z.temp_c.max(0.0) * dt * 0.001;  // Accumulate thermal stress
    }
}
stress_delta
```

---

## 5. World Profile Effects

### 5.1 Thermal Parameters (`engine/src/world/profile.rs:31-32`)

```rust
pub thermal_dissipation: f64,  // <1.0 = worse cooling
pub thermal_coupling: f64,    // >1.0 = heat spreads faster
```

### 5.2 Profile Application (`engine/src/world/profile.rs:57-60`)

```rust
// Apply thermal characteristics from world profile
for (_id, zone) in state.thermal.zones.iter_mut() {
    zone.heat_dissipation *= profile.thermal_dissipation;
}
```

---

## 6. JSON Configuration Schema

### 6.1 thermal.json (`pcb-registry/src/model.rs:661-687`)

```json
{
  "version": 1,
  "ambient_c": 27.0,
  "zones": [
    {
      "id": "soc",
      "components": ["U9000"],
      "thermal_mass": 50.0,
      "heat_dissipation": 0.1
    }
  ],
  "links": [
    { "a": "soc", "b": "board", "conductance": 0.15 }
  ]
}
```

---

## 7. Current Limitations

### 7.1 Board Configuration Issues

| Board | Zones | Links | Status |
|-------|-------|-------|--------|
| hp_elitebook_840 | 1 | 1 | ⚠️ Basic |
| hp_pavilion_x360 | 1 | 0 | ❌ Minimal |

### 7.2 Missing Features

1. **No convection modeling** - Only conduction considered
2. **No radiation** - Heat radiation not simulated
3. **No phase change** - No thermal throttling simulation
4. **No heatsink modeling** - Thermal interfaces not configurable
5. **No fan cooling** - Active cooling not implemented

---

## 8. API Controls

### 8.1 Tool Actions

```rust
// Set ambient temperature
ToolAction::SetAmbientTemp { ambient_c: f64 }

// Create/update thermal zone
ToolAction::UpsertThermalZone { 
    id: String, 
    thermal_mass: f64, 
    heat_dissipation: f64 
}

// Connect thermal zones
ToolAction::SetThermalLinks { 
    links: Vec<(String, String, f64)>  // (zone_a, zone_b, conductance)
}

// Map rail to thermal zone
ToolAction::SetRailThermalZone { 
    rail: String, 
    zone: String 
}
```

---

## 9. Thermal Runaway Protection

### 9.1 Session Guard (`engine/src/session/guard.rs:7-22`)

```rust
// Check for thermal runaway
if state.thermal.zones.values().any(|z| z.temp_c > 150.0) {
    session.terminate(SessionEndReason::ThermalRunaway);
}
```

---

## 10. Summary

### Physics Accuracy: 🟢 Good (Updated)

| Aspect | Implementation | Quality |
|--------|---------------|---------|
| Conduction | ✅ Full | Good |
| Convection | ✅ NEW | Basic |
| Thermal Throttling | ✅ NEW | Implemented |
| Fan Cooling | ✅ NEW | Configurable |
| Thermal Coupling | ✅ Partial | Good |

### New Features Added (Feb 2026)

1. **Convection Modeling** - Natural and forced convection
2. **Thermal Throttling** - CPU performance reduction at high temp
3. **Fan Speed Control** - Active cooling simulation
4. **Extended Board Configuration** - More thermal zones per board

### API Controls (Updated)

```rust
// Fan speed control (0.0 - 1.0)
ToolAction::SetFanSpeed { speed: f64 }

// Configure throttling threshold
ToolAction::SetZoneThrottling { 
    zone: "soc", 
    threshold_c: 85.0 
}
```

### Board Configuration (Updated)

Thermal board profile now includes:
- Multiple thermal zones (for SoC, PMIC, battery, and board)
- Thermal links between zones
- Convection coefficients and surface areas
- Throttling thresholds

---

*Generated: Feb 2026*
*Engine Version: 0.1.0*

