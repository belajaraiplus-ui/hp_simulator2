import { PIN_COMPONENT_SNAP_DISTANCE } from "./constants.js";
import {
  boxArea,
  boxBoundsFromAuthoringBox,
  distancePointToBounds,
  normalizeAuthoringId,
  pointFromPin,
} from "./geometry.js";

export function getComponentIdForBox(box) {
  return normalizeAuthoringId(box?.componentId) || normalizeAuthoringId(box?.id);
}

export function getComponentIdForPin(pin, boxComponentIds = new Map()) {
  return normalizeAuthoringId(pin?.componentId)
    || boxComponentIds.get(pin?.boxId)
    || normalizeAuthoringId(pin?.boxId)
    || null;
}

export function buildBoxComponentIdMap(boxes = []) {
  const boxComponentIds = new Map();
  boxes.forEach((box) => {
    const componentId = getComponentIdForBox(box);
    if (componentId) boxComponentIds.set(box.id, componentId);
  });
  return boxComponentIds;
}

export function findAuthoringComponentIdAtBoardPoint(boardPoint, boxes = [], boxComponentIds = new Map()) {
  if (!boardPoint || !Array.isArray(boxes)) return null;
  const matches = boxes
    .map((box) => ({ box, bounds: boxBoundsFromAuthoringBox(box) }))
    .filter((entry) => entry.bounds)
    .filter((entry) => (
      boardPoint.x >= entry.bounds.minX
      && boardPoint.x <= entry.bounds.maxX
      && boardPoint.y >= entry.bounds.minY
      && boardPoint.y <= entry.bounds.maxY
    ))
    .sort((left, right) => boxArea(left.bounds) - boxArea(right.bounds));
  const componentId = matches[0]?.box
    ? getComponentIdForPin({ boxId: matches[0].box.id }, boxComponentIds)
    : null;
  return normalizeAuthoringId(componentId);
}

export function findRuntimeComponentIdAtBoardPoint(boardPoint, boardRuntime) {
  if (!boardPoint || !Array.isArray(boardRuntime?.components)) return null;
  const matches = boardRuntime.components
    .filter((component) => {
      const box = component?.bbox;
      return box
        && boardPoint.x >= box.minX && boardPoint.x <= box.maxX
        && boardPoint.y >= box.minY && boardPoint.y <= box.maxY;
    })
    .sort((left, right) => {
      const leftBox = left?.bbox;
      const rightBox = right?.bbox;
      const leftArea = leftBox ? Math.max(1, (leftBox.maxX - leftBox.minX) * (leftBox.maxY - leftBox.minY)) : Number.POSITIVE_INFINITY;
      const rightArea = rightBox ? Math.max(1, (rightBox.maxX - rightBox.minX) * (rightBox.maxY - rightBox.minY)) : Number.POSITIVE_INFINITY;
      return leftArea - rightArea;
    });
  return normalizeAuthoringId(matches[0]?.id || matches[0]?.refdes);
}

export function findNearestAuthoringComponentId(
  boardPoint,
  boxes = [],
  boxComponentIds = new Map(),
  maxDistance = PIN_COMPONENT_SNAP_DISTANCE,
) {
  if (!boardPoint || !Array.isArray(boxes)) return null;
  const [nearest] = boxes
    .map((box) => {
      const bounds = boxBoundsFromAuthoringBox(box);
      const componentId = getComponentIdForPin({ boxId: box?.id }, boxComponentIds);
      if (!bounds || !componentId) return null;
      return {
        componentId,
        distance: distancePointToBounds(boardPoint, bounds),
        area: boxArea(bounds),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.distance - right.distance || left.area - right.area);

  return nearest && nearest.distance <= maxDistance ? normalizeAuthoringId(nearest.componentId) : null;
}

export function findNearestRuntimeComponentId(
  boardPoint,
  boardRuntime,
  maxDistance = PIN_COMPONENT_SNAP_DISTANCE,
) {
  if (!boardPoint || !Array.isArray(boardRuntime?.components)) return null;
  const [nearest] = boardRuntime.components
    .map((component) => {
      const bounds = component?.bbox || null;
      if (!bounds) return null;
      return {
        componentId: component?.id || component?.refdes || null,
        distance: distancePointToBounds(boardPoint, bounds),
        area: boxArea(bounds),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.distance - right.distance || left.area - right.area);

  return nearest && nearest.distance <= maxDistance ? normalizeAuthoringId(nearest.componentId) : null;
}

export function resolvePinComponentId(pin, {
  boxes = [],
  boardRuntime = null,
  boxComponentIds = buildBoxComponentIdMap(boxes),
  maxDistance = PIN_COMPONENT_SNAP_DISTANCE,
} = {}) {
  const explicit = getComponentIdForPin(pin, boxComponentIds);
  if (explicit) return explicit;

  const boardPoint = pointFromPin(pin);
  if (!boardPoint) return null;

  return findAuthoringComponentIdAtBoardPoint(boardPoint, boxes, boxComponentIds)
    || findRuntimeComponentIdAtBoardPoint(boardPoint, boardRuntime)
    || findNearestAuthoringComponentId(boardPoint, boxes, boxComponentIds, maxDistance)
    || findNearestRuntimeComponentId(boardPoint, boardRuntime, maxDistance)
    || null;
}
