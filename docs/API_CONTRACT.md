# HP Repair Simulator - API Contract

**Version:** 1.0  
**Last Updated:** 2026-02-23

## Overview

This document defines the formal API contract between the Web UI and the Rust Engine (WASM). All communication MUST follow this contract for stability and proper error handling.

---

## Request Format

All requests MUST be JSON objects with the following structure:

```json
{
  "version": 1,
  "kind": "step" | "measure" | "snapshot" | "stop" | "tool" | "scenario",
  "tool": "string (optional)",
  "params": { ... } (optional),
  "tool_action": { ... } (optional),
  "scenario": "string (optional)"
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | `number` | **Required.** Must be `1`. Other versions will be rejected. |
| `kind` | `string` | **Required.** Action type. See valid values below. |

### Valid `kind` Values

| Value | Description |
|-------|-------------|
| `step` | Advance simulation by one timestep |
| `measure` | Perform a multimeter measurement |
| `snapshot` | Get current state snapshot |
| `stop` | Terminate the current session |
| `tool` | Control external tools (PSU, VCHG, etc.) |
| `scenario` | Load a scenario profile |

---

## Response Format

All responses follow this structure:

```json
{
  "ok": true | false,
  "code": "string (only if ok=false)",
  "message": "string (only if ok=false)",
  "snapshot": { ... } (only for snapshot kind),
  "measurement": { ... } (only for measure kind)
}
```

### Success Response

```json
{
  "ok": true
}
```

Or with data:

```json
{
  "ok": true,
  "snapshot": { ... }
}
```

### Error Response

```json
{
  "ok": false,
  "code": "ERR_INVALID_JSON",
  "message": "Detailed error message"
}
```

---

## Error Codes

| Code | HTTP Equivalent | Description |
|------|-----------------|-------------|
| `ERR_INVALID_JSON` | 400 | Malformed JSON in request |
| `ERR_INVALID_VERSION` | 400 | Missing or unsupported version field |
| `ERR_INVALID_KIND` | 400 | Invalid or unknown `kind` value |
| `ERR_NOT_INITIALIZED` | 503 | Engine not initialized. Call `init()` first. |
| `ERR_LOCK_FAILED` | 503 | Failed to acquire engine context |
| `ERR_INVALID_PARAMS` | 400 | Missing required parameters for the action |
| `ERR_UNKNOWN_ACTION` | 500 | Unhandled action type |
| `ERR_MEASUREMENT_FAILED` | 500 | Measurement operation failed |
| `ERR_TOOL_FAILED` | 500 | Tool operation failed |
| `ERR_SCENARIO_FAILED` | 500 | Scenario loading failed |
| `ERR_INTERNAL_ERROR` | 500 | Unexpected internal error |

---

## API Endpoints

### 1. Initialize Engine

**Note:** This is called once at startup from JavaScript.

```javascript
import init from "./engine.js";
await init();
init(0.01); // dt = 10ms timestep
```

### 2. Step Simulation

Advance the simulation by one timestep.

**Request:**
```json
{
  "version": 1,
  "kind": "step"
}
```

**Response:**
```json
{
  "ok": true
}
```

### 3. Measure (Multimeter)

Perform a measurement on a rail or component.

**Request:**
```json
{
  "version": 1,
  "kind": "measure",
  "tool": "vbat"
}
```

Valid tool labels:
- `vbat`, `voltage`, `battery` - Voltage measurement
- `vcore`, `core` - Core voltage
- `vio` - I/O voltage
- `soc temp` - SoC temperature
- `board temp` - Board temperature
- `diode` - Diode mode
- `ohm`, `resistance` - Resistance
- `continuity`, `beep` - Continuity test

**Response:**
```json
{
  "ok": true,
  "measurement": 4.2
}
```

### 4. Get Snapshot

Get current system state including rails, thermals, measurements, and distress.

**Request:**
```json
{
  "version": 1,
  "kind": "snapshot"
}
```

**Response:**
```json
{
  "ok": true,
  "snapshot": {
    "time": 12.5,
    "rails": [
      { "name": "Vbat", "voltage": 4.2 },
      { "name": "Vcore", "voltage": 1.1 }
    ],
    "thermals": [
      { "zone": "Soc", "temperature": 45.2 },
      { "zone": "Board", "temperature": 32.1 }
    ],
    "measurements": [
      {
        "time": 10.0,
        "target": "vbat",
        "observed_value": 4.18,
        "noise": 0.01,
        "injected_energy": 0.0,
        "stress_added": 0.0
      }
    ],
    "power_input": {
      "enabled": true,
      "voltage": 4.2,
      "current_limit": 2.0,
      "measured_current": 0.5,
      "target_rail": "Vbat"
    },
    "distress": 0.15
  }
}
```

### 5. Tool Control

Control external tools like PSU.

**Request:**
```json
{
  "version": 1,
  "kind": "tool",
  "tool": "psu",
  "params": {
    "voltage": 4.2,
    "current_limit": 2.0,
    "enabled": true
  }
}
```

Or using `tool_action` (recommended):

```json
{
  "version": 1,
  "kind": "tool",
  "tool_action": {
    "TogglePSU": { "enabled": true }
  }
}
```

```json
{
  "version": 1,
  "kind": "tool",
  "tool_action": {
    "SetPSUVoltage": { "voltage": 5.0 }
  }
}
```

**Tool Actions:**
- `TogglePSU` - Enable/disable PSU
- `SetPSUVoltage` - Set output voltage
- `SetPSUCurrent` - Set current limit
- `SetPSUTargetRail` - Set PSU target rail (string id, or "none" to clear)
- `ToggleVCHG` - Enable/disable USB charger
- `SetVCHGVoltage` - Set charger voltage

### 6. Load Scenario

Load a scenario profile.

**Request:**
```json
{
  "version": 1,
  "kind": "scenario",
  "scenario": "dead_battery"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Scenario 'dead_battery' loaded. World: Dead Battery Scenario",
  "profile": {
    "name": "Dead Battery Scenario",
    "ambient_temperature": 25.0,
    ...
  }
}
```

### 7. Stop Session

Terminate the current session.

**Request:**
```json
{
  "version": 1,
  "kind": "stop"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Session stopped"
}
```

---

## Board Assets: `rails.json`

`rails.json` is served by `pcb-registry` at `/api/boards/:id/rails`. The top-level structure:

```json
{
  "version": 1,
  "defaults": { ... },
  "psu_injection": {
    "enabled": true,
    "path": ["direct", "diode", "fuse", "switch", "connector"],
    "series_resistance_ohm": 0.05,
    "max_voltage_v": 5.5,
    "max_current_a": 3.0,
    "backfeed": {
      "allowed": true,
      "targets": ["VSYS", "VIO"],
      "equiv_resistance_ohm": 1.2
    }
  },
  "rails": [ ... ]
}
```

Notes:
- `psu_injection` is optional.
- `psu_injection.path` can be a string or an array of strings.
- `backfeed` is optional.

---

## JavaScript Adapter Usage

```javascript
import { bootEngine, step, snapshot, measureTool, applyPsuConfig } from "./engine/adapter.js";

// Initialize
await bootEngine();

// Step simulation
step();
const state = snapshot();

// Measure
const voltage = measureTool("vbat");

// Configure PSU
applyPsuConfig({
  voltage: 4.2,
  currentLimit: 2.0,
  enabled: true
});
```

---

## Error Handling Example

```javascript
import { snapshot } from "./engine/adapter.js";

try {
  const state = snapshot();
  if (!state.ok) {
    console.error("API Error:", state.code, state.message);
    return;
  }
  // Use state.snapshot
} catch (e) {
  console.error("Network/transport error:", e);
}
```

---

## Versioning Policy

- Current API version: **1**
- The `version` field is **required** in all requests
- Requests without version or with unsupported version will be rejected with `ERR_INVALID_VERSION`
- Future versions will be announced in release notes

---

## Changelog

### v1.0 (2026-02-23)
- Initial API contract
- Added structured error codes
- Added version field requirement
- Added contract validation module
- Added safe dispatch wrapper for JS
