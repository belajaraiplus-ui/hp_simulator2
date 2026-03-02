#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BOARDS_DIR = path.join(ROOT, "assets", "boards");

const PHONE_RAILS = new Set([
  "VBAT",
  "VSYS",
  "VCORE",
  "VIO",
  "VDDR",
  "VPA",
  "VCAM",
  "VDISP",
  "VCHG",
  "VBUS_5V", // alias to VCHG in engine
]);

const DIRECT_MAP = new Map([
  ["VCCIN", "VCHG"],
  ["VCCSA", "VPA"],
  ["VCCFN", "VPA"],
  ["VDD_3V3", "VDISP"],
  ["VAUDIO", "VPA"],
  ["VRTC", "VPA"],
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function listBoards() {
  return fs.readdirSync(BOARDS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name);
}

function dedupeStringArray(items) {
  return [...new Set(items.filter((x) => typeof x === "string" && x.trim()))];
}

function mapRailId(rawId) {
  const id = String(rawId ?? "").trim().toUpperCase();
  if (!id) return { id, changed: false, reason: "empty" };
  if (PHONE_RAILS.has(id)) return { id, changed: false, reason: "known" };
  if (DIRECT_MAP.has(id)) {
    const mapped = DIRECT_MAP.get(id);
    return { id: mapped, changed: mapped !== id, reason: `direct:${id}` };
  }
  if (id.includes("3V3")) return { id: "VDISP", changed: true, reason: "heuristic:3V3" };
  if (id.includes("AUDIO") || id.includes("SPK")) return { id: "VPA", changed: true, reason: "heuristic:audio" };
  if (id.includes("RTC")) return { id: "VPA", changed: true, reason: "heuristic:rtc" };
  if (id.startsWith("VCC")) return { id: "VPA", changed: true, reason: "heuristic:vcc" };
  return { id, changed: false, reason: "unmapped" };
}

function parseArgs(argv) {
  const opts = { write: false, boards: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") {
      opts.write = true;
      continue;
    }
    if (a === "--board") {
      const board = argv[i + 1];
      if (!board) throw new Error("--board requires value");
      opts.boards.push(board);
      i += 1;
      continue;
    }
    if (a === "--help" || a === "-h") {
      console.log("Usage: node tools/remap-rails-to-phone.mjs [--board <id>] [--write]");
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

function remapBoard(boardId, { write }) {
  const dir = path.join(BOARDS_DIR, boardId);
  const railsPath = path.join(dir, "rails.json");
  const topologyPath = path.join(dir, "topology.json");
  if (!fs.existsSync(railsPath)) return { boardId, skipped: "missing rails.json" };

  const railsJson = readJson(railsPath);
  const rails = Array.isArray(railsJson.rails) ? railsJson.rails : [];
  const warnings = [];
  const renames = [];
  const errors = [];
  let changed = false;

  for (const rail of rails) {
    const oldId = String(rail.id ?? "").trim().toUpperCase();
    const mapped = mapRailId(oldId);
    if (mapped.reason === "unmapped") warnings.push(`unmapped rail id "${oldId}"`);
    if (mapped.changed || oldId !== mapped.id) {
      renames.push(`${oldId} -> ${mapped.id} (${mapped.reason})`);
      rail.id = mapped.id;
      changed = true;
    } else if (typeof rail.id !== "string" || rail.id !== oldId) {
      rail.id = oldId;
      changed = true;
    }

    if (Array.isArray(rail.depends_on)) {
      const nextDepends = dedupeStringArray(
        rail.depends_on.map((dep) => mapRailId(dep).id).filter((dep) => dep && dep !== rail.id)
      );
      if (JSON.stringify(nextDepends) !== JSON.stringify(rail.depends_on)) {
        rail.depends_on = nextDepends;
        changed = true;
      }
    }

    if (Array.isArray(rail.psu_injection?.backfeed?.targets)) {
      const nextTargets = dedupeStringArray(rail.psu_injection.backfeed.targets.map((t) => mapRailId(t).id));
      if (JSON.stringify(nextTargets) !== JSON.stringify(rail.psu_injection.backfeed.targets)) {
        rail.psu_injection.backfeed.targets = nextTargets;
        changed = true;
      }
    }
  }

  const byId = new Map();
  for (const rail of rails) {
    const id = String(rail.id ?? "");
    byId.set(id, (byId.get(id) || 0) + 1);
  }
  for (const [id, count] of byId.entries()) {
    if (count > 1) errors.push(`duplicate rail id after remap: ${id} x${count}`);
  }

  let topologyJson = null;
  if (fs.existsSync(topologyPath)) {
    topologyJson = readJson(topologyPath);
    const oldNodes = Array.isArray(topologyJson.nodes) ? topologyJson.nodes : [];
    const oldEdges = Array.isArray(topologyJson.edges) ? topologyJson.edges : [];
    const nextNodes = dedupeStringArray(oldNodes.map((n) => mapRailId(n).id));
    const nextEdges = [];
    const seenEdge = new Set();

    for (const edge of oldEdges) {
      if (!edge || typeof edge !== "object") continue;
      const from = mapRailId(edge.from).id;
      const to = mapRailId(edge.to).id;
      const kind = typeof edge.kind === "string" ? edge.kind : "switch";
      if (!from || !to) continue;
      const key = `${from}|${to}|${kind}|${edge.current_limit_a ?? ""}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      nextEdges.push({ ...edge, from, to, kind });
    }

    if (JSON.stringify(nextNodes) !== JSON.stringify(oldNodes)) {
      topologyJson.nodes = nextNodes;
      changed = true;
    }
    if (JSON.stringify(nextEdges) !== JSON.stringify(oldEdges)) {
      topologyJson.edges = nextEdges;
      changed = true;
    }
  }

  if (write && !errors.length && changed) {
    writeJson(railsPath, railsJson);
    if (topologyJson) writeJson(topologyPath, topologyJson);
  }

  return { boardId, changed, wrote: write && !errors.length && changed, renames, warnings, errors };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const boards = args.boards.length ? args.boards : listBoards();

  const reports = boards.map((boardId) => remapBoard(boardId, { write: args.write }));
  const action = args.write ? "WRITE" : "DRY-RUN";
  console.log(`remap-rails-to-phone report (${action})`);

  for (const r of reports) {
    if (r.skipped) {
      console.log(`- ${r.boardId}: SKIP (${r.skipped})`);
      continue;
    }
    const status = r.errors.length ? "ERROR" : (r.changed ? (r.wrote ? "UPDATED" : "CHANGED") : "OK");
    console.log(`- ${r.boardId}: ${status}`);
    if (r.renames.length) console.log(`  renames: ${r.renames.length}`);
    for (const w of r.warnings) console.warn(`  WARN: ${w}`);
    for (const e of r.errors) console.error(`  ERROR: ${e}`);
  }

  const hasErrors = reports.some((r) => Array.isArray(r.errors) && r.errors.length);
  if (hasErrors) process.exitCode = 2;
}

main();
