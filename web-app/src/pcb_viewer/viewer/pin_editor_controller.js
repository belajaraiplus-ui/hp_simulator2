import OpenSeadragon from "openseadragon";
import {
  inferPinDefaultsFromComponent,
  normalizePinContact,
  PIN_EDITOR_DEFAULT_RADIUS,
  PIN_ROLE_VALUES,
  PIN_TYPE_VALUES,
} from "./pin_metadata.js";
import {
  createPinEditorOverlayElement,
  createRuntimePinOverlayElement,
  getRuntimePinVisualState,
  inferPinRailId,
  listRuntimePins,
} from "./pin_overlays.js";

function createInitialState() {
  return {
    componentId: null,
    pins: [],
    selectedPinId: null,
    isEditing: false,
    relocateOnNextClick: false,
  };
}

export function createPinEditorController({
  getViewer = () => null,
  getBoardRuntime = () => null,
  getBoard = () => null,
  getSelection = () => null,
  clearOverlayList = () => {},
} = {}) {
  let state = createInitialState();
  const pinEditorOverlays = [];
  const runtimePinOverlays = [];

  function boardRuntime() {
    return getBoardRuntime?.() || null;
  }

  function viewer() {
    return getViewer?.() || null;
  }

  function selection() {
    return getSelection?.() || null;
  }

  function cloneState() {
    return {
      componentId: state.componentId,
      selectedPinId: state.selectedPinId,
      isEditing: state.isEditing,
      relocateOnNextClick: state.relocateOnNextClick,
      pins: state.pins.map((pin) => ({ ...pin })),
    };
  }

  function nextGeneratedPinId() {
    const used = new Set(state.pins.map((pin) => String(pin.id || "").trim()));
    for (let i = 1; i <= 9999; i += 1) {
      const candidate = `PIN_${String(i).padStart(3, "0")}`;
      if (!used.has(candidate)) return candidate;
    }
    return `PIN_${Date.now()}`;
  }

  function syncRuntimeComponentPins() {
    const runtime = boardRuntime();
    if (!runtime || !state.componentId) return;
    const runtimeComponent = runtime.componentsById?.[state.componentId];
    if (!runtimeComponent) return;
    runtimeComponent.pins = state.pins.map((pin) => ({
      id: pin.id,
      name: pin.name ?? null,
      x: pin.x,
      y: pin.y,
      radius: pin.radius,
      node: pin.node ?? null,
      railId: pin.railId ?? null,
      pinType: pin.pinType ?? null,
      pinRole: pin.pinRole ?? null,
      isGround: Boolean(pin.isGround),
      isTestPoint: Boolean(pin.isTestPoint),
      componentId: pin.componentId ?? state.componentId ?? null,
      authoringSource: pin.authoringSource || "manual-click",
    }));
    runtimeComponent.raw = runtimeComponent.raw || {};
    runtimeComponent.raw.pins = runtimeComponent.pins.map((pin) => ({ ...pin }));
  }

  function redrawRuntimeOverlays() {
    const activeViewer = viewer();
    const runtime = boardRuntime();
    clearOverlayList(runtimePinOverlays);
    if (!activeViewer || !runtime || state.isEditing) return;

    const { sx, sy } = runtime.spaces;
    const selectedPick = selection()?.pick || null;
    const pins = listRuntimePins(runtime);
    pins.sort((left, right) => {
      const leftState = getRuntimePinVisualState(left, selectedPick);
      const rightState = getRuntimePinVisualState(right, selectedPick);
      const leftPriority = Number(leftState.showLabel) + Number(leftState.selected);
      const rightPriority = Number(rightState.showLabel) + Number(rightState.selected);
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return String(left.id || "").localeCompare(String(right.id || ""));
    });

    pins.forEach((pin) => {
      const xi = pin.x * sx;
      const yi = pin.y * sy;
      const markerRadiusX = Math.max(1, (pin.radius || PIN_EDITOR_DEFAULT_RADIUS) * sx);
      const markerRadiusY = Math.max(1, (pin.radius || PIN_EDITOR_DEFAULT_RADIUS) * sy);
      const imgRect = new OpenSeadragon.Rect(
        xi - markerRadiusX,
        yi - markerRadiusY,
        markerRadiusX * 2,
        markerRadiusY * 2
      );
      const rect = activeViewer.viewport.imageToViewportRectangle(imgRect);
      const visualState = getRuntimePinVisualState(pin, selectedPick);
      const element = createRuntimePinOverlayElement(pin, visualState);
      activeViewer.addOverlay({ element, location: rect });
      runtimePinOverlays.push({ element, pinId: pin.id, componentId: pin.componentId });
    });
  }

  function redrawOverlays() {
    const activeViewer = viewer();
    const runtime = boardRuntime();
    clearOverlayList(pinEditorOverlays);
    if (!activeViewer || !runtime || !state.isEditing) {
      redrawRuntimeOverlays();
      return;
    }

    const { imgW, imgH, sx, sy } = runtime.spaces;
    state.pins.forEach((pin) => {
      const xi = pin.x * sx;
      const yi = pin.y * sy;
      const markerRadiusX = Math.max(1, (pin.radius || PIN_EDITOR_DEFAULT_RADIUS) * sx);
      const markerRadiusY = Math.max(1, (pin.radius || PIN_EDITOR_DEFAULT_RADIUS) * sy);
      const rect = new OpenSeadragon.Rect(
        (xi - markerRadiusX) / imgW,
        (yi - markerRadiusY) / imgH,
        (markerRadiusX * 2) / imgW,
        (markerRadiusY * 2) / imgH
      );
      const selected = pin.id === state.selectedPinId;
      const element = createPinEditorOverlayElement(pin, selected);
      activeViewer.addOverlay({ element, location: rect });
      pinEditorOverlays.push({ element, pinId: pin.id });
    });
    redrawRuntimeOverlays();
  }

  function setComponent(componentId) {
    const runtimeComponent = boardRuntime()?.componentsById?.[componentId];
    if (!runtimeComponent) {
      console.warn(`[pcb] Component not found for pin editor: ${componentId}`);
      return null;
    }

    const sourcePins = Array.isArray(runtimeComponent?.pins) && runtimeComponent.pins.length
      ? runtimeComponent.pins
      : (Array.isArray(runtimeComponent?.pads) ? runtimeComponent.pads : []);

    const pins = sourcePins
      .map((pin, index) => normalizePinContact(pin, String(index + 1)))
      .filter(Boolean);

    state.componentId = runtimeComponent.id;
    state.pins = pins;
    state.selectedPinId = pins[0]?.id || null;
    state.relocateOnNextClick = false;
    redrawOverlays();
    return cloneState();
  }

  function pickAtPoint(boardPoint) {
    const runtime = boardRuntime();
    const hitRadius = Math.max(8 / (runtime?.spaces?.sx || 1), 8 / (runtime?.spaces?.sy || 1), 6);
    const hitSq = hitRadius * hitRadius;
    const winner = state.pins
      .map((pin) => {
        const dx = boardPoint.x - pin.x;
        const dy = boardPoint.y - pin.y;
        return { pin, distance: dx * dx + dy * dy };
      })
      .filter((entry) => entry.distance <= hitSq)
      .sort((a, b) => a.distance - b.distance)[0];
    return winner?.pin || null;
  }

  function getSelectedRuntimeComponent() {
    if (!state.componentId) return null;
    return boardRuntime()?.componentsById?.[state.componentId] || null;
  }

  function addPinAtPoint(boardPoint) {
    const runtime = boardRuntime();
    const selected = selection();
    const selectedComponent = getSelectedRuntimeComponent()
      || runtime?.componentsById?.[selected?.pick?.componentId]
      || null;
    const sequence = state.pins.filter((pin) => pin.authoringSource === "manual-click").length + 1;
    const defaults = inferPinDefaultsFromComponent(selectedComponent, sequence);
    const id = defaults.id || nextGeneratedPinId();
    const pin = {
      id,
      name: defaults.name || id,
      x: Math.round(boardPoint.x),
      y: Math.round(boardPoint.y),
      radius: PIN_EDITOR_DEFAULT_RADIUS,
      node: null,
      railId: null,
      pinType: defaults.pinType,
      pinRole: defaults.pinRole,
      isGround: false,
      isTestPoint: false,
      componentId: state.componentId || selectedComponent?.id || null,
      authoringSource: "manual-click",
    };
    pin.railId = inferPinRailId(pin, runtime);
    if (String(pin.railId || "").toUpperCase().includes("GND")) {
      pin.pinRole = "ground";
      pin.isGround = true;
    }
    if (String(pin.componentId || "").toUpperCase().startsWith("TP")) {
      pin.pinType = pin.pinType || "test_point";
      pin.pinRole = pin.pinRole || "test_point";
      pin.isTestPoint = true;
    }
    state.pins.push(pin);
    state.selectedPinId = pin.id;
    syncRuntimeComponentPins();
    redrawOverlays();
    return { ...pin };
  }

  function editComponentPins(componentId = null) {
    if (!boardRuntime()) {
      console.warn("[pcb] editComponentPins requires a loaded board.");
      return null;
    }

    const selected = selection();
    const targetId = componentId
      || selected?.pick?.componentId
      || selected?.target?.componentId
      || null;

    if (!targetId) {
      console.warn("[pcb] No component selected. Pick a component first or pass componentId.");
      return null;
    }

    if (!setComponent(targetId)) return null;
    state.isEditing = true;
    redrawOverlays();
    console.info(`[pcb] Pin editor enabled for component ${targetId}`);
    return cloneState();
  }

  function enableComponentPinEditor() {
    if (!boardRuntime()) {
      console.warn("[pcb] enableComponentPinEditor requires a loaded board.");
      return false;
    }
    if (!state.componentId) {
      const selected = selection();
      const selectedComponentId = selected?.pick?.componentId || selected?.target?.componentId || null;
      if (selectedComponentId) {
        setComponent(selectedComponentId);
      }
    }
    if (!state.componentId) console.warn("[pcb] No component selected for pin editor. Manual loose pin authoring enabled.");
    state.isEditing = true;
    redrawOverlays();
    return true;
  }

  function disableComponentPinEditor() {
    state.isEditing = false;
    state.relocateOnNextClick = false;
    redrawOverlays();
    return true;
  }

  function listComponentPins() {
    return state.pins.map((pin) => ({ ...pin }));
  }

  function listCreatedPins() {
    return listComponentPins().filter((pin) => pin.authoringSource === "manual-click");
  }

  function selectPin(pinId) {
    const wanted = String(pinId || "");
    const pin = state.pins.find((entry) => String(entry.id) === wanted);
    if (!pin) return null;
    state.selectedPinId = pin.id;
    redrawOverlays();
    return { ...pin };
  }

  function updatePin(pinId, patch = {}) {
    const wanted = String(pinId || state.selectedPinId || "");
    if (!wanted) return null;
    const idx = state.pins.findIndex((entry) => String(entry.id) === wanted);
    if (idx < 0) return null;
    const current = state.pins[idx];
    const next = { ...current, ...patch };
    if (patch.id !== undefined) next.id = String(patch.id || "").trim();
    if (!next.id) return null;
    if (patch.radius !== undefined) {
      const radius = Number(patch.radius);
      if (!Number.isFinite(radius) || radius <= 0) return null;
      next.radius = radius;
    }
    if (patch.x !== undefined || patch.y !== undefined) {
      const x = Number(patch.x ?? next.x);
      const y = Number(patch.y ?? next.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      next.x = Math.round(x);
      next.y = Math.round(y);
    }
    state.pins[idx] = next;
    if (state.selectedPinId === wanted) state.selectedPinId = next.id;
    syncRuntimeComponentPins();
    redrawOverlays();
    return { ...next };
  }

  function setPinGround(pinId, value) {
    const isGround = Boolean(value);
    const patch = { isGround };
    if (isGround) patch.pinRole = "ground";
    return updatePin(pinId, patch);
  }

  function setPinTestPoint(pinId, value) {
    const isTestPoint = Boolean(value);
    const patch = { isTestPoint };
    if (isTestPoint) {
      patch.pinRole = "test_point";
      patch.pinType = "test_point";
    }
    return updatePin(pinId, patch);
  }

  function moveSelectedPinTo(x, y) {
    return updatePin(state.selectedPinId, { x, y });
  }

  function moveSelectedPinOnNextClick() {
    if (!state.selectedPinId) return false;
    state.relocateOnNextClick = true;
    return true;
  }

  function consumeRelocateAtPoint(boardPoint) {
    if (!state.relocateOnNextClick || !state.selectedPinId) return null;
    const moved = moveSelectedPinTo(boardPoint.x, boardPoint.y);
    state.relocateOnNextClick = false;
    return moved;
  }

  function deleteSelectedPin() {
    if (!state.selectedPinId) return null;
    const idx = state.pins.findIndex((pin) => pin.id === state.selectedPinId);
    if (idx < 0) return null;
    const [removed] = state.pins.splice(idx, 1);
    state.selectedPinId = state.pins[idx]?.id || state.pins[idx - 1]?.id || null;
    syncRuntimeComponentPins();
    redrawOverlays();
    return removed ? { ...removed } : null;
  }

  function exportEditedComponentPins() {
    const component = getSelectedRuntimeComponent();
    if (!component) return null;
    return {
      id: component.id,
      refdes: component.refdes,
      kind: component.kind,
      bbox: component.raw?.bbox || null,
      pins: listComponentPins(),
    };
  }

  function exportCreatedPins() {
    const runtime = boardRuntime();
    const board = getBoard?.() || null;
    return {
      boardId: board?.id || runtime?.board?.id || null,
      componentId: state.componentId || null,
      pins: listCreatedPins(),
    };
  }

  function exportSelectedComponentPatch() {
    const selected = selection();
    const componentId = state.componentId || selected?.pick?.componentId || null;
    if (!componentId) return null;
    const pins = listCreatedPins().filter((pin) => (pin.componentId || componentId) === componentId);
    return { id: componentId, pins };
  }

  function dumpEditedComponent() {
    const component = getSelectedRuntimeComponent();
    if (!component) return null;
    return {
      id: component.id,
      refdes: component.refdes,
      kind: component.kind,
      rails: component.rails,
      pins: listComponentPins(),
    };
  }

  function getSelectedComponentId() {
    const selected = selection();
    return selected?.pick?.componentId || state.componentId || null;
  }

  function getSelectedComponent() {
    const id = getSelectedComponentId();
    if (!id) return null;
    return boardRuntime()?.componentsById?.[id] || null;
  }

  function dumpSelectedComponentPins() {
    const id = getSelectedComponentId();
    if (!id) return [];
    return state.pins.filter((pin) => (pin.componentId || id) === id).map((pin) => ({ ...pin }));
  }

  function reset() {
    state = createInitialState();
    clearOverlayList(pinEditorOverlays);
    clearOverlayList(runtimePinOverlays);
  }

  return {
    addPinAtPoint,
    consumeRelocateAtPoint,
    debugPinPlacementState: () => ({
      enabled: state.isEditing,
      selectedPinId: state.selectedPinId,
      targetComponentId: state.componentId,
      createdPins: listCreatedPins().length,
    }),
    debugState: cloneState,
    deleteSelectedPin,
    disableComponentPinEditor,
    dumpEditedComponent,
    dumpSelectedComponentPins,
    dumpSelectedPin: () => state.selectedPinId
      ? state.pins.find((pin) => pin.id === state.selectedPinId) || null
      : null,
    editComponentPins,
    enableComponentPinEditor,
    exportCreatedPins,
    exportCreatedPinsJson: () => JSON.stringify(exportCreatedPins(), null, 2),
    exportEditedComponentPins,
    exportEditedComponentPinsJson: () => {
      const payload = exportEditedComponentPins();
      return payload ? JSON.stringify(payload, null, 2) : "";
    },
    exportSelectedComponentPatch,
    getComponentId: () => state.componentId,
    getSelectedComponent,
    getSelectedComponentId,
    isEditing: () => state.isEditing,
    listComponentPins,
    listCreatedPins,
    moveSelectedPinOnNextClick,
    moveSelectedPinTo,
    pickAtPoint,
    redrawOverlays,
    redrawRuntimeOverlays,
    renamePin: (pinId, newId) => updatePin(pinId, { id: newId }),
    reset,
    selectCreatedPin: selectPin,
    selectPin,
    setPinGround,
    setPinName: (pinId, name) => updatePin(pinId, { name: name == null ? null : String(name) }),
    setPinNode: (pinId, node) => updatePin(pinId, { node: node == null ? null : String(node) }),
    setPinRail: (pinId, railId) => updatePin(pinId, { railId: railId == null ? null : String(railId) }),
    setPinRadius: (pinId, radius) => updatePin(pinId, { radius }),
    setPinRole: (pinId, role) => {
      if (role != null && !PIN_ROLE_VALUES.has(String(role))) console.warn(`[pcb] Unknown pinRole: ${role}`);
      return updatePin(pinId, { pinRole: role == null ? null : String(role) });
    },
    setPinType: (pinId, type) => {
      if (type != null && !PIN_TYPE_VALUES.has(String(type))) console.warn(`[pcb] Unknown pinType: ${type}`);
      return updatePin(pinId, { pinType: type == null ? null : String(type) });
    },
  };
}
