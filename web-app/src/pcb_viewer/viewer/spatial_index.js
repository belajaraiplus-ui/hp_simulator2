export function computeBoardSpaces(board) {
  const imgW = Number(board?.image?.full_width_px) || 1;
  const imgH = Number(board?.image?.full_height_px) || 1;
  const dataW = Number(board?.data_space?.width_px) || imgW;
  const dataH = Number(board?.data_space?.height_px) || imgH;
  const sx = imgW / Math.max(1, dataW);
  const sy = imgH / Math.max(1, dataH);
  return { imgW, imgH, dataW, dataH, sx, sy };
}

const HIDDEN_PROBE_BOARD_IDS = new Set([
  "samsung_galaxy_a55_5g",
  "samsung_galaxy_a15",
]);

function toFiniteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePoint(point) {
  if (!Array.isArray(point) || point.length < 2) return null;
  const x = toFiniteNumber(point[0]);
  const y = toFiniteNumber(point[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

function bboxFromPoints(points) {
  if (!Array.isArray(points) || !points.length) return null;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function mergeBoxes(boxes) {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return null;
  return {
    minX: Math.min(...valid.map((box) => box.minX)),
    minY: Math.min(...valid.map((box) => box.minY)),
    maxX: Math.max(...valid.map((box) => box.maxX)),
    maxY: Math.max(...valid.map((box) => box.maxY)),
  };
}

function bboxFromShape(shape) {
  if (!shape || typeof shape !== "object") return null;
  if (shape.type === "poly" && Array.isArray(shape.points)) {
    return bboxFromPoints(shape.points.map(normalizePoint).filter(Boolean));
  }
  return null;
}

function bboxFromComponent(component) {
  if (component?.bbox) {
    const x = toFiniteNumber(component.bbox.x);
    const y = toFiniteNumber(component.bbox.y);
    const w = toFiniteNumber(component.bbox.w);
    const h = toFiniteNumber(component.bbox.h);
    if ([x, y, w, h].every(Number.isFinite)) {
      return { minX: x, minY: y, maxX: x + w, maxY: y + h };
    }
  }
  return bboxFromShape(component?.shape);
}

function geometryLooksLikeImageSpace(box, spaces) {
  if (!box || !spaces) return false;
  const exceedsDataBounds = box.maxX > spaces.dataW * 1.05 || box.maxY > spaces.dataH * 1.05;
  const fitsImageBounds = box.maxX <= spaces.imgW * 1.05 && box.maxY <= spaces.imgH * 1.05;
  return exceedsDataBounds && fitsImageBounds;
}

function normalizeBoxToBoardSpace(box, spaces) {
  if (!box) return null;
  if (!geometryLooksLikeImageSpace(box, spaces)) return box;
  return {
    minX: box.minX / spaces.sx,
    minY: box.minY / spaces.sy,
    maxX: box.maxX / spaces.sx,
    maxY: box.maxY / spaces.sy,
  };
}

function normalizePointsToBoardSpace(points, spaces) {
  const box = bboxFromPoints(points);
  if (!geometryLooksLikeImageSpace(box, spaces)) return points;
  return points.map((point) => [point[0] / spaces.sx, point[1] / spaces.sy]);
}

function normalizeOverlayPolys(overlay) {
  if (!overlay) return [];
  const polys = Array.isArray(overlay)
    ? overlay
    : (Array.isArray(overlay.polys) ? overlay.polys : []);
  return polys
    .map((poly) => Array.isArray(poly) ? poly.map(normalizePoint).filter(Boolean) : [])
    .filter((poly) => poly.length >= 3);
}

function normalizeComponentPolys(component, spaces) {
  const shape = component?.shape;
  if (shape?.type === "poly" && Array.isArray(shape.points)) {
    const points = normalizePointsToBoardSpace(shape.points.map(normalizePoint).filter(Boolean), spaces);
    if (points.length >= 3) return [points];
  }

  const box = normalizeBoxToBoardSpace(bboxFromComponent(component), spaces);
  if (!box) return [];
  return [[
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ]];
}

function normalizeRailRefs(component) {
  const refs = new Set();
  const addRef = (value) => {
    if (typeof value === "string" && value.trim()) refs.add(value.trim());
  };

  (component?.hints?.rails || []).forEach(addRef);
  (component?.rails || []).forEach(addRef);
  (component?.pins || []).forEach((pin) => addRef(pin?.rail || pin?.railId));
  (component?.pads || []).forEach((pad) => addRef(pad?.rail || pad?.railId));
  if (component?.node?.rail) addRef(component.node.rail);

  return [...refs];
}

function boxCenter(box) {
  if (!box) return { x: 0, y: 0 };
  return {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
  };
}

function distanceBetweenBoxes(a, b) {
  const ac = boxCenter(a);
  const bc = boxCenter(b);
  const dx = ac.x - bc.x;
  const dy = ac.y - bc.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function normalizeComponentRuntime(component, index, spaces) {
  const polygons = normalizeComponentPolys(component, spaces);
  const bbox = mergeBoxes(polygons.map(bboxFromPoints)) || normalizeBoxToBoardSpace(bboxFromComponent(component), spaces);
  return {
    index,
    id: String(component?.id || component?.refdes || `component_${index}`),
    refdes: String(component?.refdes || component?.id || `U${index}`),
    label: String(component?.refdes || component?.id || `COMP_${index}`),
    kind: String(component?.kind || component?.type || "component"),
    tags: Array.isArray(component?.tags) ? component.tags.map(String) : [],
    rails: normalizeRailRefs(component),
    bbox,
    polygons,
    pins: Array.isArray(component?.pins) ? component.pins : [],
    pads: Array.isArray(component?.pads) ? component.pads : [],
    nodes: Array.isArray(component?.nodes) ? component.nodes : [],
    hints: component?.hints || {},
    electricalProperties: component?.electricalProperties || component?.electrical || {},
    raw: component,
  };
}

function hydrateComponentRails(components, railsById) {
  const railItems = Object.values(railsById || {});

  return components.map((component) => {
    const declaredRails = [...component.rails];
    const validRails = declaredRails.filter((railId) => railsById?.[railId]);

    if (validRails.length || !component.bbox || !railItems.length) {
      return {
        ...component,
        declaredRails,
        invalidRails: declaredRails.filter((railId) => !railsById?.[railId]),
        rails: validRails,
        measurementSource: validRails.length ? "declared" : "none",
      };
    }

    const derivedRails = [...railItems]
      .map((rail) => ({
        railId: rail.id,
        distance: distanceBetweenBoxes(component.bbox, rail.overlayBox || rail.bbox),
      }))
      .sort((left, right) => left.distance - right.distance || left.railId.localeCompare(right.railId))
      .slice(0, 2)
      .map((entry) => entry.railId);

    return {
      ...component,
      declaredRails,
      invalidRails: declaredRails,
      rails: derivedRails,
      measurementSource: derivedRails.length ? "derived" : "none",
    };
  });
}

function normalizeRailRuntime(rail, index, spaces, defaults) {
  const overlayPolys = normalizeOverlayPolys(rail?.overlay);
  const overlayBox = mergeBoxes(overlayPolys.map(bboxFromPoints));
  const probes = Array.isArray(rail?.probe_points) ? rail.probe_points : [];
  return {
    index,
    id: String(rail?.id || `rail_${index}`),
    label: String(rail?.label || rail?.id || `RAIL_${index}`),
    type: String(rail?.type || "other"),
    expected: rail?.expected || {},
    continuity: rail?.expected?.continuity || defaults?.continuity || null,
    overlayPolys,
    overlayBox,
    dependsOn: Array.isArray(rail?.depends_on) ? rail.depends_on.map(String) : [],
    probePoints: probes.map((probe, probeIndex) => {
      const x = toFiniteNumber(probe?.x);
      const y = toFiniteNumber(probe?.y);
      return {
        index: probeIndex,
        id: String(probe?.id || `${rail?.id || "rail"}_probe_${probeIndex}`),
        label: String(probe?.label || probe?.id || `${rail?.id || "rail"}_probe_${probeIndex}`),
        railId: String(rail?.id || ""),
        x,
        y,
        imageX: Number.isFinite(x) ? x * spaces.sx : null,
        imageY: Number.isFinite(y) ? y * spaces.sy : null,
      };
    }).filter((probe) => Number.isFinite(probe.x) && Number.isFinite(probe.y)),
    raw: rail,
  };
}

function itemArea(item) {
  const box = item?.bbox || item?.overlayBox;
  if (!box) return Number.POSITIVE_INFINITY;
  return Math.max(1, (box.maxX - box.minX) * (box.maxY - box.minY));
}

function getItemBox(item) {
  return item?.bbox || item?.overlayBox || null;
}

export function createSpatialIndex(items, options = {}) {
  const validItems = (Array.isArray(items) ? items : []).filter(Boolean);
  const fallbackCell = Number(options.cellSize);
  const cellSize = Number.isFinite(fallbackCell) && fallbackCell > 0 ? fallbackCell : 64;
  const buckets = new Map();

  for (const item of validItems) {
    const box = getItemBox(item);
    if (!box) continue;

    const minCellX = Math.floor(box.minX / cellSize);
    const maxCellX = Math.floor(box.maxX / cellSize);
    const minCellY = Math.floor(box.minY / cellSize);
    const maxCellY = Math.floor(box.maxY / cellSize);

    for (let cx = minCellX; cx <= maxCellX; cx += 1) {
      for (let cy = minCellY; cy <= maxCellY; cy += 1) {
        const key = `${cx}:${cy}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(item);
      }
    }
  }

  return { items: validItems, buckets, cellSize };
}

export function querySpatialIndex(index, x, y) {
  if (!index || !Number.isFinite(x) || !Number.isFinite(y)) return [];
  const cx = Math.floor(x / index.cellSize);
  const cy = Math.floor(y / index.cellSize);
  const key = `${cx}:${cy}`;
  const items = index.buckets.get(key);
  return Array.isArray(items) ? items : [];
}

export function querySpatialIndexRange(index, box) {
  if (!index || !box) return [];

  const minX = Number(box.minX);
  const minY = Number(box.minY);
  const maxX = Number(box.maxX);
  const maxY = Number(box.maxY);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return [];

  const minCellX = Math.floor(minX / index.cellSize);
  const maxCellX = Math.floor(maxX / index.cellSize);
  const minCellY = Math.floor(minY / index.cellSize);
  const maxCellY = Math.floor(maxY / index.cellSize);
  const seen = new Set();
  const results = [];

  for (let cx = minCellX; cx <= maxCellX; cx += 1) {
    for (let cy = minCellY; cy <= maxCellY; cy += 1) {
      const key = `${cx}:${cy}`;
      const items = index.buckets.get(key);
      if (!Array.isArray(items)) continue;

      for (const item of items) {
        if (seen.has(item)) continue;
        seen.add(item);
        results.push(item);
      }
    }
  }

  return results;
}

export function buildBoardRuntime({ board, rails = [], components = [], topology = null, thermal = null, railFile = null } = {}) {
  const spaces = computeBoardSpaces(board);
  const defaults = railFile?.defaults || {};
  const suppressProbePoints = HIDDEN_PROBE_BOARD_IDS.has(String(board?.id || ""));
  const normalizedRails = (Array.isArray(rails) ? rails : [])
    .map((rail, index) => normalizeRailRuntime(rail, index, spaces, defaults))
    .map((rail) => (suppressProbePoints ? { ...rail, probePoints: [] } : rail));
  const probes = suppressProbePoints
    ? []
    : normalizedRails.flatMap((rail) => rail.probePoints.map((probe) => ({
      ...probe,
      type: "probe",
      bbox: {
        minX: probe.x - 8,
        minY: probe.y - 8,
        maxX: probe.x + 8,
        maxY: probe.y + 8,
      },
    })));

  const railsById = Object.fromEntries(normalizedRails.map((rail) => [rail.id, rail]));
  const normalizedComponents = hydrateComponentRails(
    (Array.isArray(components) ? components : []).map((component, index) => normalizeComponentRuntime(component, index, spaces)),
    railsById
  );
  const componentsById = Object.fromEntries(normalizedComponents.map((component) => [component.id, component]));
  const probesById = Object.fromEntries(probes.map((probe) => [probe.id, probe]));

  const maxDataDim = Math.max(spaces.dataW, spaces.dataH);
  const cellSize = Math.max(32, Math.round(maxDataDim / 12));

  return {
    board,
    topology,
    thermal,
    railFile,
    spaces,
    defaults,
    rails: normalizedRails,
    components: normalizedComponents,
    probes,
    railsById,
    componentsById,
    probesById,
    topologyNodes: new Set(Array.isArray(topology?.nodes) ? topology.nodes.map(String) : []),
    indices: {
      probes: createSpatialIndex(probes, { cellSize: Math.max(16, Math.round(cellSize / 2)) }),
      components: createSpatialIndex(normalizedComponents, { cellSize }),
      rails: createSpatialIndex(normalizedRails, { cellSize }),
    },
    metrics: {
      cellSize,
      probeRadiusPx: 18,
      componentArea: Object.fromEntries(normalizedComponents.map((component) => [component.id, itemArea(component)])),
      railArea: Object.fromEntries(normalizedRails.map((rail) => [rail.id, itemArea(rail)])),
    },
  };
}
