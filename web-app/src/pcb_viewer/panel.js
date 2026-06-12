import { createDeepZoomViewer } from "./viewer/deepzoom.js";
import OpenSeadragon from "openseadragon";
import {
  clearCache,
  getBoardList,
  createTileUrlResolver,
  loadBoardRuntimeBundle,
  refreshBoardRuntimeBundle,
} from "./viewer/board_loader.js";
import { createPadPickerController } from "./pad_picker.js";
import { createComponentLabelController } from "./component_labels.js";
import {
  pickAtScreenPoint,
  pickBoardTarget,
  resolveMeasurementTarget,
  describePick,
  screenToBoardPoint,
} from "./viewer/picking.js";
import {
  applyViewerInteractionMode as applyViewerMode,
  currentProbeCursor,
} from "./viewer/probe_interaction.js";
import {
  applyProbeOverlayCursor,
  drawPlacedProbeTargetOverlays,
  drawProbePointOverlays,
  setProbeOverlayVisualState,
} from "./viewer/probe_overlays.js";
import {
  clearViewerOverlayList,
  createRectOverlay,
} from "./viewer/overlays.js";
import {
  mountPanelShell,
  renderBoardOptions,
  renderRailOptions,
  stopViewerInputOnUiLayer,
  syncModeButtons as syncPanelModeButtons,
} from "./viewer/panel_ui.js";
import { createPinEditorController } from "./viewer/pin_editor_controller.js";
import {
  initAuthoringStudio,
  updateAuthoringViewerRefs,
  handleAuthoringCanvasClick,
  installBoxDragHandlers,
  refreshOverlays as refreshAuthoringOverlays,
  resetAuthoringOnBoardChange,
  installAuthoringDevHelpers,
  isAuthoringEnabled,
  isBoxDragActive,
  isAuthoringActive,
  shouldInterceptDrag,
  getActiveTool,
  getAuthoringState,
} from "./authoring_studio.js";

let viewerInstance = null;
let railOverlays = [];
let componentOverlays = [];
let psuTargetOverlays = [];
let currentBoard = null;
let currentBoardRuntime = null;
let currentSelection = null;
let psuTargetRail = null;
let probeMode = true;
let probeOverlays = [];
let placedProbeOverlays = [];
let activeProbePolarity = "positive";
let lastSyntheticCanvasClick = null;
let authoringSavedHandler = null;

let placedProbeTargets = {
  positive: null,
  negative: null,
};

const padPicker = createPadPickerController({
  getViewer: () => viewerInstance,
  getBoardRuntime: () => currentBoardRuntime,
  getBoard: () => currentBoard,
  getProbeMode: () => probeMode,
  getMountPoint: () => document.querySelector("#motherboardMap"),
  setStatus,
});

const componentLabels = createComponentLabelController({
  getViewer: () => viewerInstance,
  getBoardRuntime: () => currentBoardRuntime,
  getSpaces,
});

const pinEditor = createPinEditorController({
  getViewer: () => viewerInstance,
  getBoardRuntime: () => currentBoardRuntime,
  getBoard: () => currentBoard,
  getSelection: () => currentSelection,
  clearOverlayList,
});

function getSpaces() {
  return currentBoardRuntime?.spaces || {
    imgW: currentBoard?.image?.full_width_px || 2048,
    imgH: currentBoard?.image?.full_height_px || 2048,
    dataW: currentBoard?.data_space?.width_px || currentBoard?.image?.full_width_px || 2048,
    dataH: currentBoard?.data_space?.height_px || currentBoard?.image?.full_height_px || 2048,
    sx: 1,
    sy: 1,
  };
}

export function getBoardSize() {
  return {
    w: currentBoard?.image?.full_width_px,
    h: currentBoard?.image?.full_height_px,
  };
}

function clearOverlayList(list) {
  clearViewerOverlayList(viewerInstance, list);
}

function setProbeVisualState(selectedProbeId = null) {
  setProbeOverlayVisualState(probeOverlays, selectedProbeId);
}
function getCurrentProbeCursor() {
  return currentProbeCursor(activeProbePolarity);
}

function applyCurrentViewerInteractionMode(viewer, mountPoint = null) {
  applyViewerMode({
    viewer,
    mountPoint,
    probeMode,
    activeProbePolarity,
    setStatus,
  });
}

function applyProbeCursorToOverlays() {
  applyProbeOverlayCursor(probeOverlays, getCurrentProbeCursor());
}
function setProbePolarity(polarity = "positive") {
  activeProbePolarity = polarity === "negative" ? "negative" : "positive";
  applyProbeCursorToOverlays();
  const mountPoint = document.querySelector("#motherboardMap");
  applyCurrentViewerInteractionMode(viewerInstance, mountPoint);
}

export function clearScene() {
  clearOverlayList(probeOverlays);
  clearOverlayList(placedProbeOverlays);
  clearOverlayList(railOverlays);
  clearOverlayList(componentOverlays);
  clearOverlayList(psuTargetOverlays);
  pinEditor.reset();
  padPicker.reset();
  componentLabels.clear();
  safeDestroyViewer();

  currentBoard = null;
  currentBoardRuntime = null;
  currentSelection = null;
  psuTargetRail = null;
  probeMode = true;
  placedProbeTargets = {
    positive: null,
    negative: null,
  };

  if (authoringSavedHandler) {
    window.removeEventListener("pcb:authoring-saved", authoringSavedHandler);
    authoringSavedHandler = null;
  }

  clearCache();

  const railSelect = document.querySelector("#rail-select");
  if (railSelect) railSelect.innerHTML = '<option value="">-- Select Rail --</option>';
}

function redrawPickedPadOverlays() {
  padPicker.redraw();
}

export function enablePadPicker() {
  return padPicker.enable();
}

export function disablePadPicker() {
  return padPicker.disable();
}

export function listPickedPads() {
  return padPicker.list();
}

export function clearPickedPads() {
  return padPicker.clear();
}

export function removeLastPickedPad() {
  return padPicker.removeLast();
}

export function exportPickedPads() {
  return padPicker.exportPayload();
}

export function exportPickedPadsJson() {
  return padPicker.exportJson();
}

function redrawRuntimePinOverlays() {
  pinEditor.redrawRuntimeOverlays();
}

function redrawPinEditorOverlays() {
  pinEditor.redrawOverlays();
}

export function editComponentPins(componentId = null) {
  return pinEditor.editComponentPins(componentId);
}

export function enableComponentPinEditor() {
  return pinEditor.enableComponentPinEditor();
}

export function disableComponentPinEditor() {
  return pinEditor.disableComponentPinEditor();
}

export function listComponentPins() {
  return pinEditor.listComponentPins();
}

export function listCreatedPins() {
  return pinEditor.listCreatedPins();
}

export function selectPin(pinId) {
  return pinEditor.selectPin(pinId);
}

export function renamePin(pinId, newId) {
  return pinEditor.renamePin(pinId, newId);
}

export function setPinName(pinId, name) {
  return pinEditor.setPinName(pinId, name);
}

export function setPinNode(pinId, node) {
  return pinEditor.setPinNode(pinId, node);
}

export function setPinType(pinId, type) {
  return pinEditor.setPinType(pinId, type);
}

export function setPinRole(pinId, role) {
  return pinEditor.setPinRole(pinId, role);
}

export function setPinGround(pinId, value) {
  return pinEditor.setPinGround(pinId, value);
}

export function setPinTestPoint(pinId, value) {
  return pinEditor.setPinTestPoint(pinId, value);
}

export function setPinRail(pinId, railId) {
  return pinEditor.setPinRail(pinId, railId);
}

export function setPinRadius(pinId, radius) {
  return pinEditor.setPinRadius(pinId, radius);
}

export function moveSelectedPinTo(x, y) {
  return pinEditor.moveSelectedPinTo(x, y);
}

export function moveSelectedPinOnNextClick() {
  return pinEditor.moveSelectedPinOnNextClick();
}

export function deleteSelectedPin() {
  return pinEditor.deleteSelectedPin();
}

export function exportEditedComponentPins() {
  return pinEditor.exportEditedComponentPins();
}

export function exportCreatedPins() {
  return pinEditor.exportCreatedPins();
}

export function exportCreatedPinsJson() {
  return pinEditor.exportCreatedPinsJson();
}

export function exportSelectedComponentPatch() {
  return pinEditor.exportSelectedComponentPatch();
}

export function exportEditedComponentPinsJson() {
  return pinEditor.exportEditedComponentPinsJson();
}

export function dumpEditedComponent() {
  return pinEditor.dumpEditedComponent();
}

export function getSelectedComponentId() {
  return pinEditor.getSelectedComponentId();
}

export function getSelectedComponent() {
  return pinEditor.getSelectedComponent();
}

export function dumpSelectedComponentPins() {
  return pinEditor.dumpSelectedComponentPins();
}

export function dumpSelectedPin() {
  return pinEditor.dumpSelectedPin();
}

export function debugPinEditorState() {
  return pinEditor.debugState();
}

export function debugPinPlacementState() {
  return pinEditor.debugPinPlacementState();
}

export function enablePinPlacementMode() {
  return pinEditor.enableComponentPinEditor();
}

export function disablePinPlacementMode() {
  return pinEditor.disableComponentPinEditor();
}

export function selectCreatedPin(pinId) {
  return pinEditor.selectCreatedPin(pinId);
}
export function dumpViewerRuntime() {
  return {
    boardId: currentBoard?.id || null,
    padPickerEnabled: padPicker.isEnabled(),
    pickedPadCount: padPicker.list().length,
    latestPadPoint: padPicker.getLatestPoint(),
    probeMode,
    selection: currentSelection,
    pinEditor: pinEditor.debugState(),
  };
}

// ── Floating fixed-size label system ──────────────────────────────────────────
/**
 * Render labels for ALL components in boardRuntime.
 * Called once after board + viewer are ready.
 */
export function drawAllComponentLabels() {
  componentLabels.draw();

    // Use OSD's native image→viewport conversion (handles aspect ratio)
}

function addBoxOverlay(list, box, styles = {}) {
  if (!viewerInstance?.viewport || !box) return;
  const { sx, sy } = getSpaces();
  const rawMinX = Number(box.minX);
  const rawMinY = Number(box.minY);
  const rawMaxX = Number(box.maxX);
  const rawMaxY = Number(box.maxY);
  if (![rawMinX, rawMinY, rawMaxX, rawMaxY].every(Number.isFinite)) return;

  const looksLikeImageSpace = rawMaxX > currentBoardRuntime?.spaces?.dataW
    || rawMaxY > currentBoardRuntime?.spaces?.dataH;
  const minXi = looksLikeImageSpace ? rawMinX : rawMinX * sx;
  const minYi = looksLikeImageSpace ? rawMinY : rawMinY * sy;
  const maxXi = looksLikeImageSpace ? rawMaxX : rawMaxX * sx;
  const maxYi = looksLikeImageSpace ? rawMaxY : rawMaxY * sy;

  const imgRect = new OpenSeadragon.Rect(
    minXi,
    minYi,
    Math.max(1, maxXi - minXi),
    Math.max(1, maxYi - minYi)
  );
  const rect = viewerInstance.viewport.imageToViewportRectangle(imgRect);
  const element = createRectOverlay(styles);
  viewerInstance.addOverlay({ element, location: rect });
  list.push({ element });
}


function drawRailOverlay(rail) {
  clearOverlayList(railOverlays);
  if (!rail?.overlayBox) return;
  addBoxOverlay(railOverlays, rail.overlayBox, {
    border: "2px solid rgba(255,200,0,0.85)",
    background: "rgba(255,200,0,0.18)",
    boxShadow: "0 0 10px rgba(255,200,0,0.35)",
  });
}

function drawComponentOverlay(component) {
  clearOverlayList(componentOverlays);
  if (!component?.bbox) return;
  addBoxOverlay(componentOverlays, component.bbox, {
    border: "2px solid rgba(74, 222, 128, 0.92)",
    background: "rgba(74, 222, 128, 0.14)",
    boxShadow: "0 0 10px rgba(74, 222, 128, 0.4)",
  });
}

function drawPsuTargetOverlay(rail) {
  clearOverlayList(psuTargetOverlays);
  if (!rail?.overlayBox) return;
  addBoxOverlay(psuTargetOverlays, rail.overlayBox, {
    border: "2px dashed rgba(80,170,255,0.9)",
    background: "rgba(80,170,255,0.12)",
    boxShadow: "0 0 6px rgba(80,170,255,0.7)",
  });
}

function drawPlacedProbeTargets() {
  drawPlacedProbeTargetOverlays({
    viewer: viewerInstance,
    boardRuntime: currentBoardRuntime,
    placedProbeTargets,
    placedProbeOverlays,
    clearOverlayList,
  });
}
export function drawProbePoints(viewer, boardRuntime) {
  drawProbePointOverlays({
    viewer,
    boardRuntime,
    probeOverlays,
    clearOverlayList,
    getCursor: getCurrentProbeCursor,
    onProbePicked: (pick) => dispatchSelection(pick, { source: "probe-overlay" }),
  });
  drawPlacedProbeTargets();
}

export function toggleProbeMode(viewer, boardRuntime) {
  probeMode = !probeMode;
  if (probeMode) drawProbePoints(viewer, boardRuntime);
  else clearOverlayList(probeOverlays);
  drawPlacedProbeTargets();
  if (currentSelection?.target?.type === "probe") {
    setProbeVisualState(currentSelection.target.probeId);
  }
  const mountPoint = document.querySelector("#motherboardMap");
  applyCurrentViewerInteractionMode(viewer, mountPoint);
  return probeMode;
}

function setProbeModeState(viewer, boardRuntime, nextProbeMode) {
  probeMode = Boolean(nextProbeMode);
  if (probeMode) drawProbePoints(viewer, boardRuntime);
  else clearOverlayList(probeOverlays);
  drawPlacedProbeTargets();
  if (currentSelection?.target?.type === "probe") {
    setProbeVisualState(currentSelection.target.probeId);
  }
  const mountPoint = document.querySelector("#motherboardMap");
  applyCurrentViewerInteractionMode(viewer, mountPoint);
  return probeMode;
}

export function setPlacedProbeTargets(targets = {}) {
  placedProbeTargets = {
    positive: targets?.positive || null,
    negative: targets?.negative || null,
  };
  drawPlacedProbeTargets();
}

function setStatus(mountPoint, message) {
  const element = document.querySelector("#pcb-status")
    || mountPoint?.querySelector("#pcb-status");
  if (element) element.textContent = message;
}

function applySelectionVisuals(pick) {
  clearOverlayList(railOverlays);
  clearOverlayList(componentOverlays);
  setProbeVisualState(null);

  if (!pick) {
    redrawPinEditorOverlays();
    return;
  }
  if (pick.type === "probe") {
    setProbeVisualState(pick.probeId);
    const rail = currentBoardRuntime?.railsById?.[pick.railId];
    if (rail) drawRailOverlay(rail);
    redrawPinEditorOverlays();
    return;
  }
  if (pick.type === "component" || pick.type === "component-pin") {
    const component = currentBoardRuntime?.componentsById?.[pick.componentId];
    if (component) drawComponentOverlay(component);
    redrawPinEditorOverlays();
    return;
  }
  if (pick.type === "rail") {
    const rail = currentBoardRuntime?.railsById?.[pick.railId];
    if (rail) drawRailOverlay(rail);
  }
  redrawPinEditorOverlays();
}

function dispatchSelection(pick, { source = "board" } = {}) {
  if (!pick) return null;

  const measurementTarget = resolveMeasurementTarget(pick);
  currentSelection = {
    pick,
    target: measurementTarget,
    source,
  };

  applySelectionVisuals(pick);

  const mountPoint = document.querySelector("#motherboardMap");
  if (mountPoint) setStatus(mountPoint, `Selected: ${describePick(pick)}`);

  const detail = {
    pick,
    target: measurementTarget,
    source,
    boardRuntime: currentBoardRuntime,
    board: currentBoard,
  };

  window.dispatchEvent(new CustomEvent("pcb:target-picked", { detail }));
  window.dispatchEvent(new CustomEvent("pcb:measurement-target-selected", { detail }));
  return detail;
}

export function onRailSelected(railId) {
  if (!currentBoardRuntime?.railsById?.[railId]) return null;
  const rail = currentBoardRuntime.railsById[railId];
  return dispatchSelection({
    type: "rail",
    id: rail.id,
    railId: rail.id,
    label: rail.label,
    raw: rail,
  }, { source: "rail-select" });
}

export function setPsuTargetRail(railId) {
  psuTargetRail = railId || null;
  clearOverlayList(psuTargetOverlays);
  if (!psuTargetRail) return;
  const rail = currentBoardRuntime?.railsById?.[psuTargetRail];
  if (rail) drawPsuTargetOverlay(rail);
}

function handleCanvasClick(event) {
  if (!event?.quick || !viewerInstance || !currentBoardRuntime) return;

  if (!event.syntheticDirectClick && lastSyntheticCanvasClick) {
    const ageMs = Date.now() - lastSyntheticCanvasClick.time;
    const dx = Math.abs((event.position?.x || 0) - lastSyntheticCanvasClick.x);
    const dy = Math.abs((event.position?.y || 0) - lastSyntheticCanvasClick.y);
    if (ageMs < 250 && dx <= 2 && dy <= 2) {
      return;
    }
  }

  // ── Authoring Studio intercept ──
  if (isAuthoringEnabled()) {
    const handled = handleAuthoringCanvasClick(event, viewerInstance, currentBoardRuntime);
    if (handled) return;
  }

  const point = screenToBoardPoint(viewerInstance, currentBoardRuntime, event.position);

  if (pinEditor.isEditing()) {
    if (!point) {
      console.warn("[pcb] Could not resolve click point for pin editor.");
      return;
    }

    const mountPoint = document.querySelector("#motherboardMap");
    const moved = pinEditor.consumeRelocateAtPoint(point.board);
    if (moved) {
      if (mountPoint) setStatus(mountPoint, `Moved pin ${moved.id} to (${moved.x}, ${moved.y})`);
      event.preventDefaultAction = true;
      return;
    }

    const hitPin = pinEditor.pickAtPoint(point.board);
    if (hitPin) {
      pinEditor.selectPin(hitPin.id);
      const componentId = pinEditor.getComponentId();
      if (mountPoint) setStatus(mountPoint, `Selected pin ${hitPin.id}${componentId ? ` on ${componentId}` : ""}`);
      event.preventDefaultAction = true;
      return;
    }

    const created = pinEditor.addPinAtPoint(point.board);
    if (mountPoint && created) {
      const railHint = created.railId ? ` rail=${created.railId}` : "";
      setStatus(mountPoint, `Added pin ${created.id} @ (${created.x}, ${created.y})${railHint}`);
    }
    console.info("[pcb] Created authoring pin", created);
    event.preventDefaultAction = true;
    return;
  }

  if (padPicker.isEnabled()) {
    if (!point) {
      console.warn("[pcb] Could not resolve click point for pad picker.");
      return;
    }

    const pad = padPicker.addAtPoint(point, { radius: 6 });
    const mountPoint = document.querySelector("#motherboardMap");
    if (mountPoint) {
      setStatus(mountPoint, `Picked ${pad.id} @ (${pad.x}, ${pad.y})`);
    }
    console.info("[pcb] Pad picked", pad);
    event.preventDefaultAction = true;
    return;
  }

  if (!probeMode) {
    if (!point) return;
    const picked = pickBoardTarget(currentBoardRuntime, point);
    if (picked?.type === "component" || picked?.type === "component-pin") {
      dispatchSelection(picked, { source: "canvas" });
    }
    return;
  }

  const picked = pickAtScreenPoint(viewerInstance, currentBoardRuntime, event.position);
  if (!picked) {
    // Fallback: try to select a component even in probe mode
    if (point) {
      const compPick = pickBoardTarget(currentBoardRuntime, point);
      if (compPick?.type === "component" || compPick?.type === "component-pin") {
        dispatchSelection(compPick, { source: "canvas" });
        return;
      }
    }
    const mountPoint = document.querySelector("#motherboardMap");
    if (mountPoint) setStatus(mountPoint, "No measurable target at click position.");
    window.dispatchEvent(new CustomEvent("pcb:pick-missed", {
      detail: { boardRuntime: currentBoardRuntime },
    }));
    return;
  }
  dispatchSelection(picked, { source: "canvas" });
}

function safeDestroyViewer() {
  if (viewerInstance && typeof viewerInstance.destroy === "function") {
    try {
      viewerInstance.destroy();
    } catch {
      // ignore viewer destroy errors
    }
  }
  viewerInstance = null;
}

export function initPcbViewerPanel({ mountSelector, onBoardReady } = {}) {
  const mountPoint = document.querySelector(mountSelector);
  if (!mountPoint) return null;
  const toolbarHost = document.querySelector("#pcbViewerToolbar");

  const {
    canvasTarget,
    homeBtn,
    loadBtn,
    navBtn,
    probeBtn,
    railSelect,
    select,
    uiLayer,
    zoomInBtn,
    zoomOutBtn,
  } = mountPanelShell({ mountPoint, toolbarHost });

  stopViewerInputOnUiLayer(uiLayer);
  railSelect.addEventListener("change", () => {
    if (railSelect.value) onRailSelected(railSelect.value);
  });

  let boards = [];
  let manualNavDrag = null;

  canvasTarget.addEventListener("wheel", (event) => {
    if (probeMode || !viewerInstance?.viewport) return;
    event.preventDefault();
    const rect = canvasTarget.getBoundingClientRect();
    const pixelPoint = new OpenSeadragon.Point(
      event.clientX - rect.left,
      event.clientY - rect.top
    );
    const refPoint = viewerInstance.viewport.pointFromPixel(pixelPoint, true);
    const factor = event.deltaY < 0 ? 1.2 : (1 / 1.2);
    viewerInstance.viewport.zoomBy(factor, refPoint);
    viewerInstance.viewport.applyConstraints();
  }, { passive: false });

  canvasTarget.addEventListener("pointerdown", (event) => {
    // Don't start nav drag if authoring box tool is active
    if (shouldInterceptDrag()) return;
    if (probeMode || !viewerInstance?.viewport) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    manualNavDrag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    canvasTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  canvasTarget.addEventListener("pointermove", (event) => {
    if (probeMode || !viewerInstance?.viewport || !manualNavDrag) return;
    if (event.pointerId !== manualNavDrag.pointerId) return;

    const dx = event.clientX - manualNavDrag.x;
    const dy = event.clientY - manualNavDrag.y;
    manualNavDrag.x = event.clientX;
    manualNavDrag.y = event.clientY;
    if (dx === 0 && dy === 0) return;

    const delta = viewerInstance.viewport.deltaPointsFromPixels(
      new OpenSeadragon.Point(-dx, -dy),
      true
    );
    viewerInstance.viewport.panBy(delta, true);
    viewerInstance.viewport.applyConstraints();
    event.preventDefault();
  });

  const endManualNavDrag = (event) => {
    if (!manualNavDrag) return;
    if (event?.pointerId != null && event.pointerId !== manualNavDrag.pointerId) return;
    canvasTarget.releasePointerCapture?.(manualNavDrag.pointerId);
    manualNavDrag = null;
  };

  canvasTarget.addEventListener("pointerup", endManualNavDrag);
  canvasTarget.addEventListener("pointercancel", endManualNavDrag);
  canvasTarget.addEventListener("lostpointercapture", endManualNavDrag);

  // ── Direct click handler (registered once) ──────────────────────────────────
  // OSD's canvas-click event.quick is unreliable when clickToZoom is disabled.
  // We track drag distance ourselves and call handleCanvasClick with a synthetic
  // event object that is compatible with the existing handler.
  let _clickDownX = 0, _clickDownY = 0, _clickDownTime = 0;
  canvasTarget.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    _clickDownX = e.clientX;
    _clickDownY = e.clientY;
    _clickDownTime = Date.now();
  }, { capture: false }); // passive listener, doesn't interfere with box drag

  canvasTarget.addEventListener("click", (e) => {
    if (!viewerInstance || !currentBoardRuntime) return;

    const movedPx = Math.hypot(e.clientX - _clickDownX, e.clientY - _clickDownY);
    if (movedPx > 8) return;
    if (Date.now() - _clickDownTime > 600) return;
    if (isBoxDragActive()) return;

    if (isAuthoringEnabled()) {
      const screenX = e.clientX;
      const screenY = e.clientY;
      const screenPoint = new OpenSeadragon.Point(screenX, screenY);
      screenPoint.coordinateSpace = "client";
      const syntheticEvent = {
        quick: true,
        position: screenPoint,
        preventDefaultAction: false,
        syntheticDirectClick: true,
      };
      console.debug("[authoring] click →", getActiveTool(), { screenX, screenY });
      const handled = handleAuthoringCanvasClick(syntheticEvent, viewerInstance, currentBoardRuntime);
      if (handled) return;
      lastSyntheticCanvasClick = { x: screenX, y: screenY, time: Date.now() };
      handleCanvasClick(syntheticEvent);
      return;
    }

    const screenX = e.clientX;
    const screenY = e.clientY;
    const screenPoint = new OpenSeadragon.Point(screenX, screenY);
    screenPoint.coordinateSpace = "client";
    const syntheticEvent = {
      quick: true,
      position: screenPoint,
      preventDefaultAction: false,
      syntheticDirectClick: true,
    };
    lastSyntheticCanvasClick = { x: screenX, y: screenY, time: Date.now() };
    handleCanvasClick(syntheticEvent);
  }, false);

  function syncModeButtons() {
    syncPanelModeButtons({ probeBtn, navBtn, zoomInBtn, zoomOutBtn, homeBtn, probeMode });
  }

  async function loadBoardsList() {
    setStatus(mountPoint, "Loading boards...");
    loadBtn.disabled = true;
    try {
      boards = await getBoardList();
      if (!boards.length) {
        select.innerHTML = "";
        setStatus(mountPoint, "No boards in manifest.json");
        return;
      }
      renderBoardOptions(select, boards);
      setStatus(mountPoint, `Boards: ${boards.length}`);
    } catch (error) {
      console.error("Failed to load boards manifest:", error);
      select.innerHTML = "";
      setStatus(mountPoint, `Failed to load boards: ${error.message}`);
    } finally {
      loadBtn.disabled = false;
    }
  }

  async function loadBoard(boardId) {
    if (!boardId) {
      setStatus(mountPoint, "No board selected");
      return;
    }

    setStatus(mountPoint, `Loading board: ${boardId}...`);
    loadBtn.disabled = true;

    try {
      const bundle = await loadBoardRuntimeBundle(boardId);
      const {
        boardData,
        components,
        railFile,
        rails,
        runtime,
        thermal,
        topology,
      } = bundle;
      safeDestroyViewer();

      viewerInstance = await createDeepZoomViewer({
        el: canvasTarget,
        board: boardData,
        getTileUrl: createTileUrlResolver(boardData),
      });

      currentBoard = bundle.board;
      currentBoardRuntime = runtime;
      currentSelection = null;
      pinEditor.reset();
      redrawPickedPadOverlays();

      // ── Authoring Studio: update refs & install drag handler ──
      resetAuthoringOnBoardChange();
      initAuthoringStudio({
        viewerInstance,
        boardRuntime: currentBoardRuntime,
        getSpaces,
        mountTarget: mountPoint,
        screenToBoardPoint,
      });
      installBoxDragHandlers(canvasTarget, viewerInstance, currentBoardRuntime);
      installAuthoringDevHelpers();

      // canvas-click via OSD (for probe/pin-editor flow — NOT for authoring pin tool)
      // This is registered once per viewer; OSD deduplicates the same function reference.
      viewerInstance.addHandler("canvas-click", handleCanvasClick);

      renderRailOptions(railSelect, currentBoardRuntime.rails);

      setProbeModeState(viewerInstance, currentBoardRuntime, true);
      syncModeButtons();

      // Draw labels for all components once the image is fully loaded
      // so imageToViewportCoordinates has correct data
      const _drawLabelsOnce = () => {
        drawAllComponentLabels();
        redrawPinEditorOverlays();
        viewerInstance.removeHandler("open", _drawLabelsOnce);
      };
      if (viewerInstance.world?.getItemCount() > 0) {
        // Image already open — draw immediately
        drawAllComponentLabels();
        redrawPinEditorOverlays();
      } else {
        viewerInstance.addHandler("open", _drawLabelsOnce);
      }
      probeBtn.onclick = () => {
        setProbeModeState(viewerInstance, currentBoardRuntime, true);
        syncModeButtons();
      };
      navBtn.onclick = () => {
        setProbeModeState(viewerInstance, currentBoardRuntime, false);
        syncModeButtons();
      };
      zoomInBtn.onclick = () => {
        if (probeMode || !viewerInstance?.viewport) return;
        viewerInstance.viewport.zoomBy(1.2);
        viewerInstance.viewport.applyConstraints();
      };
      zoomOutBtn.onclick = () => {
        if (probeMode || !viewerInstance?.viewport) return;
        viewerInstance.viewport.zoomBy(1 / 1.2);
        viewerInstance.viewport.applyConstraints();
      };
      homeBtn.onclick = () => {
        if (probeMode || !viewerInstance?.viewport) return;
        viewerInstance.viewport.goHome();
      };
      setStatus(mountPoint, `Loaded: ${boardData?.name || boardId}. Probe mode active. Click probe, component, or rail to measure.`);

      const detail = {
        board: boardData,
        components,
        rails,
        topology,
        thermal,
        railFile,
        runtime: currentBoardRuntime,
      };

      if (typeof onBoardReady === "function") {
        onBoardReady(detail);
      }
      window.dispatchEvent(new CustomEvent("pcb:board-runtime-ready", { detail }));

      // When authoring saves new components, refresh runtime + labels
      if (authoringSavedHandler) {
        window.removeEventListener("pcb:authoring-saved", authoringSavedHandler);
      }
      authoringSavedHandler = async (e) => {
        if (e.detail?.boardId !== boardId || !viewerInstance) return;
        try {
          clearCache(boardId);
          const freshBundle = await refreshBoardRuntimeBundle(boardId, { boardData, topology, thermal });
          currentBoard = freshBundle.board;
          currentBoardRuntime = freshBundle.runtime;
          updateAuthoringViewerRefs({
            viewerInstance,
            boardRuntime: currentBoardRuntime,
            getSpaces,
          });
          drawAllComponentLabels();
          redrawPinEditorOverlays();
          if (probeMode) drawProbePoints(viewerInstance, currentBoardRuntime);
          console.info("[pcb] Runtime refreshed after authoring save — labels updated.");
        } catch (err) {
          console.warn("[pcb] Failed to refresh runtime after save:", err);
        }
      };
      window.addEventListener("pcb:authoring-saved", authoringSavedHandler);
    } catch (error) {
      console.error("Load board failed:", error);
      setStatus(mountPoint, `Load failed: ${error.message}`);
      safeDestroyViewer();
    } finally {
      loadBtn.disabled = false;
    }
  }

  function debugPick(x, y) {
    if (!currentBoardRuntime) return null;
    const boardX = Number(x);
    const boardY = Number(y);
    if (!Number.isFinite(boardX) || !Number.isFinite(boardY)) return null;
    const point = {
      board: { x: boardX, y: boardY },
      image: {
        x: boardX * currentBoardRuntime.spaces.sx,
        y: boardY * currentBoardRuntime.spaces.sy,
      },
    };
    const pick = pickBoardTarget(currentBoardRuntime, point);
    const payload = pick ? { ...pick, measurementTarget: resolveMeasurementTarget(pick) } : null;
    console.log("debugPick", { x: boardX, y: boardY, result: payload });
    return payload;
  }

  loadBtn.onclick = () => loadBoard(select.value);
  select.addEventListener("change", () => loadBoard(select.value));

  loadBoardsList().then(() => {
    if (select.value) loadBoard(select.value);
  });

  return {
    loadBoard,
    clearScene,
    getBoardList,
    getCurrentRuntime: () => currentBoardRuntime,
    getCurrentSelection: () => currentSelection,
    isPadPickerEnabled: () => padPicker.isEnabled(),
    enablePadPicker,
    disablePadPicker,
    listPickedPads,
    clearPickedPads,
    removeLastPickedPad,
    exportPickedPads,
    exportPickedPadsJson,
    enableComponentPinEditor,
    disableComponentPinEditor,
    editComponentPins,
    listComponentPins,
    listCreatedPins,
    selectPin,
    selectCreatedPin,
    renamePin,
    setPinName,
    setPinType,
    setPinRole,
    setPinNode,
    setPinRail,
    setPinGround,
    setPinTestPoint,
    setPinRadius,
    deleteSelectedPin,
    moveSelectedPinTo,
    moveSelectedPinOnNextClick,
    exportEditedComponentPins,
    exportEditedComponentPinsJson,
    exportCreatedPins,
    exportCreatedPinsJson,
    exportSelectedComponentPatch,
    dumpEditedComponent,
    getSelectedComponentId,
    getSelectedComponent,
    dumpSelectedComponentPins,
    dumpSelectedPin,
    debugPinEditorState,
    debugPinPlacementState,
    enablePinPlacementMode,
    disablePinPlacementMode,
    dumpViewerRuntime,
    setProbePolarity,
    setPlacedProbeTargets,
    debugPick,
    // ── Authoring Studio ──
    getAuthoringState,
    isAuthoringEnabled,
  };
}
