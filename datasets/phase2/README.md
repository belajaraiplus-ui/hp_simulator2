# Phase 2 Calibration Dataset

This dataset is structured for the deterministic calibration pipeline introduced in Phase 2.

## Layout

- `schema/measurement_trace.schema.json`: canonical schema for all trace files.
- `no_power/`: traces for zero-power and near-zero-power behaviors.
- `fake_charging/`: traces where charging indicators diverge from real charge transfer.
- `thermal_runaway/`: traces where thermal behavior is part of the benchmark.

## Data quality note

Current traces are **synthetic placeholders** (see `quality.instrument_grade = "synthetic_placeholder"`) to unblock end-to-end pipeline development. They satisfy the schema and are deterministic.

When real measurement traces are available, drop them into the same per-use-case folders with the same JSON format. No code changes should be required.

## File naming recommendation

Use `{board_id}_{use_case}_{variant}.json`.
