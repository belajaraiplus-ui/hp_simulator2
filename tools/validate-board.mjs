#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function lintRailIdNaming(id, ctx) {
  if (!/^[A-Z0-9_]+$/.test(id)) warn(`${ctx}: rail id should be UPPER_SNAKE_CASE: "${id}"`);
  if (/V\dP\d/.test(id)) warn(`${ctx}: avoid V1P8 style, prefer _1V8: "${id}"`);
}

const ALLOWED_DOMAINS = new Set(["AP", "MODEM", "RF", "CAMERA", "AUDIO", "STORAGE", "SENSOR", "POWER", "OTHER"]);

function validateContinuity(continuity, ctx) {
  if (continuity === undefined || typeof continuity === "boolean") return;
  if (!isPlainObject(continuity)) {
    warn(`${ctx}: defaults.continuity should be object or boolean`);
    return;
  }

  const beep = continuity.beep_below_ohms;
  const open = continuity.open_above_ohms;

  if (beep !== undefined && (!isNumber(beep) || beep < 0)) {
    warn(`${ctx}: defaults.continuity.beep_below_ohms should be number >= 0`);
  }
  if (open !== undefined && (!isNumber(open) || open < 0)) {
    warn(`${ctx}: defaults.continuity.open_above_ohms should be number >= 0`);
  }
  if (isNumber(beep) && isNumber(open) && beep > open) {
    warn(`${ctx}: defaults.continuity.beep_below_ohms should be <= open_above_ohms`);
  }
}

function validateOverlayBounds(rail, w, h, errors) {
  const overlay = rail.overlay;
  const polys = Array.isArray(overlay) ? overlay : (overlay?.polys ?? []);
  for (const poly of polys) {
    for (const [x, y] of (poly ?? [])) {
      if (typeof x !== "number" || typeof y !== "number") continue;
      if (x < 0 || y < 0 || x > w || y > h) {
        errors.push(`Rail ${rail.id}: overlay point out of bounds (${x},${y}) vs ${w}x${h}`);
        return;
      }
    }
  }
}

function validateOverlay(overlay, ctx, board) {
  if (!overlay) return;
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) {
    fail(`${ctx}: overlay must be object { type, polys }`);
  }
  if (overlay.type !== "multi_poly") {
    fail(`${ctx}: overlay.type must be "multi_poly"`);
  }
  if (!Array.isArray(overlay.polys)) {
    fail(`${ctx}: overlay.polys must be array of polygons`);
  }

  const w = board?.data_space?.width_px ?? board?.image?.full_width_px;
  const h = board?.data_space?.height_px ?? board?.image?.full_height_px;

  overlay.polys.forEach((poly, i) => {
    if (!Array.isArray(poly) || poly.length < 3) {
      fail(`${ctx}: overlay.polys[${i}] must be polygon with >= 3 points`);
    }
    poly.forEach((pt, j) => {
      if (!Array.isArray(pt) || pt.length !== 2) fail(`${ctx}: overlay.polys[${i}][${j}] must be [x,y]`);
      const [x, y] = pt;
      if (!isNumber(x) || !isNumber(y)) fail(`${ctx}: overlay point must be numbers`);
      if (x < 0 || y < 0) warn(`${ctx}: overlay point negative (${x},${y})`);
      if (w && h) {
        if (x > w || y > h) warn(`${ctx}: overlay point outside bounds (${x},${y}) vs (${w},${h})`);
      }
    });
  });
}

function validateProbePoints(probes, board, ctx, probeIds) {
  if (!probes) return;
  if (!Array.isArray(probes)) fail(`${ctx}: probe_points must be array`);
  probes.forEach((p, i) => {
    if (typeof p.id !== "string" || !p.id) fail(`${ctx}: probe_points[${i}].id required`);
    if (probeIds) {
      if (probeIds.has(p.id)) fail(`${ctx}: duplicate probe id (global) "${p.id}"`);
      probeIds.add(p.id);
    }
    if (!isNumber(p.x) || !isNumber(p.y)) fail(`${ctx}: probe_points[${i}] must have numeric x,y`);
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

function validateRailMetadata(rail, ctx) {
  if (rail.domain !== undefined) {
    if (typeof rail.domain !== "string" || !ALLOWED_DOMAINS.has(rail.domain)) {
      warn(`${ctx}: invalid domain "${rail.domain}" (should be one of: ${[...ALLOWED_DOMAINS].join(", ")})`);
    }
  }

  if (rail.source !== undefined) {
    if (typeof rail.source !== "object" || Array.isArray(rail.source)) fail(`${ctx}: source must be object`);
    if (typeof rail.source.pmic !== "string" || !rail.source.pmic) fail(`${ctx}: source.pmic required string`);
    if (typeof rail.source.regulator !== "string" || !rail.source.regulator) fail(`${ctx}: source.regulator required string`);
    if (rail.source.mode !== undefined) {
      const modes = new Set(["buck", "ldo", "boost", "switch", "charger", "other"]);
      if (!modes.has(rail.source.mode)) fail(`${ctx}: source.mode invalid "${rail.source.mode}"`);
    }
  }

  if (rail.state !== undefined) {
    if (!isPlainObject(rail.state)) fail(`${ctx}: state must be object`);
    const allowedDefaults = new Set(["ALW", "S0", "SLEEP", "OFF"]);
    if (typeof rail.state.default !== "string" || !allowedDefaults.has(rail.state.default)) {
      fail(`${ctx}: state.default must be one of: ${[...allowedDefaults].join(", ")}`);
    }
    if (rail.state.enabled_by !== undefined) {
      if (!Array.isArray(rail.state.enabled_by)) fail(`${ctx}: state.enabled_by must be array of strings`);
      rail.state.enabled_by.forEach((x, i) => {
        if (typeof x !== "string" || !x) fail(`${ctx}: state.enabled_by[${i}] must be non-empty string`);
      });
    }
  }

  if (rail.tags !== undefined) {
    if (!Array.isArray(rail.tags)) fail(`${ctx}: tags must be array of strings`);
    rail.tags.forEach((x, i) => {
      if (typeof x !== "string" || !x) fail(`${ctx}: tags[${i}] must be non-empty string`);
    });
  }
}

export function findOrphanRails(rails) {
  const ids = new Set(rails.map(r => r.id));

  // Smartphone recommendation: treat VBAT/VBUS/VPH_PWR as primary sources if exist
  const preferred = ["VBAT", "VBUS_5V", "VPH_PWR"];
  const rootCandidates = preferred.filter(x => ids.has(x));

  const sources = new Set(
    rails
      .filter(r => !r.depends_on || r.depends_on.length === 0)
      .map(r => r.id)
  );

  const roots = rootCandidates.length ? new Set(rootCandidates) : sources;

  const reachable = new Set();
  const children = new Map();
  for (const r of rails) {
    for (const d of (r.depends_on || [])) {
      if (!children.has(d)) children.set(d, []);
      children.get(d).push(r.id);
    }
  }

  const q = [...roots];
  while (q.length) {
    const cur = q.shift();
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    for (const ch of (children.get(cur) || [])) q.push(ch);
  }

  const orphans = rails
    .map(r => r.id)
    .filter(id => !reachable.has(id));

  return {
    roots: [...roots],
    reachable: [...reachable],
    orphans,
  };
}

export function validateOrphanRails(rails, allowedOrphans = []) {
  const orphanState = findOrphanRails(rails);
  const allowed = new Set(allowedOrphans);

  for (const id of allowed) {
    if (!rails.some(r => r.id === id)) {
      throw new Error(`orphan exception references unknown rail: ${id}`);
    }
  }

  const unresolved = orphanState.orphans.filter(id => !allowed.has(id));
  return {
    ...orphanState,
    unresolved,
    allowed: [...allowed],
  };
}

function topoLintRails(rails, ctx, allowedOrphans = []) {
  const ids = new Set(rails.map(r => r.id));
  const deps = new Map(); // id -> [depIds]
  for (const r of rails) deps.set(r.id, Array.isArray(r.depends_on) ? r.depends_on : []);

  // Missing refs + self-ref (kalau belum)
  for (const [id, ds] of deps.entries()) {
    for (const d of ds) {
      if (d === id) fail(`${ctx}: rail "${id}" depends_on itself`);
      if (!ids.has(d)) fail(`${ctx}: rail "${id}" depends_on missing rail "${d}"`);
    }
  }

  // Cycle detection (DFS colors)
  const color = new Map(); // 0=unvisited,1=visiting,2=done
  const stack = [];

  function dfs(u) {
    color.set(u, 1);
    stack.push(u);
    for (const v of (deps.get(u) || [])) {
      const c = color.get(v) || 0;
      if (c === 0) dfs(v);
      else if (c === 1) {
        // cycle found: v ... u -> v
        const idx = stack.lastIndexOf(v);
        const cycle = stack.slice(idx).concat(v);
        fail(`${ctx}: depends_on cycle detected: ${cycle.join(" -> ")}`);
      }
    }
    stack.pop();
    color.set(u, 2);
  }

  for (const id of ids) {
    if ((color.get(id) || 0) === 0) dfs(id);
  }

  // Orphan detection: rails not reachable from primary roots.
  let orphanResult;
  try {
    orphanResult = validateOrphanRails(rails, allowedOrphans);
  } catch (e) {
    fail(`${ctx}: ${e.message}`);
  }

  if (orphanResult.unresolved.length > 0) {
    fail(
      `${ctx}: orphan rail(s) unresolved from roots ${orphanResult.roots.join(", ")}: ${orphanResult.unresolved.join(", ")}`
    );
  }
  for (const id of orphanResult.orphans) {
    if (orphanResult.allowed.includes(id)) {
      warn(`${ctx}: orphan rail allowed by validation_exceptions.orphan_rails: ${id}`);
    }
  }

  const children = new Map();
  for (const r of rails) {
    for (const d of (r.depends_on || [])) {
      if (!children.has(d)) children.set(d, []);
      children.get(d).push(r.id);
    }
  }

  // Optional: produce "level" ordering hint
  const indeg = new Map();
  for (const id of ids) indeg.set(id, 0);
  for (const [id, ds] of deps.entries()) {
    for (const d of ds) indeg.set(id, (indeg.get(id) || 0) + 1);
  }
  const level = new Map();
  const queue = [];
  for (const id of ids) if ((indeg.get(id) || 0) === 0) { queue.push(id); level.set(id, 0); }
  while (queue.length) {
    const u = queue.shift();
    const uLvl = level.get(u) || 0;
    for (const ch of (children.get(u) || [])) {
      indeg.set(ch, (indeg.get(ch) || 0) - 1);
      level.set(ch, Math.max(level.get(ch) || 0, uLvl + 1));
      if ((indeg.get(ch) || 0) === 0) queue.push(ch);
    }
  }

  // Warn if a rail depends_on something that has >= its level (shouldn't happen if DAG, but helps)
  for (const r of rails) {
    const rLvl = level.get(r.id);
    if (rLvl === undefined) continue;
    for (const d of (r.depends_on || [])) {
      const dLvl = level.get(d);
      if (dLvl !== undefined && dLvl >= rLvl) {
        warn(`${ctx}: suspicious ordering: ${r.id} (lvl ${rLvl}) depends_on ${d} (lvl ${dLvl})`);
      }
    }
  }
}

function validateRails(railsJson, boardJson, boardId) {
  // === rails.json root contract ===
  // REQUIRED: version (number)
  if (!railsJson || railsJson.version === undefined) fail(`${boardId}: rails.json version required`);
  if (!isNumber(railsJson.version)) fail(`${boardId}: rails.json version must be number`);
  
  // REQUIRED: rails: Rail[]
  const rails = railsJson?.rails;
  if (!Array.isArray(rails)) fail(`${boardId}: rails.json rails[] required`);
  if (!rails.length) fail(`${boardId}: rails.json rails[] must not be empty`);
  
  // OPTIONAL: defaults.continuity (for fallback)
  validateContinuity(railsJson.defaults?.continuity, `${boardId}: rails.json`);

  const ids = new Set();
  const probeIds = new Set();
  rails.forEach((r, idx) => {
    const ctx = `${boardId}: rails[${idx}]`;
    if (typeof r.id !== "string" || !r.id) fail(`${ctx}: id required`);
    if (ids.has(r.id)) fail(`${ctx}: duplicate rail id "${r.id}"`);
    ids.add(r.id);

    // Lint: naming conventions
    lintRailIdNaming(r.id, ctx);

    // REQUIRED: label (string)
    if (typeof r.label !== "string" || !r.label) fail(`${ctx}: label required`);

    // REQUIRED: type (enum)
    const allowedTypes = new Set(["input", "power", "system", "logic", "core", "peripheral", "usb", "camera", "other"]);
    if (typeof r.type !== "string" || !r.type) fail(`${ctx}: type required`);
    if (!allowedTypes.has(r.type)) fail(`${ctx}: type must be one of: ${[...allowedTypes].join(", ")}`);

    // REQUIRED: expected.voltage_v.min/max
    if (!r.expected || !r.expected.voltage_v) {
      fail(`${ctx}: expected.voltage_v required`);
    } else {
      const v = r.expected.voltage_v;
      if (!isNumber(v.min) || !isNumber(v.max)) fail(`${ctx}: expected.voltage_v.min/max required numbers`);
      if (v.min > v.max) fail(`${ctx}: voltage_v.min > voltage_v.max`);
    }

    // REQUIRED: overlay { type: "multi_poly", polys: number[][][] }
    // Rule: overlay must always be object (not direct array) for extensibility and consistency
    if (!r.overlay) fail(`${ctx}: overlay required`);
    if (Array.isArray(r.overlay)) fail(`${ctx}: overlay must be object with { type, polys }, not direct array`);
    if (typeof r.overlay !== "object") fail(`${ctx}: overlay must be object`);
    if (r.overlay.type !== "multi_poly") fail(`${ctx}: overlay.type must be "multi_poly"`);
    if (!Array.isArray(r.overlay.polys)) fail(`${ctx}: overlay.polys required`);

    // REQUIRED: probe_points { id, x, y, label? }[]
    if (!r.probe_points || !Array.isArray(r.probe_points)) fail(`${ctx}: probe_points[] required`);

    // OPTIONAL: depends_on: string[] (rail ids)
    // Rule: must be array of strings, no self-reference
    if (r.depends_on) {
      if (!Array.isArray(r.depends_on)) fail(`${ctx}: depends_on must be array`);
      for (const dep of r.depends_on) {
        if (typeof dep !== "string") fail(`${ctx}: depends_on must contain strings`);
        if (dep === r.id) fail(`${ctx}: depends_on cannot have self-reference to "${r.id}"`);
      }
    }

    // OPTIONAL metadata for phone rails template
    validateRailMetadata(r, `${ctx} (${r.id})`);

    // overlay + probes
    validateOverlay(r.overlay, `${ctx} (${r.id})`, boardJson);
    validateProbePoints(r.probe_points, boardJson, `${ctx} (${r.id})`, probeIds);
    
    // Validate overlay bounds
    const w = boardJson?.data_space?.width_px ?? boardJson?.image?.full_width_px;
    const h = boardJson?.data_space?.height_px ?? boardJson?.image?.full_height_px;
    const errors = [];
    validateOverlayBounds(r, w, h, errors);
    errors.forEach(e => warn(e));
  });

  validatePsuInjection(railsJson.psu_injection, ids, `${boardId}: rails.json`);

  const orphanAllowList = railsJson?.validation_exceptions?.orphan_rails ?? [];
  if (!Array.isArray(orphanAllowList)) {
    fail(`${boardId}: rails.json validation_exceptions.orphan_rails must be array`);
  }
  orphanAllowList.forEach((x, i) => {
    if (typeof x !== "string" || !x) {
      fail(`${boardId}: rails.json validation_exceptions.orphan_rails[${i}] must be non-empty string`);
    }
  });

  topoLintRails(railsJson.rails, `${boardId}: topology`, orphanAllowList);

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

function validateThermalIntegrity(railsJson, thermalJson, boardId) {
  if (!thermalJson) fail(`${boardId}: missing thermal.json`);
  
  const validZones = new Set(['board']);
  if (Array.isArray(thermalJson.zones)) {
    thermalJson.zones.forEach(z => {
      if (typeof z.id !== "string") fail(`${boardId}: thermal.json zone missing string id`);
      validZones.add(z.id);
    });
  }

  const rails = railsJson?.rails;
  if (Array.isArray(rails)) {
    rails.forEach((rail, idx) => {
      const ctx = `${boardId}: rails[${idx}] (${rail.id})`;
      if (rail.thermal_zone !== undefined) {
        if (typeof rail.thermal_zone !== 'string') fail(`${ctx}: 'thermal_zone' must be a string`);
        if (!validZones.has(rail.thermal_zone)) {
          fail(`${ctx}: references missing thermal zone "${rail.thermal_zone}" in thermal.json`);
        }
      }
    });
  }
  ok(`${boardId}: thermal integrity OK`);
}

function validateSourceAssets(dir, boardId) {
  const sourceDir = path.join(dir, "source");
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    fail(`${boardId}: missing source/ directory`);
  }

  const candidates = fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => /\.(png|jpe?g)$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  if (!candidates.length) {
    fail(`${boardId}: source/ must contain at least one PNG or JPG image`);
  }
  if (candidates.length > 1) {
    warn(`${boardId}: source/ contains multiple images, API will serve "${candidates[0]}"`);
  }
}

function validateBoardFolder(boardRoot, boardId) {
  const dir = path.join(boardRoot, boardId);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(`Board folder missing: ${dir}`);

  const boardJson = readJson(path.join(dir, "board.json"));
  const railsJson = readJson(path.join(dir, "rails.json"));
  const compsJson = readJson(path.join(dir, "components.json"));
  const topJson = readJson(path.join(dir, "topology.json"));
  const thermalJson = readJson(path.join(dir, "thermal.json"));

  // === board.json contract enforcement (REQUIRED) ===
  if (!boardJson?.image?.full_width_px) fail(`${boardId}: board.json image.full_width_px required`);
  if (!boardJson?.image?.full_height_px) fail(`${boardId}: board.json image.full_height_px required`);
  if (!boardJson?.data_space?.width_px) fail(`${boardId}: board.json data_space.width_px required`);
  if (!boardJson?.data_space?.height_px) fail(`${boardId}: board.json data_space.height_px required`);
  if (!boardJson?.data_space?.origin) fail(`${boardId}: board.json data_space.origin required`);
  if (boardJson?.id !== boardId) fail(`${boardId}: board.json id must match folder/manifest id`);
  
  if (!boardJson?.tiles?.url_template) warn(`${boardId}: board.json missing tiles.url_template`);
  if (boardJson?.tiles?.url_template && !boardJson.tiles.url_template.startsWith(`/api/boards/${boardId}/tiles/`)) {
    fail(`${boardId}: board.json tiles.url_template must target this board id`);
  }

  const expectedEndpoints = new Map([
    ["source_url", `/api/boards/${boardId}/source`],
    ["components_url", `/api/boards/${boardId}/components`],
    ["rails_url", `/api/boards/${boardId}/rails`],
    ["topology_url", `/api/boards/${boardId}/topology`],
    ["thermal_url", `/api/boards/${boardId}/thermal`],
  ]);
  for (const [key, expected] of expectedEndpoints.entries()) {
    if (typeof boardJson[key] !== "string" || !boardJson[key]) {
      fail(`${boardId}: board.json ${key} required`);
    }
    if (boardJson[key] !== expected) {
      fail(`${boardId}: board.json ${key} must be "${expected}"`);
    }
  }

  validateSourceAssets(dir, boardId);
  const railIds = validateRails(railsJson, boardJson, boardId);
  validateComponents(compsJson, boardId);
  validateTopology(topJson, railIds, boardId);
  validateThermalIntegrity(railsJson, thermalJson, boardId);
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
    if (b.board_url && b.board_url !== `/api/boards/${b.id}/board`) {
      fail(`manifest.boards[${i}].board_url must be "/api/boards/${b.id}/board"`);
    }
    console.log(`\n--- Validating board: ${b.id} ---`);
    validateBoardFolder(boardRoot, b.id);
  });

  console.log("\n✅ All boards validated.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
