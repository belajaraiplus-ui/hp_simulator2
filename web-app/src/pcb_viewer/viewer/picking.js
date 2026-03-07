import { querySpatialIndex } from "./spatial_index.js";

function pointInBox(point, box, padding = 0) {
  if (!box) return false;
  return point.x >= box.minX - padding
    && point.x <= box.maxX + padding
    && point.y >= box.minY - padding
    && point.y <= box.maxY + padding;
}

function pointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygons(point, polygons) {
  return (Array.isArray(polygons) ? polygons : []).some((polygon) => pointInPolygon(point, polygon));
}

function distanceSq(a, b) {
  const dx = (a.x || 0) - (b.x || 0);
  const dy = (a.y || 0) - (b.y || 0);
  return dx * dx + dy * dy;
}

function areaOfBox(box) {
  if (!box) return Number.POSITIVE_INFINITY;
  return Math.max(1, (box.maxX - box.minX) * (box.maxY - box.minY));
}

function sortByPriority(items, metricKey = "distance") {
  return [...items].sort((left, right) => {
    const leftMetric = Number(left[metricKey]);
    const rightMetric = Number(right[metricKey]);
    if (leftMetric !== rightMetric) return leftMetric - rightMetric;

    const leftArea = areaOfBox(left.item?.bbox || left.item?.overlayBox);
    const rightArea = areaOfBox(right.item?.bbox || right.item?.overlayBox);
    if (leftArea !== rightArea) return leftArea - rightArea;

    const leftId = String(left.item?.id || "");
    const rightId = String(right.item?.id || "");
    return leftId.localeCompare(rightId);
  });
}

export function screenToBoardPoint(viewer, boardRuntime, screenPoint) {
  if (!viewer?.viewport || !boardRuntime?.spaces || !screenPoint) return null;

  const pixelPoint = screenPoint?.x != null && screenPoint?.y != null
    ? screenPoint
    : { x: screenPoint?.position?.x, y: screenPoint?.position?.y };

  if (!Number.isFinite(pixelPoint.x) || !Number.isFinite(pixelPoint.y)) return null;

  const viewportPoint = viewer.viewport.pointFromPixel(pixelPoint, true);
  const imagePoint = viewer.viewport.viewportToImageCoordinates(viewportPoint);
  const { sx, sy } = boardRuntime.spaces;

  return {
    screen: { x: pixelPoint.x, y: pixelPoint.y },
    image: { x: imagePoint.x, y: imagePoint.y },
    board: {
      x: imagePoint.x / sx,
      y: imagePoint.y / sy,
    },
  };
}

function pickProbe(boardRuntime, boardPoint, imagePoint) {
  const probeRadiusBoard = Math.max(boardRuntime.metrics.probeRadiusPx / boardRuntime.spaces.sx, 10);
  const candidates = querySpatialIndex(boardRuntime.indices.probes, boardPoint.x, boardPoint.y)
    .filter((probe) => pointInBox(boardPoint, probe.bbox, probeRadiusBoard))
    .map((probe) => ({
      item: probe,
      distance: distanceSq(boardPoint, { x: probe.x, y: probe.y }),
      imageDistance: distanceSq(imagePoint, { x: probe.imageX, y: probe.imageY }),
    }))
    .filter((candidate) => candidate.imageDistance <= boardRuntime.metrics.probeRadiusPx * boardRuntime.metrics.probeRadiusPx);

  const [winner] = sortByPriority(candidates, "imageDistance");
  return winner?.item || null;
}

function pickComponent(boardRuntime, boardPoint) {
  const candidates = querySpatialIndex(boardRuntime.indices.components, boardPoint.x, boardPoint.y)
    .filter((component) => pointInBox(boardPoint, component.bbox))
    .filter((component) => pointInPolygons(boardPoint, component.polygons) || pointInBox(boardPoint, component.bbox))
    .map((component) => ({
      item: component,
      distance: areaOfBox(component.bbox),
    }));

  const [winner] = sortByPriority(candidates, "distance");
  return winner?.item || null;
}

function pickRail(boardRuntime, boardPoint) {
  const candidates = querySpatialIndex(boardRuntime.indices.rails, boardPoint.x, boardPoint.y)
    .filter((rail) => pointInBox(boardPoint, rail.overlayBox))
    .filter((rail) => pointInPolygons(boardPoint, rail.overlayPolys))
    .map((rail) => ({
      item: rail,
      distance: areaOfBox(rail.overlayBox),
    }));

  const [winner] = sortByPriority(candidates, "distance");
  return winner?.item || null;
}

export function resolveMeasurementTarget(pick) {
  if (!pick) return null;

  if (pick.type === "probe") {
    return {
      type: "probe",
      id: `probe:${pick.probeId}`,
      railId: pick.railId,
      probeId: pick.probeId,
      label: pick.label || pick.probeId,
    };
  }

  if (pick.type === "component") {
    return {
      type: "component",
      id: `component:${pick.componentId}`,
      componentId: pick.componentId,
      rails: Array.isArray(pick.rails) ? pick.rails : [],
      pins: Array.isArray(pick.pins) ? pick.pins : [],
      label: pick.label || pick.componentId,
    };
  }

  if (pick.type === "rail") {
    return {
      type: "rail",
      id: `rail:${pick.railId}`,
      railId: pick.railId,
      label: pick.label || pick.railId,
    };
  }

  if (pick.type === "node") {
    return {
      type: "node",
      id: `node:${pick.nodeId}`,
      nodeId: pick.nodeId,
      railId: pick.railId || null,
      componentId: pick.componentId || null,
      pinId: pick.pinId || null,
      label: pick.label || pick.nodeId,
    };
  }

  return null;
}

export function pickBoardTarget(boardRuntime, boardPointLike) {
  if (!boardRuntime || !boardPointLike) return null;
  const boardPoint = boardPointLike.board || boardPointLike;
  const imagePoint = boardPointLike.image || null;
  if (!Number.isFinite(boardPoint?.x) || !Number.isFinite(boardPoint?.y)) return null;
  if (!Number.isFinite(imagePoint?.x) || !Number.isFinite(imagePoint?.y)) return null;

  const probe = pickProbe(boardRuntime, boardPoint, imagePoint);
  if (probe) {
    return {
      type: "probe",
      id: probe.id,
      probeId: probe.id,
      railId: probe.railId,
      label: probe.label,
      boardPoint,
      imagePoint,
      raw: probe,
    };
  }

  const component = pickComponent(boardRuntime, boardPoint);
  if (component) {
    return {
      type: "component",
      id: component.id,
      componentId: component.id,
      label: component.label,
      rails: component.rails,
      pins: component.pins,
      boardPoint,
      imagePoint,
      raw: component,
    };
  }

  const rail = pickRail(boardRuntime, boardPoint);
  if (rail) {
    return {
      type: "rail",
      id: rail.id,
      railId: rail.id,
      label: rail.label,
      boardPoint,
      imagePoint,
      raw: rail,
    };
  }

  return null;
}

export function pickAtScreenPoint(viewer, boardRuntime, screenPoint) {
  const point = screenToBoardPoint(viewer, boardRuntime, screenPoint);
  if (!point) return null;
  const pick = pickBoardTarget(boardRuntime, point);
  if (!pick) return null;
  return {
    ...pick,
    measurementTarget: resolveMeasurementTarget(pick),
  };
}

export function describePick(pick) {
  if (!pick) return "No measurable target";
  if (pick.type === "probe") return `Probe ${pick.probeId} on ${pick.railId}`;
  if (pick.type === "component") return `Component ${pick.componentId}`;
  if (pick.type === "rail") return `Rail ${pick.railId}`;
  if (pick.type === "node") return `Node ${pick.nodeId}`;
  return String(pick.id || pick.type || "unknown");
}
