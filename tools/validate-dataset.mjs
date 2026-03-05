#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const DATASET_ROOT = process.argv[2];
if (!DATASET_ROOT) {
  console.error('Usage: node tools/validate-dataset.mjs <dataset-root>');
  process.exit(1);
}

const USE_CASES = ['no_power', 'fake_charging', 'thermal_runaway'];
const CHARGER_TYPES = new Set(['usb', 'pd', 'dc']);
const INSTRUMENT_GRADE = new Set(['lab', 'field', 'synthetic_placeholder']);
const MISSING_POLICY = new Set(['drop', 'interpolate']);
const OUTLIER_POLICY = new Set(['clip', 'remove', 'none']);

function isNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateTraceObject(doc, relPath) {
  const errors = [];
  if (!doc || typeof doc !== 'object') {
    return ['Document must be an object'];
  }

  const md = doc.metadata;
  if (!md || typeof md !== 'object') errors.push('metadata missing or invalid');
  else {
    if (!md.board_id || typeof md.board_id !== 'string') errors.push('metadata.board_id invalid');
    if (!isNumber(md.ambient_temp_c)) errors.push('metadata.ambient_temp_c invalid');
    if (!isNumber(md.humidity) || md.humidity < 0 || md.humidity > 100) errors.push('metadata.humidity invalid');
    if (!isNumber(md.battery_soc) || md.battery_soc < 0 || md.battery_soc > 100) errors.push('metadata.battery_soc invalid');
    if (!CHARGER_TYPES.has(md.charger_type)) errors.push('metadata.charger_type invalid');
  }

  const scenario = doc.scenario;
  if (!scenario || typeof scenario !== 'object') errors.push('scenario missing or invalid');
  else {
    if (!USE_CASES.includes(scenario.use_case)) errors.push('scenario.use_case invalid');
    if (!scenario.world_profile || typeof scenario.world_profile !== 'string') errors.push('scenario.world_profile invalid');
    if (!(scenario.initial_fault_assumption === null || typeof scenario.initial_fault_assumption === 'string')) {
      errors.push('scenario.initial_fault_assumption invalid');
    }
    const expectedFromPath = USE_CASES.find((name) => relPath.startsWith(`${name}/`));
    if (expectedFromPath && scenario.use_case !== expectedFromPath) {
      errors.push(`scenario.use_case mismatch folder ${expectedFromPath}`);
    }
  }

  const quality = doc.quality;
  if (!quality || typeof quality !== 'object') errors.push('quality missing or invalid');
  else {
    if (!INSTRUMENT_GRADE.has(quality.instrument_grade)) errors.push('quality.instrument_grade invalid');
    if (!MISSING_POLICY.has(quality.missing_data_policy)) errors.push('quality.missing_data_policy invalid');
    if (!OUTLIER_POLICY.has(quality.outlier_policy)) errors.push('quality.outlier_policy invalid');
  }

  if (!Array.isArray(doc.trace) || doc.trace.length < 3) errors.push('trace must be array with min 3 samples');
  else {
    let previous = -1;
    doc.trace.forEach((sample, idx) => {
      if (!sample || typeof sample !== 'object') {
        errors.push(`trace[${idx}] invalid`);
        return;
      }
      if (!isNumber(sample.timestamp_ms) || sample.timestamp_ms < 0) errors.push(`trace[${idx}].timestamp_ms invalid`);
      if (isNumber(sample.timestamp_ms) && sample.timestamp_ms < previous) errors.push(`trace[${idx}] timestamp regression`);
      previous = sample.timestamp_ms;
      const rv = sample.rail_voltage_v;
      if (!rv || typeof rv !== 'object') errors.push(`trace[${idx}].rail_voltage_v invalid`);
      else {
        ['VBAT', 'VBUS', 'VSYS'].forEach((rail) => {
          if (!isNumber(rv[rail])) errors.push(`trace[${idx}].rail_voltage_v.${rail} invalid`);
        });
      }
      if (!isNumber(sample.input_current_a) || sample.input_current_a < 0) errors.push(`trace[${idx}].input_current_a invalid`);
      if (!(sample.surface_temp_c === null || isNumber(sample.surface_temp_c))) errors.push(`trace[${idx}].surface_temp_c invalid`);
    });
  }

  return errors;
}

async function listJsonFiles(dir) {
  const output = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await listJsonFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      output.push(full);
    }
  }
  return output;
}

const rootStat = await stat(DATASET_ROOT);
if (!rootStat.isDirectory()) {
  console.error('Dataset root must be directory');
  process.exit(1);
}

const files = (await listJsonFiles(DATASET_ROOT))
  .map((f) => path.relative(DATASET_ROOT, f))
  .filter((f) => !f.startsWith('schema/'));

const errors = [];
const perCaseCounts = Object.fromEntries(USE_CASES.map((u) => [u, 0]));
for (const relFile of files) {
  const fullPath = path.join(DATASET_ROOT, relFile);
  const payload = JSON.parse(await readFile(fullPath, 'utf8'));
  const fileErrors = validateTraceObject(payload, relFile);
  if (fileErrors.length > 0) {
    errors.push(`${relFile}:\n  - ${fileErrors.join('\n  - ')}`);
  } else {
    perCaseCounts[payload.scenario.use_case] += 1;
  }
}

for (const uc of USE_CASES) {
  if (perCaseCounts[uc] === 0) {
    errors.push(`missing traces for use case ${uc}`);
  }
}

if (errors.length > 0) {
  console.error('Dataset validation failed:\n' + errors.join('\n'));
  process.exit(1);
}

console.log('Dataset validation passed');
console.log(JSON.stringify({ files: files.length, per_use_case: perCaseCounts }, null, 2));
