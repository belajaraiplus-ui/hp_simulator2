import OpenSeadragon from "openseadragon";
import { querySpatialIndex, querySpatialIndexRange } from "./spatial_index.js";

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

  const coordinateSpace = screenPoint?.coordinateSpace || screenPoint?.position?.coordinateSpace || null;
  const pixelPoint = screenPoint?.x != null && screenPoint?.y != null
    ? screenPoint
    : { x: screenPoint?.position?.x, y: screenPoint?.position?.y };

  if (!Number.isFinite(pixelPoint.x) || !Number.isFinite(pixelPoint.y)) return null;

  const tryConvert = (candidate) => {
    if (!candidate || !Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return null;
    // pointFromPixel requires an OSD Point (needs .minus() internally)
    const osdPixel = candidate instanceof OpenSeadragon.Point
      ? candidate
      : new OpenSeadragon.Point(candidate.x, candidate.y);
    const viewportPoint = viewer.viewport.pointFromPixel(osdPixel, true);
    const imagePoint = viewer.viewport.viewportToImageCoordinates(viewportPoint);
    const { sx, sy } = boardRuntime.spaces;
    if (!Number.isFinite(imagePoint?.x) || !Number.isFinite(imagePoint?.y) || !Number.isFinite(sx) || !Number.isFinite(sy) || sx === 0 || sy === 0) {
      return null;
    }
    return {
      screen: { x: candidate.x, y: candidate.y },
      image: { x: imagePoint.x, y: imagePoint.y },
      board: {
        x: imagePoint.x / sx,
        y: imagePoint.y / sy,
      },
    };
  };

  const scoreCandidate = (result) => {
    if (!result) return Number.POSITIVE_INFINITY;
    const { imgW, imgH, dataW, dataH } = boardRuntime.spaces || {};
    const penalty = (value, min, max) => {
      if (!Number.isFinite(value)) return 1e9;
      let score = 0;
      if (Number.isFinite(min) && value < min) score += min - value;
      if (Number.isFinite(max) && value > max) score += value - max;
      return score;
    };
    return penalty(result.image.x, 0, imgW)
      + penalty(result.image.y, 0, imgH)
      + penalty(result.board.x, 0, dataW)
      + penalty(result.board.y, 0, dataH);
  };

  const candidates = [];
  const seen = new Set();
  const pushCandidate = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const key = `${Math.round(x * 1000)}:${Math.round(y * 1000)}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ x, y });
  };

  if (coordinateSpace === "viewer-local") {
    pushCandidate(pixelPoint.x, pixelPoint.y);
  } else if (coordinateSpace === "client") {
    const rect = viewer?.element?.getBoundingClientRect?.();
    if (rect) {
      pushCandidate(pixelPoint.x - rect.left, pixelPoint.y - rect.top);
    } else {
      pushCandidate(pixelPoint.x, pixelPoint.y);
    }
  } else {
    pushCandidate(pixelPoint.x, pixelPoint.y);

    const rectSources = [viewer?.canvas, viewer?.container, viewer?.element].filter(Boolean);
    rectSources.forEach((source) => {
      const rect = source?.getBoundingClientRect?.();
      if (!rect) return;
      // Some click paths provide client/page coordinates, others element-local.
      // Keep all plausible offsets and score against board/image bounds.
      pushCandidate(pixelPoint.x - rect.left, pixelPoint.y - rect.top);
    });

    if (typeof window !== "undefined") {
      pushCandidate(pixelPoint.x + window.scrollX, pixelPoint.y + window.scrollY);
    }
  }

  const converted = candidates.map((candidate) => ({
    result: tryConvert(candidate),
  }));
  converted.forEach((entry) => {
    entry.score = scoreCandidate(entry.result);
  });
  converted.sort((left, right) => left.score - right.score);
  return converted[0]?.result || null;
}

function pickProbe(boardRuntime, boardPoint, imagePoint) {
  const probeRadiusBoardX = Math.max(boardRuntime.metrics.probeRadiusPx / boardRuntime.spaces.sx, 10);
  const probeRadiusBoardY = Math.max(boardRuntime.metrics.probeRadiusPx / boardRuntime.spaces.sy, 10);
  const searchBox = {
    minX: boardPoint.x - probeRadiusBoardX,
    minY: boardPoint.y - probeRadiusBoardY,
    maxX: boardPoint.x + probeRadiusBoardX,
    maxY: boardPoint.y + probeRadiusBoardY,
  };
  const candidates = querySpatialIndexRange(boardRuntime.indices.probes, searchBox)
    .filter((probe) => Math.abs(boardPoint.x - probe.x) <= probeRadiusBoardX)
    .filter((probe) => Math.abs(boardPoint.y - probe.y) <= probeRadiusBoardY)
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

function componentImageBox(component, boardRuntime) {
  if (!component?.bbox || !boardRuntime?.spaces) return null;
  const { sx, sy } = boardRuntime.spaces;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx === 0 || sy === 0) return null;
  return {
    minX: component.bbox.minX * sx,
    minY: component.bbox.minY * sy,
    maxX: component.bbox.maxX * sx,
    maxY: component.bbox.maxY * sy,
  };
}

function pickComponentByImageHitbox(boardRuntime, imagePoint) {
  if (!boardRuntime || !Number.isFinite(imagePoint?.x) || !Number.isFinite(imagePoint?.y)) return null;

  const candidates = (Array.isArray(boardRuntime.components) ? boardRuntime.components : [])
    .map((component) => ({
      item: component,
      imageBox: componentImageBox(component, boardRuntime),
    }))
    .filter((entry) => pointInBox(imagePoint, entry.imageBox))
    .map((entry) => ({
      item: entry.item,
      distance: areaOfBox(entry.imageBox),
    }));

  const [winner] = sortByPriority(candidates, "distance");
  return winner?.item || null;
}

function extractContactPoint(contact) {
  if (!contact || typeof contact !== "object") return null;
  const x = Number(contact.x ?? contact.cx ?? contact.px);
  const y = Number(contact.y ?? contact.cy ?? contact.py);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function inferComponentModeHints(component) {
  if (!component) return [];
  const hints = new Set();
  const props = component.electricalProperties || {};
  const kind = String(component.kind || "").toLowerCase();
  const ref = String(component.refdes || component.id || "").toLowerCase();

  if (Number.isFinite(Number(props.ohm ?? props.resistance_ohm))) hints.add("ohm");
  if (Number.isFinite(Number(props.diodeDrop ?? props.diodeDrop_v ?? props.forward_voltage))) hints.add("diode");
  if (props.continuity !== undefined) hints.add("continuity");
  if (component.rails?.length || component.hints?.rails?.length) hints.add("voltage");

  if (kind.includes("res") || ref.startsWith("r")) hints.add("ohm");
  if (kind.includes("diode") || ref.startsWith("d")) hints.add("diode");
  if (kind.includes("fuse") || ref.startsWith("f") || kind.includes("jumper")) hints.add("continuity");

  return [...hints];
}

function contactHitRadius(contact, boardRuntime) {
  const baseRadius = Math.max(6 / (boardRuntime?.spaces?.sx || 1), 6 / (boardRuntime?.spaces?.sy || 1), 4);
  const storedRadius = Number(contact?.data?.radius);
  return Number.isFinite(storedRadius) ? Math.max(baseRadius, storedRadius) : baseRadius;
}

function buildComponentContactPick(component, winner) {
  const pinId = String(winner.data?.id || `${winner.kind.toUpperCase()}_${winner.index + 1}`);
  const railId = winner.data?.railId || winner.data?.rail || null;
  const node = winner.data?.node || null;
  const pinLabel = String(winner.data?.name || winner.data?.label || pinId);
  const componentLabel = String(component?.refdes || component?.id || "").trim();
  const targetLabel = componentLabel && componentLabel !== "_unassigned"
    ? `${componentLabel} (${pinLabel})`
    : pinLabel;

  return {
    type: "component-pin",
    id: `${component.id}:${pinId}`,
    componentId: component.id,
    componentKind: component.kind,
    pinId,
    node,
    railId,
    label: targetLabel,
    modeHints: inferComponentModeHints(component),
    raw: winner.data,
  };
}

function pickComponentPin(component, boardPoint, boardRuntime) {
  if (!component || !boardPoint || !boardRuntime) return null;

  const contacts = [
    ...(Array.isArray(component.pins) ? component.pins : []).map((pin, index) => ({ kind: "pin", index, data: pin })),
    ...(Array.isArray(component.pads) ? component.pads : []).map((pad, index) => ({ kind: "pad", index, data: pad })),
  ].map((entry) => {
    const point = extractContactPoint(entry.data);
    if (!point) return null;
    return {
      ...entry,
      point,
      distance: distanceSq(boardPoint, point),
    };
  }).filter(Boolean);

  if (!contacts.length) return null;

  const [winner] = contacts
    .filter((entry) => {
      const hitRadius = contactHitRadius(entry, boardRuntime);
      return entry.distance <= hitRadius * hitRadius;
    })
    .sort((a, b) => a.distance - b.distance);

  if (!winner) return null;
  return buildComponentContactPick(component, winner);
}

function pickLooseComponentPin(boardRuntime, boardPoint) {
  if (!boardRuntime || !boardPoint) return null;

  const contacts = [];
  (Array.isArray(boardRuntime.components) ? boardRuntime.components : []).forEach((component) => {
    [
      ...(Array.isArray(component?.pins) ? component.pins : []).map((pin, index) => ({ kind: "pin", index, data: pin })),
      ...(Array.isArray(component?.pads) ? component.pads : []).map((pad, index) => ({ kind: "pad", index, data: pad })),
    ].forEach((entry) => {
      const point = extractContactPoint(entry.data);
      if (!point) return;
      contacts.push({
        ...entry,
        component,
        point,
        distance: distanceSq(boardPoint, point),
      });
    });
  });

  if (!contacts.length) return null;

  const [winner] = contacts
    .filter((entry) => {
      const hitRadius = contactHitRadius(entry, boardRuntime);
      return entry.distance <= hitRadius * hitRadius;
    })
    .sort((a, b) => a.distance - b.distance);

  if (!winner?.component) return null;
  return buildComponentContactPick(winner.component, winner);
}

function resolveComponentMeasurementCandidate(component) {
  if (!component) return null;
  return {
    type: "component",
    id: component.id,
    componentId: component.id,
    componentKind: component.kind,
    pinId: null,
    rails: component.rails,
    node: component.node || null,
    railId: component.rails?.[0] || component.hints?.rails?.[0] || null,
    label: component.label,
    modeHints: inferComponentModeHints(component),
    raw: component,
  };
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
      source: "pcb-viewer",
    };
  }

  if (pick.type === "component") {
    return {
      type: "component",
      id: `component:${pick.componentId}`,
      componentId: pick.componentId,
      componentKind: pick.componentKind || null,
      pinId: null,
      node: pick.node || null,
      railId: pick.railId || null,
      rails: Array.isArray(pick.rails) ? pick.rails : [],
      modeHints: Array.isArray(pick.modeHints) ? pick.modeHints : [],
      label: pick.label || pick.componentId,
      source: "pcb-viewer",
    };
  }

  if (pick.type === "component-pin") {
    return {
      type: "component-pin",
      id: `component-pin:${pick.componentId}:${pick.pinId}`,
      componentId: pick.componentId,
      componentKind: pick.componentKind || null,
      pinId: pick.pinId,
      node: pick.node || null,
      railId: pick.railId || null,
      modeHints: Array.isArray(pick.modeHints) ? pick.modeHints : [],
      label: pick.label || `${pick.componentId}:${pick.pinId}`,
      source: "pcb-viewer",
    };
  }

  if (pick.type === "rail") {
    return {
      type: "rail",
      id: `rail:${pick.railId}`,
      railId: pick.railId,
      label: pick.label || pick.railId,
      source: "pcb-viewer",
    };
  }

  if (pick.type === "node") {
    return {
      type: "node",
      id: `node:${pick.nodeId}`,
      node: pick.nodeId,
      railId: pick.railId || null,
      componentId: pick.componentId || null,
      pinId: pick.pinId || null,
      label: pick.label || pick.nodeId,
      source: "pcb-viewer",
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

  const component = pickComponent(boardRuntime, boardPoint)
    || pickComponentByImageHitbox(boardRuntime, imagePoint);
  if (component) {
    const componentPin = pickComponentPin(component, boardPoint, boardRuntime);
    if (componentPin) {
      return {
        ...componentPin,
        boardPoint,
        imagePoint,
      };
    }

    const loosePin = pickLooseComponentPin(boardRuntime, boardPoint);
    if (loosePin) {
      return {
        ...loosePin,
        boardPoint,
        imagePoint,
      };
    }

    const candidate = resolveComponentMeasurementCandidate(component);
    return {
      ...candidate,
      boardPoint,
      imagePoint,
    };
  }

  const loosePin = pickLooseComponentPin(boardRuntime, boardPoint);
  if (loosePin) {
    return {
      ...loosePin,
      boardPoint,
      imagePoint,
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
  if (pick.type === "component-pin") return `Component ${pick.componentId} pin ${pick.pinId}`;
  if (pick.type === "component") return `Component ${pick.componentId}`;
  if (pick.type === "rail") return `Rail ${pick.railId}`;
  if (pick.type === "node") return `Node ${pick.nodeId}`;
  return String(pick.id || pick.type || "unknown");
}
