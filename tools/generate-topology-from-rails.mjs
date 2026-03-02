#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BOARDS_DIR = path.join(ROOT, "assets", "boards");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function listBoards() {
  return fs.readdirSync(BOARDS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name);
}

function parseArgs(argv) {
  const out = { boards: [], all: false, write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") out.all = true;
    else if (a === "--write") out.write = true;
    else if (a === "--board") {
      const v = argv[i + 1];
      if (!v) throw new Error("--board requires a value");
      out.boards.push(v);
      i += 1;
    } else if (a === "--help" || a === "-h") {
      console.log("Usage:");
      console.log("  node tools/generate-topology-from-rails.mjs --all [--write]");
      console.log("  node tools/generate-topology-from-rails.mjs --board <board_id> [--write]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (!out.all && out.boards.length === 0) {
    throw new Error("Specify --all or --board <board_id>");
  }
  return out;
}

function inferKind(fromId, toRail) {
  const from = String(fromId || "").toUpperCase();
  const to = String(toRail?.id || "").toUpperCase();
  const t = String(toRail?.type || "").toLowerCase();

  if ((from === "VBUS_5V" || from === "VCHG" || from === "VUSB") && (to === "VBAT" || to === "VCHG")) {
    return "charger";
  }
  if (t === "core" || t === "system") return "buck";
  if (t === "logic" || t === "camera" || t === "peripheral") return "ldo";
  if (t === "usb" || t === "power" || t === "input") return "switch";
  return "switch";
}

function normalizeEdges(rawEdges, nodeSet) {
  if (!Array.isArray(rawEdges)) return [];
  return rawEdges.filter((e) =>
    e && typeof e === "object" &&
    typeof e.from === "string" &&
    typeof e.to === "string" &&
    nodeSet.has(e.from) &&
    nodeSet.has(e.to)
  );
}

function generateForBoard(boardId, write) {
  const dir = path.join(BOARDS_DIR, boardId);
  const railsPath = path.join(dir, "rails.json");
  const topologyPath = path.join(dir, "topology.json");
  if (!fs.existsSync(railsPath)) return { boardId, skipped: "missing rails.json" };

  const railsJson = readJson(railsPath);
  const rails = Array.isArray(railsJson.rails) ? railsJson.rails : [];
  if (!rails.length) return { boardId, skipped: "rails[] empty" };

  const nodes = rails.map((r) => r.id).filter((id) => typeof id === "string" && id.trim());
  const nodeSet = new Set(nodes);

  const prevTopo = fs.existsSync(topologyPath) ? readJson(topologyPath) : { version: 1, nodes: [], edges: [] };
  const prevEdges = normalizeEdges(prevTopo.edges, nodeSet);
  const prevKindByPair = new Map();
  for (const e of prevEdges) {
    prevKindByPair.set(`${e.from}|${e.to}`, typeof e.kind === "string" ? e.kind : "switch");
  }

  const generated = [];
  const seen = new Set();
  let skippedDepends = 0;

  for (const rail of rails) {
    const to = rail.id;
    const deps = Array.isArray(rail.depends_on) ? rail.depends_on : [];
    for (const from of deps) {
      if (typeof from !== "string" || !nodeSet.has(from) || from === to) {
        skippedDepends += 1;
        continue;
      }
      const pair = `${from}|${to}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      const kind = prevKindByPair.get(pair) ?? inferKind(from, rail);
      generated.push({ from, to, kind });
    }
  }

  // Keep valid legacy edges that are not expressible from depends_on yet.
  for (const e of prevEdges) {
    const pair = `${e.from}|${e.to}`;
    if (!seen.has(pair)) {
      seen.add(pair);
      generated.push({ from: e.from, to: e.to, kind: typeof e.kind === "string" ? e.kind : "switch" });
    }
  }

  const nextTopo = {
    version: Number.isFinite(prevTopo.version) ? prevTopo.version : 1,
    nodes,
    edges: generated,
  };

  const oldText = fs.existsSync(topologyPath) ? fs.readFileSync(topologyPath, "utf8") : "";
  const newText = JSON.stringify(nextTopo, null, 2) + "\n";
  const changed = oldText !== newText;
  if (write && changed) writeJson(topologyPath, nextTopo);

  return {
    boardId,
    changed,
    wrote: write && changed,
    nodes: nodes.length,
    edges: generated.length,
    skippedDepends,
  };
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }

  const targets = opts.all ? listBoards() : opts.boards;
  const mode = opts.write ? "WRITE" : "DRY-RUN";
  console.log(`generate-topology-from-rails report (${mode})`);
  for (const boardId of targets) {
    const r = generateForBoard(boardId, opts.write);
    if (r.skipped) {
      console.log(`- ${r.boardId}: SKIP (${r.skipped})`);
      continue;
    }
    const status = r.changed ? (r.wrote ? "UPDATED" : "CHANGED") : "OK";
    console.log(`- ${r.boardId}: ${status} nodes=${r.nodes} edges=${r.edges} skipped_dep=${r.skippedDepends}`);
  }
}

main();
