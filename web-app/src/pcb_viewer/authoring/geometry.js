import OpenSeadragon from "openseadragon";

export function normalizeAuthoringId(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

export function safeScreenToBoardPoint(screenToBoardPointFn, viewer, runtime, screenXY) {
  if (!screenToBoardPointFn || !viewer || !runtime) return null;
  if (screenXY && typeof screenXY.minus === "function") {
    return screenToBoardPointFn(viewer, runtime, screenXY);
  }

  const x = screenXY?.x ?? screenXY?.position?.x;
  const y = screenXY?.y ?? screenXY?.position?.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const osdPoint = new OpenSeadragon.Point(x, y);
  if (screenXY?.coordinateSpace) {
    osdPoint.coordinateSpace = screenXY.coordinateSpace;
  }
  return screenToBoardPointFn(viewer, runtime, osdPoint);
}

export function pointFromPin(pin) {
  const x = Number(pin?.x);
  const y = Number(pin?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export function buildBoxBbox(box) {
  if (
    Number.isFinite(Number(box?.bbox?.x))
    && Number.isFinite(Number(box?.bbox?.y))
    && Number.isFinite(Number(box?.bbox?.w))
    && Number.isFinite(Number(box?.bbox?.h))
  ) {
    return {
      x: Number(box.bbox.x),
      y: Number(box.bbox.y),
      w: Number(box.bbox.w),
      h: Number(box.bbox.h),
    };
  }

  if (
    Number.isFinite(Number(box?.x))
    && Number.isFinite(Number(box?.y))
    && Number.isFinite(Number(box?.w))
    && Number.isFinite(Number(box?.h))
  ) {
    return {
      x: Math.round(Number(box.x)),
      y: Math.round(Number(box.y)),
      w: Math.round(Number(box.w)),
      h: Math.round(Number(box.h)),
    };
  }

  return undefined;
}

export function boxBoundsFromAuthoringBox(box) {
  const bbox = buildBoxBbox(box);
  if (!bbox) return null;
  return {
    minX: bbox.x,
    minY: bbox.y,
    maxX: bbox.x + bbox.w,
    maxY: bbox.y + bbox.h,
  };
}

export function boxArea(bounds) {
  if (!bounds) return Number.POSITIVE_INFINITY;
  return Math.max(1, (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY));
}

export function distancePointToBounds(point, bounds) {
  if (!point || !bounds) return Number.POSITIVE_INFINITY;
  const dx = point.x < bounds.minX
    ? bounds.minX - point.x
    : (point.x > bounds.maxX ? point.x - bounds.maxX : 0);
  const dy = point.y < bounds.minY
    ? bounds.minY - point.y
    : (point.y > bounds.maxY ? point.y - bounds.maxY : 0);
  return Math.sqrt(dx * dx + dy * dy);
}

export function buildShapeFromBbox(bbox) {
  if (!bbox) return undefined;
  return {
    type: "poly",
    points: [
      [bbox.x, bbox.y],
      [bbox.x + bbox.w, bbox.y],
      [bbox.x + bbox.w, bbox.y + bbox.h],
      [bbox.x, bbox.y + bbox.h],
    ],
  };
}

export function buildBoardOverlayRect(viewer, { x, y, w, h }, spaces) {
  if (!viewer?.viewport || !spaces) return null;
  const { sx, sy } = spaces;
  const minXi = Number(x) * sx;
  const minYi = Number(y) * sy;
  const maxXi = (Number(x) + Number(w)) * sx;
  const maxYi = (Number(y) + Number(h)) * sy;
  const topLeft = viewer.viewport.imageToViewportCoordinates(minXi, minYi);
  const botRight = viewer.viewport.imageToViewportCoordinates(maxXi, maxYi);
  return new OpenSeadragon.Rect(
    topLeft.x,
    topLeft.y,
    Math.max(0.001, botRight.x - topLeft.x),
    Math.max(0.001, botRight.y - topLeft.y)
  );
}

export function suppressOverlayPointerEvent(event) {
  if (!event) return;
  event.stopPropagation?.();
  event.preventDefault?.();
}

export function updateBoxOverlayPosition(viewer, box, element, spaces) {
  if (!viewer || !box || !element) return;
  const rect = buildBoardOverlayRect(viewer, box, spaces);
  if (!rect) return;
  viewer.updateOverlay(element, rect);
  element.title = `${box.id}${box.label ? ` (${box.label})` : ""} @ (${box.x}, ${box.y}) ${box.w}x${box.h}`;
}

export function dragDeltaToBoardDelta(viewer, delta, spaces) {
  if (!viewer?.viewport || !delta || !spaces) return null;
  const sx = Number(spaces?.sx);
  const sy = Number(spaces?.sy);
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx === 0 || sy === 0) return null;

  const viewportDelta = viewer.viewport.deltaPointsFromPixels(delta);
  const imageOrigin = viewer.viewport.viewportToImageCoordinates(new OpenSeadragon.Point(0, 0));
  const imageTarget = viewer.viewport.viewportToImageCoordinates(
    new OpenSeadragon.Point(viewportDelta.x, viewportDelta.y)
  );
  const imageDelta = new OpenSeadragon.Point(
    imageTarget.x - imageOrigin.x,
    imageTarget.y - imageOrigin.y
  );

  return {
    x: imageDelta.x / sx,
    y: imageDelta.y / sy,
  };
}
