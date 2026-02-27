#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function fail(msg) {
  console.error("❌", msg);
  process.exit(1);
}

function warn(msg) {
  console.warn("⚠️", msg);
}

function ok(msg) {
  console.log("✅", msg);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) fail(`Missing file: ${filePath}`);
  const raw = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail(`Invalid JSON in ${filePath}: ${e.message}`);
  }
}

function isNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function validateOverlay(overlay, ctx) {
  if (!overlay) return;
  let polys = overlay;
  if (!Array.isArray(overlay)) {
    if (overlay && typeof overlay === "object" && Array.isArray(overlay.polys)) {
      polys = overlay.polys;
    } else {
      fail(`${ctx}: overlay must be array of polygons or object with polys`);
    }
  }

  polys.forEach((poly, i) => {
    if (!Array.isArray(poly) || poly.length < 3) {
      fail(`${ctx}: overlay[${i}] must be polygon with >= 3 points`);
    }
    poly.forEach((pt, j) => {
      if (!Array.isArray(pt) || pt.length !== 2) fail(`${ctx}: overlay[${i}][${j}] must be [x,y]`);
      const [x, y] = pt;
      if (!isNumber(x) || !isNumber(y)) fail(`${ctx}: overlay point must be numbers`);
      if (x < 0 || y < 0) warn(`${ctx}: overlay point negative (${x},${y})`);
    });
  });
}

function validateProbePoints(probes, board, ctx) {
  if (!probes) return;
  if (!Array.isArray(probes)) fail(`${ctx}: probe_points must be array`);
  const w = board?.image?.full_width_px;
  const h = board?.image?.full_height_px;
  if (!isNumber(w) || !isNumber(h)) warn(`board.json missing image.full_width_px/full_height_px; bounds check skipped`);

  probes.forEach((p, i) => {
    if (typeof p.id !== "string" || !p.id) fail(`${ctx}: probe_points[${i}].id required`);
    if (!isNumber(p.x) || !isNumber(p.y)) fail(`${ctx}: probe_points[${i}] must have numeric x,y`);
    if (w && h) {
      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
        warn(`${ctx}: probe ${p.id} outside image bounds (${p.x},${p.y}) vs (${w},${h})`);
      }
    }
  });
}

function validatePsuInjection(inj, railIds, ctx) {
  if (!inj) return;
  if (typeof inj !== "object") fail(`${ctx}: psu_injection must be object`);

  if (inj.enabled !== undefined && typeof inj.enabled !== "boolean")
    fail(`${ctx}: psu_injection.enabled must be boolean`);

  if (inj.path !== undefined) {
    const allowed = new Set(["direct", "diode", "fuse", "switch", "connector"]);
    if (typeof inj.path === "string") {
      if (!allowed.has(inj.path)) {
        fail(`${ctx}: psu_injection.path must be one of: ${[...allowed].join(", ")}`);
      }
    } else if (Array.isArray(inj.path)) {
      if (!inj.path.length) fail(`${ctx}: psu_injection.path must not be empty`);
      inj.path.forEach((p) => {
        if (typeof p !== "string" || !allowed.has(p)) {
          fail(`${ctx}: psu_injection.path must be one of: ${[...allowed].join(", ")}`);
        }
      });
    } else {
      fail(`${ctx}: psu_injection.path must be string or array`);
    }
  }

  ["series_resistance_ohm", "max_voltage_v", "max_current_a"].forEach((k) => {
    if (inj[k] !== undefined && !isNumber(inj[k]))
      fail(`${ctx}: psu_injection.${k} must be number`);
    if (isNumber(inj[k]) && inj[k] < 0)
      fail(`${ctx}: psu_injection.${k} must be >= 0`);
  });

  if (inj.backfeed !== undefined) {
    const bf = inj.backfeed;
    if (!bf || typeof bf !== "object") fail(`${ctx}: psu_injection.backfeed must be object`);

    if (bf.allowed !== undefined && typeof bf.allowed !== "boolean")
      fail(`${ctx}: psu_injection.backfeed.allowed must be boolean`);

    if (bf.targets !== undefined) {
      if (!Array.isArray(bf.targets)) fail(`${ctx}: psu_injection.backfeed.targets must be array`);
      bf.targets.forEach((t) => {
        if (typeof t !== "string") fail(`${ctx}: backfeed.targets must be string rail ids`);
        if (!railIds.has(t)) fail(`${ctx}: backfeed.targets references missing rail "${t}"`);
      });
    }

    if (bf.equiv_resistance_ohm !== undefined) {
      if (!isNumber(bf.equiv_resistance_ohm) || bf.equiv_resistance_ohm < 0)
        fail(`${ctx}: psu_injection.backfeed.equiv_resistance_ohm must be number >= 0`);
    }
  }
}

function validateRails(railsJson, boardJson, boardId) {
  if (!railsJson || railsJson.version === undefined) warn(`${boardId}: rails.json missing version`);
  const rails = railsJson?.rails;
  if (!Array.isArray(rails)) fail(`${boardId}: rails.json must contain { rails: [...] }`);

  const ids = new Set();
  rails.forEach((r, idx) => {
    const ctx = `${boardId}: rails[${idx}]`;
    if (typeof r.id !== "string" || !r.id) fail(`${ctx}: id required`);
    if (ids.has(r.id)) fail(`${ctx}: duplicate rail id "${r.id}"`);
    ids.add(r.id);

    if (!r.expected || !r.expected.voltage_v) warn(`${ctx}: expected.voltage_v missing`);
    else {
      const v = r.expected.voltage_v;
      if (v.min !== undefined && !isNumber(v.min)) fail(`${ctx}: expected.voltage_v.min must be number`);
      if (v.max !== undefined && !isNumber(v.max)) fail(`${ctx}: expected.voltage_v.max must be number`);
      if (isNumber(v.min) && isNumber(v.max) && v.min > v.max) fail(`${ctx}: voltage_v.min > voltage_v.max`);
    }

    // depends_on
    if (r.depends_on) {
      if (!Array.isArray(r.depends_on)) fail(`${ctx}: depends_on must be array`);
    }

    // overlay + probes
    validateOverlay(r.overlay, `${ctx} (${r.id})`);
    validateProbePoints(r.probe_points, boardJson, `${ctx} (${r.id})`);
  });

  validatePsuInjection(railsJson.psu_injection, ids, `${boardId}: rails.json`);

  // depends_on references valid rails
  rails.forEach((r, idx) => {
    const ctx = `${boardId}: rails[${idx}] (${r.id})`;
    (r.depends_on || []).forEach((dep) => {
      if (!ids.has(dep)) fail(`${ctx}: depends_on references missing rail "${dep}"`);
    });
  });

  ok(`${boardId}: rails.json OK (${rails.length} rails)`);
  return ids;
}

function validateComponents(compJson, boardId) {
  const comps = compJson?.components;
  if (!Array.isArray(comps)) fail(`${boardId}: components.json must contain { components: [...] }`);
  comps.forEach((c, idx) => {
    const ctx = `${boardId}: components[${idx}]`;
    if (typeof c.id !== "string" || !c.id) fail(`${ctx}: id required`);
    if (c.bbox) {
      const { x, y, w, h } = c.bbox;
      if (![x, y, w, h].every(isNumber)) fail(`${ctx}: bbox must have numeric x,y,w,h`);
    }
  });
  ok(`${boardId}: components.json OK (${comps.length} components)`);
}

function validateTopology(topJson, railIds, boardId) {
  if (!topJson) fail(`${boardId}: missing topology.json`);
  if (topJson.version === undefined) warn(`${boardId}: topology.json missing version`);

  const nodes = topJson.nodes;
  const edges = topJson.edges;

  if (!Array.isArray(nodes) || !nodes.length) fail(`${boardId}: topology.nodes must be non-empty array`);
  if (!Array.isArray(edges)) fail(`${boardId}: topology.edges must be array`);

  const nodeSet = new Set(nodes);
  // nodes should exist in rails
  nodes.forEach((n) => {
    if (!railIds.has(n)) fail(`${boardId}: topology node "${n}" not found in rails.json`);
  });

  // edges valid
  const allowedKinds = new Set(["charger", "buck", "ldo", "switch", "always_on", "load"]);
  edges.forEach((e, idx) => {
    const ctx = `${boardId}: topology.edges[${idx}]`;
    if (!e || typeof e !== "object") fail(`${ctx}: must be object`);
    if (typeof e.from !== "string" || typeof e.to !== "string") fail(`${ctx}: from/to required`);
    if (!nodeSet.has(e.from)) fail(`${ctx}: from "${e.from}" not in topology.nodes`);
    if (!nodeSet.has(e.to)) fail(`${ctx}: to "${e.to}" not in topology.nodes`);
    if (typeof e.kind !== "string") fail(`${ctx}: kind required`);
    if (!allowedKinds.has(e.kind)) warn(`${ctx}: unknown kind "${e.kind}" (allowed: ${[...allowedKinds].join(", ")})`);
  });

  // quick cycle detection (optional warning)
  const adj = new Map();
  nodes.forEach((n) => adj.set(n, []));
  edges.forEach((e) => adj.get(e.from).push(e.to));

  const visiting = new Set();
  const visited = new Set();
  function dfs(n) {
    if (visiting.has(n)) return true; // cycle
    if (visited.has(n)) return false;
    visiting.add(n);
    for (const nx of adj.get(n) || []) {
      if (dfs(nx)) return true;
    }
    visiting.delete(n);
    visited.add(n);
    return false;
  }

  let hasCycle = false;
  for (const n of nodes) {
    if (dfs(n)) { hasCycle = true; break; }
  }
  if (hasCycle) warn(`${boardId}: topology has a cycle (check power tree)`);

  ok(`${boardId}: topology.json OK (${nodes.length} nodes, ${edges.length} edges)`);
}

function validateBoardFolder(boardRoot, boardId) {
  const dir = path.join(boardRoot, boardId);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(`Board folder missing: ${dir}`);

  const boardJson = readJson(path.join(dir, "board.json"));
  const railsJson = readJson(path.join(dir, "rails.json"));
  const compsJson = readJson(path.join(dir, "components.json"));
  const topJson = readJson(path.join(dir, "topology.json"));

  // board.json minimal
  if (!boardJson?.image?.full_width_px || !boardJson?.image?.full_height_px) {
    warn(`${boardId}: board.json missing image full size; some validations skipped`);
  }
  if (!boardJson?.tiles?.url_template) warn(`${boardId}: board.json missing tiles.url_template`);

  const railIds = validateRails(railsJson, boardJson, boardId);
  validateComponents(compsJson, boardId);
  validateTopology(topJson, railIds, boardId);
}

function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const boardRoot = path.resolve(__dirname, "../assets/boards");
  const manifestPath = path.join(boardRoot, "manifest.json");
  const manifest = readJson(manifestPath);

  const boards = manifest.boards;
  if (!Array.isArray(boards) || !boards.length) fail(`manifest.json must contain { boards: [...] }`);

  ok(`Loaded manifest: ${boards.length} board(s)`);

  boards.forEach((b, i) => {
    if (!b.id) fail(`manifest.boards[${i}] missing id`);
    console.log(`\n--- Validating board: ${b.id} ---`);
    validateBoardFolder(boardRoot, b.id);
  });

  console.log("\n✅ All boards validated.");
}

main();
