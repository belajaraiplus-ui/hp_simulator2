import { createDeepZoomViewer } from "./viewer/deepzoom.js";
import OpenSeadragon from "openseadragon";
import {
  getBoardList,
  loadBoard as loadBoardData,
  loadComponents,
  loadRailsFile,
  loadTopology,
  loadThermal,
  getTileUrl,
  clearCache,
} from "../assets/loader.js";
import { buildBoardRuntime } from "./viewer/spatial_index.js";
import {
  pickAtScreenPoint,
  pickBoardTarget,
  resolveMeasurementTarget,
  describePick,
  screenToBoardPoint,
} from "./viewer/picking.js";

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
let activeProbePolarity = "positive";
let padPickerEnabled = false;
let pickedPads = [];
let pickedPadOverlays = [];
let pickedPadCounter = 0;
let latestPadPoint = null;
let latestPickedPadId = null;
const PAD_MARKER_DIAMETER_IMAGE_PX = 12;

function buildProbeCursor({
  cable = "#151515",
  cableShade = "#2b2b2b",
  handle = "#c82626",
  handleHighlight = "#f35a5a",
  guard = "#8f1717",
  collar = "#4a4f57",
  shaft = "#b8bec7",
  shaftHighlight = "#edf2f7",
  tip = "#9097a1",
  tipHighlight = "#dfe5ec",
  cableCap = "#861010",
} = {}) {
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <g fill="none" fill-rule="evenodd">
    <path d="M7 56 C11 49, 17 44, 22 39 C25 36, 28 33, 31 31" stroke="${cable}" stroke-width="4" stroke-linecap="round"/>
    <path d="M11 57 C16 51, 21 45, 28 39" stroke="${cableShade}" stroke-width="1.4" stroke-linecap="round" opacity="0.55"/>
    <path d="M12 54 L23 43 L29 49 L18 60 Z" fill="${handle}"/>
    <path d="M14 52 L23 43 L26 46 L17 55 Z" fill="${handleHighlight}" opacity="0.75"/>
    <path d="M23 43 L29 37 L34 42 L29 49 Z" fill="${guard}"/>
    <path d="M28.5 37.5 L33.5 32.5 L38.5 37.5 L33.5 42.5 Z" fill="${collar}"/>
    <path d="M33.5 32.5 L48 18" stroke="${shaft}" stroke-width="5" stroke-linecap="round"/>
    <path d="M35 31 L48 18" stroke="${shaftHighlight}" stroke-width="1.5" stroke-linecap="round" opacity="0.8"/>
    <path d="M47.5 18.5 L57 9" stroke="${tip}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M57 9 L61 5" stroke="${tipHighlight}" stroke-width="1.3" stroke-linecap="round"/>
    <circle cx="12" cy="56" r="2.4" fill="${cableCap}"/>
    <ellipse cx="41" cy="25" rx="10" ry="3.2" fill="#ffffff" opacity="0.12" transform="rotate(-45 41 25)"/>
  </g>
</svg>
`)}") 12 56, crosshair`;
}

const POSITIVE_PROBE_CURSOR = buildProbeCursor();
const NEGATIVE_PROBE_CURSOR = buildProbeCursor({
  handle: "#2c313a",
  handleHighlight: "#636b78",
  guard: "#11161d",
  collar: "#596170",
  cableCap: "#07090c",
});
const NAVIGATE_CURSOR = "zoom-in";

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
  if (!viewerInstance) {
    list.length = 0;
    return;
  }
  list.forEach((entry) => {
    try {
      viewerInstance.removeOverlay(entry.element || entry);
    } catch {
      // ignore overlay cleanup errors
    }
  });
  list.length = 0;
}

function setProbeVisualState(selectedProbeId = null) {
  probeOverlays.forEach((probe) => {
    const active = selectedProbeId && probe.probeId === selectedProbeId;
    probe.element.style.background = active ? "#ffe066" : "#ff4444";
    probe.element.style.transform = active ? "scale(1.25)" : "scale(1)";
    probe.element.style.boxShadow = active
      ? "0 0 8px rgba(255, 224, 102, 0.9)"
      : "0 0 4px rgba(0,0,0,0.5)";
  });
}

function getViewerCursorTargets(viewer) {
  if (!viewer) return [];
  return [viewer.canvas, viewer.container, viewer.element].filter(Boolean);
}

function currentProbeCursor() {
  return activeProbePolarity === "negative" ? NEGATIVE_PROBE_CURSOR : POSITIVE_PROBE_CURSOR;
}

function setViewerNavigationEnabled(viewer, enabled) {
  if (!viewer) return;
  const active = Boolean(enabled);

  if (typeof viewer.setMouseNavEnabled === "function") {
    viewer.setMouseNavEnabled(active);
  }

  const mouse = viewer.gestureSettingsMouse;
  if (mouse) {
    mouse.clickToZoom = active;
    mouse.dblClickToZoom = active;
    mouse.dragToPan = active;
    mouse.scrollToZoom = active;
    mouse.pinchToZoom = active;
    mouse.flickEnabled = active;
  }

  const touch = viewer.gestureSettingsTouch;
  if (touch) {
    touch.dragToPan = active;
    touch.pinchToZoom = active;
    touch.flickEnabled = active;
    touch.clickToZoom = active;
    touch.dblClickToZoom = active;
  }

  const pen = viewer.gestureSettingsPen;
  if (pen) {
    pen.dragToPan = active;
    pen.scrollToZoom = active;
    pen.clickToZoom = active;
    pen.dblClickToZoom = active;
  }
}

function applyViewerInteractionMode(viewer, mountPoint = null) {
  if (!viewer) return;

  setViewerNavigationEnabled(viewer, false);
  getViewerCursorTargets(viewer).forEach((target) => {
    target.style.cursor = probeMode ? currentProbeCursor() : NAVIGATE_CURSOR;
    target.style.touchAction = probeMode ? "auto" : "none";
  });

  if (mountPoint) {
    setStatus(
      mountPoint,
      probeMode
        ? `Probe mode active (${activeProbePolarity === "negative" ? "NEG" : "POS"}). Click probe, component, or rail to measure.`
        : "Navigate mode active. Pan/zoom PCB, then switch back to probe mode to measure."
    );
  }
}

function applyProbeCursorToOverlays() {
  const cursor = currentProbeCursor();
  probeOverlays.forEach((probe) => {
    probe.element.style.cursor = cursor;
  });
}

function setProbePolarity(polarity = "positive") {
  activeProbePolarity = polarity === "negative" ? "negative" : "positive";
  applyProbeCursorToOverlays();
  const mountPoint = document.querySelector("#motherboardMap");
  applyViewerInteractionMode(viewerInstance, mountPoint);
}

export function clearScene() {
  clearOverlayList(probeOverlays);
  clearOverlayList(railOverlays);
  clearOverlayList(componentOverlays);
  clearOverlayList(psuTargetOverlays);
  clearOverlayList(pickedPadOverlays);
  safeDestroyViewer();

  currentBoard = null;
  currentBoardRuntime = null;
  currentSelection = null;
  psuTargetRail = null;
  probeMode = true;
  padPickerEnabled = false;
  pickedPads = [];
  pickedPadCounter = 0;
  latestPadPoint = null;
  latestPickedPadId = null;

  clearCache();

  const railSelect = document.querySelector("#rail-select");
  if (railSelect) railSelect.innerHTML = '<option value="">-- Select Rail --</option>';
}

function formatPadId(counter) {
  return `PAD_${String(counter).padStart(3, "0")}`;
}

function createPickedPadOverlayElement(pad, isLatest) {
  const element = document.createElement("div");
  element.style.width = `${PAD_MARKER_DIAMETER_IMAGE_PX}px`;
  element.style.height = `${PAD_MARKER_DIAMETER_IMAGE_PX}px`;
  element.style.borderRadius = "50%";
  element.style.border = isLatest ? "2px solid #ffffff" : "1px solid #ffffff";
  element.style.background = isLatest ? "rgba(0, 224, 255, 0.95)" : "rgba(255, 99, 132, 0.95)";
  element.style.boxShadow = isLatest
    ? "0 0 10px rgba(0, 224, 255, 0.9)"
    : "0 0 6px rgba(255, 99, 132, 0.75)";
  element.style.pointerEvents = "none";
  element.title = `${pad.id} @ (${pad.x}, ${pad.y})`;
  return element;
}

function redrawPickedPadOverlays() {
  clearOverlayList(pickedPadOverlays);
  if (!viewerInstance || !currentBoardRuntime || !pickedPads.length) return;

  const { imgW, imgH, sx, sy } = currentBoardRuntime.spaces;

  pickedPads.forEach((pad) => {
    const xi = pad.x * sx;
    const yi = pad.y * sy;
    const markerRadiusX = Math.max(1, pad.radius * sx);
    const markerRadiusY = Math.max(1, pad.radius * sy);

    const rect = new OpenSeadragon.Rect(
      (xi - markerRadiusX) / imgW,
      (yi - markerRadiusY) / imgH,
      (markerRadiusX * 2) / imgW,
      (markerRadiusY * 2) / imgH
    );

    const element = createPickedPadOverlayElement(pad, pad.id === latestPickedPadId);
    viewerInstance.addOverlay({ element, location: rect });
    pickedPadOverlays.push({ element, padId: pad.id });
  });
}

function createPadAtPoint(point, { radius = 6 } = {}) {
  pickedPadCounter += 1;
  const pad = {
    id: formatPadId(pickedPadCounter),
    x: Math.round(point.board.x),
    y: Math.round(point.board.y),
    radius,
    label: null,
    railId: null,
    node: null,
    componentId: null,
    pinId: null,
  };
  pickedPads.push(pad);
  latestPickedPadId = pad.id;
  latestPadPoint = {
    board: { ...point.board },
    image: { ...point.image },
    screen: { ...point.screen },
  };
  redrawPickedPadOverlays();
  return pad;
}

function ensurePadPickerRuntime(actionName) {
  if (!viewerInstance || !currentBoardRuntime) {
    console.warn(`[pcb] ${actionName} requires a loaded board/runtime.`);
    return false;
  }
  return true;
}

export function enablePadPicker() {
  if (!ensurePadPickerRuntime("enablePadPicker")) return false;
  padPickerEnabled = true;
  const mountPoint = document.querySelector("#motherboardMap");
  if (mountPoint) setStatus(mountPoint, "Pad picker enabled. Click motherboard to add pads.");
  redrawPickedPadOverlays();
  console.info("[pcb] Pad picker enabled");
  return true;
}

export function disablePadPicker() {
  padPickerEnabled = false;
  const mountPoint = document.querySelector("#motherboardMap");
  if (mountPoint) {
    setStatus(
      mountPoint,
      probeMode
        ? "Pad picker disabled. Probe mode active."
        : "Pad picker disabled. Navigate mode active."
    );
  }
  console.info("[pcb] Pad picker disabled");
  return true;
}

export function listPickedPads() {
  return pickedPads.map((pad) => ({ ...pad }));
}

export function clearPickedPads() {
  pickedPads = [];
  pickedPadCounter = 0;
  latestPickedPadId = null;
  latestPadPoint = null;
  redrawPickedPadOverlays();
  console.info("[pcb] Cleared picked pads");
  return [];
}

export function removeLastPickedPad() {
  if (!pickedPads.length) return null;
  const removed = pickedPads.pop() || null;
  latestPickedPadId = pickedPads.length ? pickedPads[pickedPads.length - 1].id : null;
  redrawPickedPadOverlays();
  console.info("[pcb] Removed picked pad", removed?.id || "");
  return removed ? { ...removed } : null;
}

export function exportPickedPads() {
  const payload = {
    boardId: currentBoard?.id || currentBoardRuntime?.board?.id || null,
    pads: listPickedPads(),
  };
  return payload;
}

export function exportPickedPadsJson() {
  return JSON.stringify(exportPickedPads(), null, 2);
}

export function dumpViewerRuntime() {
  return {
    boardId: currentBoard?.id || null,
    padPickerEnabled,
    pickedPadCount: pickedPads.length,
    latestPadPoint,
    probeMode,
    selection: currentSelection,
  };
}

function createRectOverlay({ border, background, boxShadow = "none" }) {
  const el = document.createElement("div");
  el.style.position = "absolute";
  el.style.border = border;
  el.style.background = background;
  el.style.boxShadow = boxShadow;
  el.style.pointerEvents = "none";
  return el;
}

function addBoxOverlay(list, box, styles = {}) {
  if (!viewerInstance || !box) return;
  const { imgW, imgH, sx, sy } = getSpaces();
  const minXi = box.minX * sx;
  const minYi = box.minY * sy;
  const maxXi = box.maxX * sx;
  const maxYi = box.maxY * sy;
  const rect = new OpenSeadragon.Rect(
    minXi / imgW,
    minYi / imgH,
    Math.max(1, maxXi - minXi) / imgW,
    Math.max(1, maxYi - minYi) / imgH
  );
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

export function drawProbePoints(viewer, boardRuntime) {
  clearOverlayList(probeOverlays);
  if (!viewer || !boardRuntime) return;

  const { imgW, imgH, sx, sy } = boardRuntime.spaces;
  const markerImgPx = 14;

  boardRuntime.probes.forEach((probe) => {
    const element = document.createElement("button");
    element.type = "button";
    element.style.width = `${markerImgPx}px`;
    element.style.height = `${markerImgPx}px`;
    element.style.background = "#ff4444";
    element.style.border = "2px solid white";
    element.style.borderRadius = "50%";
    element.style.cursor = currentProbeCursor();
    element.style.boxShadow = "0 0 4px rgba(0,0,0,0.5)";
    element.style.pointerEvents = "auto";
    element.style.padding = "0";
    element.title = probe.label || probe.id;
    element.dataset.probeId = probe.id;

    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const pick = {
        type: "probe",
        id: probe.id,
        probeId: probe.id,
        railId: probe.railId,
        label: probe.label,
        raw: probe,
      };
      dispatchSelection(pick, { source: "probe-overlay" });
    });

    const xi = probe.x * sx;
    const yi = probe.y * sy;
    const rect = new OpenSeadragon.Rect(
      (xi - markerImgPx / 2) / imgW,
      (yi - markerImgPx / 2) / imgH,
      markerImgPx / imgW,
      markerImgPx / imgH
    );

    viewer.addOverlay({ element, location: rect });
    probeOverlays.push({ element, probeId: probe.id, railId: probe.railId });
  });
}

export function toggleProbeMode(viewer, boardRuntime) {
  probeMode = !probeMode;
  if (probeMode) drawProbePoints(viewer, boardRuntime);
  else clearOverlayList(probeOverlays);
  if (currentSelection?.target?.type === "probe") {
    setProbeVisualState(currentSelection.target.probeId);
  }
  const mountPoint = document.querySelector("#motherboardMap");
  applyViewerInteractionMode(viewer, mountPoint);
  return probeMode;
}

function setProbeModeState(viewer, boardRuntime, nextProbeMode) {
  probeMode = Boolean(nextProbeMode);
  if (probeMode) drawProbePoints(viewer, boardRuntime);
  else clearOverlayList(probeOverlays);
  if (currentSelection?.target?.type === "probe") {
    setProbeVisualState(currentSelection.target.probeId);
  }
  const mountPoint = document.querySelector("#motherboardMap");
  applyViewerInteractionMode(viewer, mountPoint);
  return probeMode;
}

function setStatus(mountPoint, message) {
  const element = mountPoint?.querySelector("#pcb-status");
  if (element) element.textContent = message;
}

function applySelectionVisuals(pick) {
  clearOverlayList(railOverlays);
  clearOverlayList(componentOverlays);
  setProbeVisualState(null);

  if (!pick) return;
  if (pick.type === "probe") {
    setProbeVisualState(pick.probeId);
    const rail = currentBoardRuntime?.railsById?.[pick.railId];
    if (rail) drawRailOverlay(rail);
    return;
  }
  if (pick.type === "component") {
    const component = currentBoardRuntime?.componentsById?.[pick.componentId];
    if (component) drawComponentOverlay(component);
    return;
  }
  if (pick.type === "rail") {
    const rail = currentBoardRuntime?.railsById?.[pick.railId];
    if (rail) drawRailOverlay(rail);
  }
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

  if (padPickerEnabled) {
    const point = screenToBoardPoint(viewerInstance, currentBoardRuntime, event.position);
    if (!point) {
      console.warn("[pcb] Could not resolve click point for pad picker.");
      return;
    }

    const pad = createPadAtPoint(point, { radius: 6 });
    const mountPoint = document.querySelector("#motherboardMap");
    if (mountPoint) {
      setStatus(mountPoint, `Picked ${pad.id} @ (${pad.x}, ${pad.y})`);
    }
    console.info("[pcb] Pad picked", pad);
    event.preventDefaultAction = true;
    return;
  }

  if (!probeMode) return;
  const picked = pickAtScreenPoint(viewerInstance, currentBoardRuntime, event.position);
  if (!picked) {
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

  const mountStyle = window.getComputedStyle(mountPoint);
  if (mountStyle.position === "static") mountPoint.style.position = "relative";
  mountPoint.style.overflow = "hidden";
  if (!mountPoint.style.minHeight) mountPoint.style.minHeight = "400px";

  mountPoint.innerHTML = `
    <div id="pcb-viewer-ui"
      style="
        position:absolute; top:15px; left:15px; z-index:20000;
        background:rgba(30,30,30,0.9);
        padding:10px; border-radius:6px;
        display:flex; gap:10px; border:1px solid #444;
        align-items:center;
        pointer-events:auto;
      ">
      <select id="board-select"
        style="background:#333; color:white; border:1px solid #555; padding:5px; pointer-events:auto;"></select>
      <button id="btn-load-pcb"
        style="background:#007acc; color:white; border:none; padding:5px 15px; cursor:pointer; border-radius:4px; pointer-events:auto;">
        LOAD
      </button>
      <select id="rail-select"
        style="background:#333; color:white; border:1px solid #555; padding:5px; pointer-events:auto;">
        <option value="">-- Select Rail --</option>
      </select>
      <div style="display:flex; gap:6px; pointer-events:auto;">
        <button id="btn-probe"
          style="background:#1e7e34; color:white; border:none; padding:5px 12px; cursor:pointer; border-radius:4px; pointer-events:auto;">
          PROBE MODE
        </button>
        <button id="btn-nav"
          style="background:#495057; color:white; border:none; padding:5px 12px; cursor:pointer; border-radius:4px; pointer-events:auto;">
          NAV MODE
        </button>
      </div>
      <div style="display:flex; gap:6px; pointer-events:auto;">
        <button id="btn-zoom-in"
          style="background:#343a40; color:white; border:none; padding:5px 10px; cursor:pointer; border-radius:4px; pointer-events:auto; font-weight:700;">
          +
        </button>
        <button id="btn-zoom-out"
          style="background:#343a40; color:white; border:none; padding:5px 10px; cursor:pointer; border-radius:4px; pointer-events:auto; font-weight:700;">
          -
        </button>
        <button id="btn-home"
          style="background:#343a40; color:white; border:none; padding:5px 10px; cursor:pointer; border-radius:4px; pointer-events:auto;">
          HOME
        </button>
      </div>
      <span id="pcb-status" style="color:#bbb; font-size:12px; margin-left:6px;">
        Loading boards...
      </span>
    </div>
    <div id="pcb-canvas-target" style="width:100%; height:100%; position:relative; z-index:1;"></div>
  `;

  const uiLayer = mountPoint.querySelector("#pcb-viewer-ui");
  const select = mountPoint.querySelector("#board-select");
  const railSelect = mountPoint.querySelector("#rail-select");
  const loadBtn = mountPoint.querySelector("#btn-load-pcb");
  const probeBtn = mountPoint.querySelector("#btn-probe");
  const navBtn = mountPoint.querySelector("#btn-nav");
  const zoomInBtn = mountPoint.querySelector("#btn-zoom-in");
  const zoomOutBtn = mountPoint.querySelector("#btn-zoom-out");
  const homeBtn = mountPoint.querySelector("#btn-home");
  const canvasTarget = mountPoint.querySelector("#pcb-canvas-target");

  if (uiLayer) {
    const stopViewerInput = (event) => event.stopPropagation();
    [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "click",
      "dblclick",
      "wheel",
      "touchstart",
      "touchmove",
      "touchend",
    ].forEach((name) => uiLayer.addEventListener(name, stopViewerInput));
  }

  railSelect.addEventListener("change", () => {
    if (railSelect.value) onRailSelected(railSelect.value);
  });

  canvasTarget.style.width = "100%";
  canvasTarget.style.height = "100%";

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

  function syncModeButtons() {
    if (probeBtn) {
      probeBtn.style.background = probeMode ? "#1e7e34" : "#495057";
      probeBtn.style.boxShadow = probeMode ? "0 0 0 1px rgba(30,126,52,0.35)" : "none";
    }
    if (navBtn) {
      navBtn.style.background = probeMode ? "#495057" : "#0d6efd";
      navBtn.style.boxShadow = probeMode ? "none" : "0 0 0 1px rgba(13,110,253,0.35)";
    }
    [zoomInBtn, zoomOutBtn, homeBtn].forEach((button) => {
      if (!button) return;
      button.disabled = probeMode;
      button.style.opacity = probeMode ? "0.45" : "1";
      button.style.cursor = probeMode ? "not-allowed" : "pointer";
    });
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
      select.innerHTML = boards.map((board) => `<option value="${board.id}">${board.name || board.id}</option>`).join("");
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
      const boardData = await loadBoardData(boardId);
      safeDestroyViewer();

      viewerInstance = await createDeepZoomViewer({
        el: canvasTarget,
        board: boardData,
        getTileUrl: (level, x, y) => getTileUrl(boardData, level, x, y),
      });

      const [components, railFile, topology, thermal] = await Promise.all([
        loadComponents(boardId),
        loadRailsFile(boardId),
        loadTopology(boardId),
        loadThermal(boardId),
      ]);

      const rails = Array.isArray(railFile?.rails) ? railFile.rails : [];
      currentBoard = { ...boardData, components, rails, topology, thermal, railFile };
      currentBoardRuntime = buildBoardRuntime({
        board: boardData,
        rails,
        components,
        topology,
        thermal,
        railFile,
      });
      currentSelection = null;
      redrawPickedPadOverlays();

      viewerInstance.addHandler("canvas-click", handleCanvasClick);

      railSelect.innerHTML = '<option value="">-- Select Rail --</option>'
        + currentBoardRuntime.rails.map((rail) => `<option value="${rail.id}">${rail.label || rail.id}</option>`).join("");

      setProbeModeState(viewerInstance, currentBoardRuntime, true);
      syncModeButtons();
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
    isPadPickerEnabled: () => padPickerEnabled,
    enablePadPicker,
    disablePadPicker,
    listPickedPads,
    clearPickedPads,
    removeLastPickedPad,
    exportPickedPads,
    exportPickedPadsJson,
    dumpViewerRuntime,
    setProbePolarity,
    debugPick,
  };
}
