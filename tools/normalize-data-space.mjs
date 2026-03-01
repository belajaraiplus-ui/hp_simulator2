import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BOARDS_DIR = path.join(ROOT, "assets", "boards");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function roundUp(n, step = 50) {
  if (!Number.isFinite(n) || n <= 0) return step;
  return Math.ceil(n / step) * step;
}

function extractPolys(overlay) {
  if (!overlay) return [];
  if (Array.isArray(overlay)) return overlay;
  if (Array.isArray(overlay.polys)) return overlay.polys;
  return [];
}

function scanBoard(boardId) {
  const dir = path.join(BOARDS_DIR, boardId);
  const boardPath = path.join(dir, "board.json");
  const railsPath = path.join(dir, "rails.json");

  if (!fs.existsSync(boardPath) || !fs.existsSync(railsPath)) {
    return { boardId, skipped: true, reason: "missing board.json or rails.json" };
  }

  const board = readJson(boardPath);
  const rails = readJson(railsPath);

  let maxX = 0;
  let maxY = 0;

  for (const rail of rails) {
    // probe points
    for (const p of (rail.probe_points || [])) {
      if (typeof p.x === "number") maxX = Math.max(maxX, p.x);
      if (typeof p.y === "number") maxY = Math.max(maxY, p.y);
    }
    // overlays
    const polys = extractPolys(rail.overlay);
    for (const poly of polys) {
      for (const pt of (poly || [])) {
        const x = pt?.[0], y = pt?.[1];
        if (typeof x === "number") maxX = Math.max(maxX, x);
        if (typeof y === "number") maxY = Math.max(maxY, y);
      }
    }
  }

  // beri margin supaya tidak mepet
  const margin = 20;
  const dataW = roundUp(maxX + margin, 50);
  const dataH = roundUp(maxY + margin, 50);

  const imgW = board?.image?.full_width_px ?? null;
  const imgH = board?.image?.full_height_px ?? null;

  board.data_space = {
    width_px: dataW,
    height_px: dataH,
    origin: "top_left"
  };

  writeJson(boardPath, board);

  const sx = (imgW && dataW) ? (imgW / dataW) : null;
  const sy = (imgH && dataH) ? (imgH / dataH) : null;

  return { boardId, maxX, maxY, dataW, dataH, imgW, imgH, sx, sy, skipped: false };
}

function listBoards() {
  return fs.readdirSync(BOARDS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(name => !name.startsWith("."));
}

const boardIds = listBoards();
const results = boardIds.map(scanBoard);

console.log("\nnormalize-data-space report");
console.log("=".repeat(80));
for (const r of results) {
  if (r.skipped) {
    console.log(`${r.boardId}: SKIP (${r.reason})`);
    continue;
  }
  const sx = r.sx ? r.sx.toFixed(2) : "n/a";
  const sy = r.sy ? r.sy.toFixed(2) : "n/a";
  console.log(
    `${r.boardId}: max=(${r.maxX},${r.maxY}) data=${r.dataW}x${r.dataH} img=${r.imgW}x${r.imgH} scale=(${sx},${sy})`
  );
}
console.log("=".repeat(80));
console.log("Done.\n");
