import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { findOrphanRails, validateOrphanRails } from '../validate-board.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function testSyntheticOrphanDetected() {
  const rails = [
    { id: 'VBUS_5V', depends_on: [] },
    { id: 'VBAT', depends_on: ['VBUS_5V'] },
    { id: 'OTHER_ROOT', depends_on: [] },
    { id: 'VFLOATING', depends_on: ['OTHER_ROOT'] },
  ];

  const orphanState = findOrphanRails(rails);
  assert.ok(orphanState.orphans.includes('OTHER_ROOT'));
  assert.ok(orphanState.orphans.includes('VFLOATING'));

  const validated = validateOrphanRails(rails, []);
  assert.ok(validated.unresolved.includes('OTHER_ROOT'));
  assert.ok(validated.unresolved.includes('VFLOATING'));
}

function testA55HasNoUnresolvedOrphans() {
  const railsPath = path.join(
    repoRoot,
    'assets',
    'boards',
    'samsung_galaxy_a55_5g',
    'rails.json'
  );
  const railsJson = readJson(railsPath);
  const rails = railsJson.rails;
  const allow = railsJson?.validation_exceptions?.orphan_rails ?? [];

  const result = validateOrphanRails(rails, allow);
  assert.deepEqual(result.unresolved, []);
}

testSyntheticOrphanDetected();
testA55HasNoUnresolvedOrphans();

console.log('validate-board orphan tests: OK');
