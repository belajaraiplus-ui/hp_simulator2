import {
  buildBoxBbox,
  buildShapeFromBbox,
  normalizeAuthoringId,
} from "./geometry.js";

function cloneExistingComponent(boardRuntime, componentId) {
  const raw = componentId ? boardRuntime?.componentsById?.[componentId]?.raw : null;
  if (!raw || typeof raw !== "object") return null;
  return JSON.parse(JSON.stringify(raw));
}

function buildAuthoredPinPayload(pin) {
  return {
    id: normalizeAuthoringId(pin?.id) || "PIN",
    x: Math.round(Number(pin?.x) || 0),
    y: Math.round(Number(pin?.y) || 0),
    name: normalizeAuthoringId(pin?.name) || normalizeAuthoringId(pin?.id) || "PIN",
    railId: normalizeAuthoringId(pin?.railId),
    node: normalizeAuthoringId(pin?.node) || normalizeAuthoringId(pin?.railId),
    radius: Number.isFinite(Number(pin?.radius)) && Number(pin.radius) > 0 ? Number(pin.radius) : 6,
    pinType: normalizeAuthoringId(pin?.pinType),
    pinRole: normalizeAuthoringId(pin?.pinRole),
    isGround: Boolean(pin?.isGround),
    isTestPoint: Boolean(pin?.isTestPoint),
    authoringSource: normalizeAuthoringId(pin?.authoringSource) || "manual-click",
  };
}

function buildStandalonePinBbox(pin) {
  const x = Math.round(Number(pin?.x) || 0);
  const y = Math.round(Number(pin?.y) || 0);
  const radius = Number.isFinite(Number(pin?.radius)) && Number(pin.radius) > 0 ? Number(pin.radius) : 6;
  return {
    x: x - radius,
    y: y - radius,
    w: radius * 2,
    h: radius * 2,
  };
}

export function fallbackStandaloneComponentId(pin) {
  const pinId = normalizeAuthoringId(pin?.id) || "PIN";
  if (pinId.toUpperCase().startsWith("TP_")) return pinId;
  return `TP_${pinId}`;
}

function buildStandalonePinComponent(pin, componentId, existing = null) {
  const pinPayload = buildAuthoredPinPayload(pin);
  const bbox = buildStandalonePinBbox(pin);
  const kind = normalizeAuthoringId(pin?.pinType)
    || (pin?.isTestPoint ? "test_point" : null)
    || existing?.kind
    || existing?.type
    || "test_point";
  const refdes = existing?.refdes || componentId;
  return {
    ...(existing && typeof existing === "object" ? existing : {}),
    id: componentId,
    refdes,
    kind,
    bbox,
    shape: buildShapeFromBbox(bbox),
    pins: [pinPayload],
  };
}

export function buildAuthoringComponentPatchData({
  state,
  boardRuntime,
  boxComponentIds,
  resolvePinComponentId,
}) {
  const compMap = {};
  const authoredPinsByComponentId = new Map();
  const standalonePins = [];

  state.pins.forEach((pin) => {
    const resolvedComponentId = resolvePinComponentId(pin, boxComponentIds);
    const componentId = resolvedComponentId || fallbackStandaloneComponentId(pin);
    if (!resolvedComponentId) standalonePins.push({ ...pin, componentId });
    if (!authoredPinsByComponentId.has(componentId)) {
      authoredPinsByComponentId.set(componentId, []);
    }
    authoredPinsByComponentId.get(componentId).push(buildAuthoredPinPayload(pin));
  });

  state.boxes.forEach((box) => {
    const componentId = boxComponentIds.get(box.id);
    if (!componentId) return;
    const existing = cloneExistingComponent(boardRuntime, componentId);
    const bbox = buildBoxBbox(box);
    const refdes = normalizeAuthoringId(box.label) || existing?.refdes || componentId;
    const kind = normalizeAuthoringId(box.kind) || existing?.kind || existing?.type || "IC";
    const authoredPins = authoredPinsByComponentId.get(componentId);

    compMap[componentId] = {
      ...(existing && typeof existing === "object" ? existing : {}),
      id: componentId,
      refdes,
      kind,
      bbox: bbox || existing?.bbox,
      shape: bbox ? buildShapeFromBbox(bbox) : (existing?.shape || undefined),
      pins: authoredPins
        ? authoredPins.map((pin) => ({ ...pin }))
        : (Array.isArray(existing?.pins) ? existing.pins : []),
    };
  });

  authoredPinsByComponentId.forEach((pins, componentId) => {
    if (compMap[componentId]) return;
    const standalonePin = standalonePins.find((pin) => pin.componentId === componentId) || null;
    const existing = cloneExistingComponent(boardRuntime, componentId);
    compMap[componentId] = standalonePin
      ? buildStandalonePinComponent(standalonePin, componentId, existing)
      : {
        ...(existing && typeof existing === "object" ? existing : {}),
        id: componentId,
        refdes: existing?.refdes || componentId,
        kind: existing?.kind || existing?.type || "unknown",
        pins: pins.map((pin) => ({ ...pin })),
      };
  });

  return {
    components: Object.values(compMap),
    standalonePins,
  };
}

export function buildAuthoringExportJson({
  state,
  boardRuntime,
  buildComponentPatchData,
}) {
  const mode = state.exportMode;
  let data;

  if (mode === "boxes") {
    data = { boxes: state.boxes.map((box) => ({ ...box, style: { ...box.style } })) };
  } else if (mode === "pins") {
    data = { pins: state.pins.map((pin) => ({ ...pin })) };
  } else if (mode === "component-patch") {
    const { components, standalonePins } = buildComponentPatchData();
    data = standalonePins.length
      ? { components, standalonePins }
      : { components };
  } else {
    data = {
      boardId: boardRuntime?.board?.id || null,
      boxes: state.boxes.map((box) => ({ ...box, style: { ...box.style } })),
      pins: state.pins.map((pin) => ({ ...pin })),
    };
  }

  return JSON.stringify(data, null, 2);
}
