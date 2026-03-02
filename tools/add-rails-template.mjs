#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { baselinePhoneRails, makeRail } from "./rail-templates.mjs";
import { PMIC_MAIN } from "./pmic-profiles.mjs";

const ROOT = process.cwd();
const BOARDS_DIR = path.join(ROOT, "assets", "boards");

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8"); }

function listBoards() {
  return fs.readdirSync(BOARDS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith("."))
    .map(d => d.name);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { board: null, all: false, withProbeStub: false, pmicProfile: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--board") out.board = args[++i];
    else if (a === "--all") out.all = true;
    else if (a === "--with-probe-stub") out.withProbeStub = true;
    else if (a === "--pmic-profile") out.pmicProfile = args[++i];
  }
  return out;
}

function railsFromPmicProfile(profile) {
  const out = [];

  // Primary power inputs
  out.push(makeRail({ id: "VBAT", label: "Battery", type: "input", minV: 3.0, maxV: 4.4 }));
  out.push(makeRail({ id: "VPH_PWR", label: "PMIC Main (VPH_PWR)", type: "system", minV: 3.0, maxV: 4.4, depends_on: ["VBAT"] }));

  for (const [reg, spec] of Object.entries(profile.regulators || {})) {
    const r = makeRail({
      id: spec.rail,
      label: `${spec.rail} (${reg})`,
      type: spec.type,
      minV: spec.minV,
      maxV: spec.maxV,
      depends_on: ["VPH_PWR"],
    });

    r.domain = spec.domain;
    r.source = { pmic: profile.id, regulator: reg, mode: spec.mode };
    r.state = { default: "S0" };

    if (spec.rail === "VDD_IO_1V8" || spec.rail === "VDD_IO_3V0") {
      r.state.default = "ALW";
    }

    out.push(r);
  }

  // USB input + rail
  out.push(makeRail({ id: "VBUS_5V", label: "USB VBUS 5V", type: "usb", minV: 4.75, maxV: 5.25 }));
  out.push(makeRail({ id: "VUSB", label: "USB Rail", type: "usb", minV: 4.75, maxV: 5.25, depends_on: ["VBUS_5V"] }));

  return out;
}

function resolveTemplateRails(pmicProfile) {
  if (!pmicProfile) return baselinePhoneRails();
  if (pmicProfile === "PMIC_MAIN") return railsFromPmicProfile(PMIC_MAIN);
  throw new Error(`Unknown --pmic-profile "${pmicProfile}". Supported: PMIC_MAIN`);
}

function addProbeStub(rail) {
  // Stub: 1 probe point per rail (koordinat 0,0 biar validator bisa fail/warn sesuai aturan kamu)
  // Lebih aman: kosongkan saja kalau belum siap. Jadi ini opsional.
  rail.probe_points = rail.probe_points ?? [];
  if (rail.probe_points.length === 0) {
    rail.probe_points.push({
      id: `TP_${rail.id}_1`,
      x: 0,
      y: 0,
      label: `TP ${rail.id}`,
    });
  }
  return rail;
}

function applyTemplateToBoard(boardId, { withProbeStub, pmicProfile }) {
  const dir = path.join(BOARDS_DIR, boardId);
  const railsPath = path.join(dir, "rails.json");
  if (!fs.existsSync(railsPath)) return { boardId, skipped: true, reason: "rails.json missing" };

  const railsJson = readJson(railsPath);
  if (!Array.isArray(railsJson.rails)) throw new Error(`${boardId}: rails.json must have rails[]`);

  const existing = new Set(railsJson.rails.map(r => r.id));
  const templateRails = resolveTemplateRails(pmicProfile)
    .filter(r => !existing.has(r.id))
    .map(r => (withProbeStub ? addProbeStub(r) : r));

  if (templateRails.length === 0) return { boardId, added: 0, changed: false };

  railsJson.rails.push(...templateRails);
  writeJson(railsPath, railsJson);

  return { boardId, added: templateRails.length, changed: true };
}

const { board, all, withProbeStub, pmicProfile } = parseArgs();
const targets = all ? listBoards() : (board ? [board] : []);

if (targets.length === 0) {
  console.log("Usage:");
  console.log("  node tools/add-rails-template.mjs --board <board_id> [--with-probe-stub] [--pmic-profile PMIC_MAIN]");
  console.log("  node tools/add-rails-template.mjs --all [--with-probe-stub] [--pmic-profile PMIC_MAIN]");
  process.exit(1);
}

const results = targets.map(id => applyTemplateToBoard(id, { withProbeStub, pmicProfile }));
console.log("add-rails-template report");
for (const r of results) {
  if (r.skipped) console.log(`${r.boardId}: SKIP (${r.reason})`);
  else console.log(`${r.boardId}: added ${r.added}`);
}
