#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BOARDS_DIR = path.join(ROOT, "assets", "boards");

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n"); }

function listBoards() {
  return fs.readdirSync(BOARDS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith("."))
    .map(d => d.name);
}

function migrateBoard(boardId) {
  const dir = path.join(BOARDS_DIR, boardId);
  const railsPath = path.join(dir, "rails.json");
  if (!fs.existsSync(railsPath)) return { boardId, skipped: true };

  const railsJson = readJson(railsPath);
  const rails = railsJson.rails;
  if (!Array.isArray(rails)) throw new Error(`${boardId}: rails.json missing rails[]`);

  // global probe id tracking
  const seenProbe = new Set();
  const warnings = [];
  const warn = (msg) => warnings.push(`${boardId}: ${msg}`);
  let changed = false;

  for (let idx = 0; idx < rails.length; idx++) {
    const r = rails[idx];
    const railId = typeof r.id === "string" && r.id ? r.id : `RAIL_${idx}`;
    const railCtx = `rails[${idx}] (${railId})`;

    if (typeof r.label !== "string" || !r.label.trim()) {
      r.label = railId;
      warn(`${railCtx}: label kosong -> pakai placeholder "${r.label}"`);
      changed = true;
    }
    if (typeof r.type !== "string" || !r.type.trim()) {
      r.type = "other";
      warn(`${railCtx}: type kosong -> pakai placeholder "other"`);
      changed = true;
    }

    // expected.voltage_v minimal + placeholder warning
    if (!r.expected || typeof r.expected !== "object" || Array.isArray(r.expected)) {
      r.expected = {};
      warn(`${railCtx}: expected tidak valid -> dibuat object kosong`);
      changed = true;
    }
    if (!r.expected.voltage_v || typeof r.expected.voltage_v !== "object" || Array.isArray(r.expected.voltage_v)) {
      r.expected.voltage_v = { min: 0, max: 0 };
      warn(`${railCtx}: expected.voltage_v kosong/tidak valid -> pakai placeholder { min: 0, max: 0 }`);
      changed = true;
    }
    if (!Number.isFinite(r.expected.voltage_v.min)) {
      r.expected.voltage_v.min = 0;
      warn(`${railCtx}: expected.voltage_v.min tidak valid -> placeholder 0`);
      changed = true;
    }
    if (!Number.isFinite(r.expected.voltage_v.max)) {
      r.expected.voltage_v.max = 0;
      warn(`${railCtx}: expected.voltage_v.max tidak valid -> placeholder 0`);
      changed = true;
    }

    // depends_on normalize
    if (r.depends_on === undefined || r.depends_on === null) {
      r.depends_on = [];
      changed = true;
    } else if (!Array.isArray(r.depends_on)) {
      r.depends_on = [String(r.depends_on)];
      changed = true;
    }

    // overlay normalize -> always object
    if (Array.isArray(r.overlay)) {
      r.overlay = { type: "multi_poly", polys: r.overlay };
      changed = true;
    } else if (r.overlay && typeof r.overlay === "object") {
      if (Array.isArray(r.overlay.polys) && !r.overlay.type) {
        r.overlay.type = "multi_poly";
        changed = true;
      }
    } else if (!r.overlay) {
      // optional: allow missing overlay? kalau mau wajib, isi polys kosong
      r.overlay = { type: "multi_poly", polys: [] };
      changed = true;
    }

    // probe id uniqueness (auto-fix ringan)
    if (Array.isArray(r.probe_points)) {
      for (const p of r.probe_points) {
        if (!p.id) continue;
        if (seenProbe.has(p.id)) {
          const base = `TP_${railId}_${p.id}`;
          let nextId = base;
          let n = 2;
          while (seenProbe.has(nextId)) {
            nextId = `${base}_${n++}`;
          }
          p.id = nextId;
          warn(`${railCtx}: probe id konflik -> rename ke "${p.id}"`);
          changed = true;
        }
        seenProbe.add(p.id);
      }
    } else if (!r.probe_points) {
      r.probe_points = [];
      changed = true;
    }
  }

  if (changed) writeJson(railsPath, railsJson);
  return { boardId, changed, warnings };
}

const boards = listBoards();
const res = boards.map(migrateBoard);

console.log("migrate-rails-schema-v2 report");
for (const r of res) {
  if (r.skipped) continue;
  console.log(`${r.boardId}: ${r.changed ? "UPDATED" : "OK"}`);
  for (const w of (r.warnings || [])) {
    console.warn(`WARN: ${w}`);
  }
}
