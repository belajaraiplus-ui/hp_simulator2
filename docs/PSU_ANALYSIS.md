# PSU (Power Supply Unit) System Analysis Report

## Overview

This document analyzes the PSU (Power Supply Unit) implementation in the HP Simulator engine - **Updated February 2026**.

---

## 1. Data Structures

### 1.1 PowerInput (`engine/src/state/electrical.rs:7-35`)

```rust
pub struct PowerInput {
    pub voltage: f64,           // PSU output voltage (V)
    pub current_limit: f64,      // Current limit (A)
    pub psu_series_r_ohm: f64,  // Series resistance (Ohm)
    pub enabled: bool,          // PSU on/off state
    pub measured_current: f64,  // Actual current being drawn (A)
    pub vchg_enabled: bool,      // VCHG (USB charging) enable
    pub vchg_voltage: f64,      // VCHG voltage (typically 5V)
    pub target_rail: Option<RailId>, // Target rail for PSU injection
    pub psu_mode: PsuMode,      // CV, CC, Off, Fault
    pub ovp_threshold: f64,      // Over Voltage Protection threshold
    pub uvp_threshold: f64,      // Under Voltage Protection threshold
    pub ocp_threshold: f64,      // Over Current Protection threshold
    pub output_ripple_pp: f64,   // Output ripple (V peak-to-peak)
    pub load_response_time: f64, // Load response time constant
    pub psu_temperature: f64,    // PSU internal temperature
    pub cv_setpoint: f64,       // Constant Voltage setpoint
    pub cc_setpoint: f64,       // Constant Current setpoint
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PsuMode {
    #[default]
    CV,    // Constant Voltage mode
    CC,    // Constant Current mode
    Off,   // PSU off
    Fault, // Protection fault triggered
}
```

---

## 2. PSU Physics Model (Updated)

### 2.1 CV/CC Mode Switching

```rust
// Determine PSU mode based on load
if current_ratio >= 0.95 {
    psu_mode = PsuMode::CC;  // Current limiting active
} else if voltage_error > 0.1 && current_ratio < 0.9 {
    psu_mode = PsuMode::CV;  // Voltage regulation active
}
```

### 2.2 Protection Circuits

```rust
// OVP - Over Voltage Protection
if ovp_threshold > 0.0 && rail_voltage > ovp_threshold {
    psu_mode = PsuMode::Fault;
    enabled = false;
}

// UVP - Under Voltage Protection  
if uvp_threshold > 0.0 && rail_voltage < uvp_threshold {
    psu_mode = PsuMode::Fault;
    enabled = false;
}

// OCP - Over Current Protection
if ocp_threshold > 0.0 && total_load > ocp_threshold {
    psu_mode = PsuMode::Fault;
    enabled = false;
}
```

### 2.3 PSU Ripple Simulation

```rust
// Add switching ripple to rail noise
let ripple_freq = 100_000.0;  // 100kHz typical
let ripple = sin(time * ripple_freq * 2π) * ripple_pp / 2.0;
rail.noise += ripple * 0.1;
```

---

## 3. API Controls (Updated)

### 3.1 New Tool Actions

```rust
SetPSUMode { mode: String },    // "cv", "cc", "off"
SetPSUOVP { threshold: f64 },  // Set OVP threshold (V)
SetPSUUVP { threshold: f64 },  // Set UVP threshold (V)
SetPSURipple { ripple_vpp: f64 }, // Set output ripple (Vpp)
ResetPSUFault {},              // Reset fault and re-enable PSU
```

### 3.2 Example Usage

```javascript
// Enable PSU with CV mode, OVP, and ripple
dispatchToolAction({ 
    tool: "psu", 
    params: { voltage: 4.2, current_limit: 2.0, enabled: true, target_rail: "vbat" } 
});

// Configure protection
dispatchToolAction({ SetPSUOVP: { threshold: 5.5 } });
dispatchToolAction({ SetPSUUVP: { threshold: 3.0 } });
dispatchToolAction({ SetPSURipple: { ripple_vpp: 0.1 } });

// Reset after fault
dispatchToolAction({ ResetPSUFault: {} });
```

---

## 4. Summary (Updated)

### Physics Accuracy: 🟢 Good

| Aspect | Implementation | Quality |
|--------|---------------|---------|
| Voltage output | ✅ Ohm's law with series R | Good |
| Current limiting | ✅ Clamp to limit | Good |
| Inrush current | ✅ Exponential decay | Good |
| Thermal derating | ✅ Stress-based | Good |
| **CV/CC Modes** | ✅ **NEW** | Good |
| **OVP/UVP/OCP** | ✅ **NEW** | Good |
| **Ripple Simulation** | ✅ **NEW** | Good |
| PSU temperature | ✅ NEW | Basic |

### Features Added (Feb 2026)

1. **CV/CC Mode Switching** - Automatic transition based on load
2. **OVP** - Over Voltage Protection
3. **UVP** - Under Voltage Protection  
4. **OCP** - Over Current Protection
5. **PSU Ripple** - 100kHz switching noise
6. **PSU Temperature** - Internal temperature simulation

---

*Generated: Feb 2026*
*Engine Version: 0.1.0*
