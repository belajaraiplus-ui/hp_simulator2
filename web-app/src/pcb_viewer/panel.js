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
import {
  AUTHORING_TOOLS,
  getAuthoringState,
  resetAuthoringState,
  setAuthoringMode,
  setAuthoringSelection,
  setAuthoringTool,
} from "./authoring_state.js";

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
let padPickerEnabled = false;
let pickedPads = [];
let pickedPadOverlays = [];
let pickedPadCounter = 0;
let latestPadPoint = null;
let latestPickedPadId = null;
const PAD_MARKER_DIAMETER_IMAGE_PX = 12;
const PIN_EDITOR_DEFAULT_RADIUS = 6;
const PIN_EDITOR_MARKER_DIAMETER_IMAGE_PX = 14;
const PIN_TYPE_VALUES = new Set(["resistor", "capacitor", "diode", "mosfet", "ic", "fuse", "inductor", "jumper", "test_point", "passive", "signal", "power", "ground"]);
const PIN_ROLE_VALUES = new Set(["ground", "signal", "power", "passive", "test_point", "anode", "cathode", "gate", "drain", "source", "input", "output", "pin1", "pin2"]);

let pinEditorState = {
  componentId: null,
  pins: [],
  selectedPinId: null,
  isEditing: false,
  relocateOnNextClick: false,
};
let pinEditorOverlays = [];
let placedProbeTargets = {
  positive: null,
  negative: null,
};

const AUTHORING_TOOL_BUTTONS = [
  { id: AUTHORING_TOOLS.SELECT, label: "Select", enabled: true },
  { id: AUTHORING_TOOLS.ADD_PIN, label: "Add Pin", enabled: true },
  { id: AUTHORING_TOOLS.EDIT_PIN, label: "Edit Pin", enabled: false },
  { id: AUTHORING_TOOLS.COMPONENT, label: "Component", enabled: false },
  { id: AUTHORING_TOOLS.VALIDATE, label: "Validate", enabled: false },
  { id: AUTHORING_TOOLS.EXPORT, label: "Export", enabled: false },
];

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
    const idleBackground = probe.isGround ? "#05070a" : "#ff4444";
    const idleBorder = probe.isGround ? "2px solid #f8fafc" : "2px solid white";
    probe.element.style.background = active ? "#ffe066" : idleBackground;
    probe.element.style.border = active ? "2px solid #fff4bf" : idleBorder;
    probe.element.style.color = probe.isGround ? "#f8fafc" : "transparent";
    probe.element.style.transform = active ? "scale(1.25)" : "scale(1)";
    probe.element.style.boxShadow = active
      ? "0 0 8px rgba(255, 224, 102, 0.9)"
      : (probe.isGround
        ? "0 0 0 1px rgba(248, 250, 252, 0.35), 0 0 8px rgba(15, 23, 42, 0.75)"
        : "0 0 4px rgba(0,0,0,0.5)");
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
  clearOverlayList(placedProbeOverlays);
  clearOverlayList(railOverlays);
  clearOverlayList(componentOverlays);
  clearOverlayList(psuTargetOverlays);
  clearOverlayList(pickedPadOverlays);
  clearOverlayList(pinEditorOverlays);
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
  pinEditorState = {
    componentId: null,
    pins: [],
    selectedPinId: null,
    isEditing: false,
    relocateOnNextClick: false,
  };
  placedProbeTargets = {
    positive: null,
    negative: null,
  };
  resetAuthoringState();
  refreshAuthoringReadoutUi();

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


function normalizePinContact(pin = {}, fallbackId = "") {
  const x = Number(pin?.x ?? pin?.cx ?? pin?.px);
  const y = Number(pin?.y ?? pin?.cy ?? pin?.py);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const id = String(pin?.id || fallbackId || "").trim();
  return {
    id: id || fallbackId,
    name: pin?.name ?? pin?.label ?? null,
    x: Math.round(x),
    y: Math.round(y),
    radius: Number.isFinite(Number(pin?.radius)) && Number(pin.radius) > 0 ? Number(pin.radius) : PIN_EDITOR_DEFAULT_RADIUS,
    node: pin?.node ?? null,
    railId: pin?.railId ?? pin?.rail ?? null,
    pinType: pin?.pinType ?? pin?.kind ?? null,
    pinRole: pin?.pinRole ?? null,
    isGround: Boolean(pin?.isGround),
    isTestPoint: Boolean(pin?.isTestPoint),
    componentId: pin?.componentId ?? null,
    authoringSource: pin?.authoringSource || "asset-import",
  };
}

function inferPinDefaultsFromComponent(component, sequence = 1) {
  const kind = String(component?.kind || "").toLowerCase();
  const oneBased = Math.max(1, sequence);
  if (kind.includes("res") || kind === "resistor") return { id: String(oneBased), name: String(oneBased), pinType: "resistor", pinRole: "passive" };
  if (kind.includes("cap") || kind === "capacitor") return { id: String(oneBased), name: String(oneBased), pinType: "capacitor", pinRole: "passive" };
  if (kind.includes("diode") || kind === "di") {
    return oneBased === 1
      ? { id: "A", name: "A", pinType: "diode", pinRole: "anode" }
      : { id: "K", name: "K", pinType: "diode", pinRole: "cathode" };
  }
  if (kind.includes("mosfet") || kind === "fet") {
    const map = [
      { id: "G", name: "G", pinRole: "gate" },
      { id: "D", name: "D", pinRole: "drain" },
      { id: "S", name: "S", pinRole: "source" },
    ];
    const selected = map[(oneBased - 1) % map.length];
    return { ...selected, pinType: "mosfet" };
  }
  if (kind.includes("ic")) return { id: String(oneBased), name: String(oneBased), pinType: "ic", pinRole: "signal" };
  return { id: `PIN_${String(oneBased).padStart(3, "0")}`, name: `PIN_${String(oneBased).padStart(3, "0")}`, pinType: null, pinRole: null };
}

function inferPinRailId(pin) {
  if (!pin || !currentBoardRuntime?.rails || !currentBoardRuntime.rails.length) return null;
  const candidates = currentBoardRuntime.rails.filter((rail) => rail?.overlayBox
    && pin.x >= rail.overlayBox.minX && pin.x <= rail.overlayBox.maxX
    && pin.y >= rail.overlayBox.minY && pin.y <= rail.overlayBox.maxY);
  if (candidates.length) return candidates[0].id;

  const nearest = currentBoardRuntime.rails
    .filter((rail) => rail?.overlayBox)
    .map((rail) => {
      const cx = (rail.overlayBox.minX + rail.overlayBox.maxX) / 2;
      const cy = (rail.overlayBox.minY + rail.overlayBox.maxY) / 2;
      const dx = pin.x - cx;
      const dy = pin.y - cy;
      return { id: rail.id, distance: dx * dx + dy * dy };
    })
    .sort((a, b) => a.distance - b.distance)[0];
  return nearest?.id || null;
}

function nextGeneratedPinId() {
  const used = new Set(pinEditorState.pins.map((pin) => String(pin.id || "").trim()));
  for (let i = 1; i <= 9999; i += 1) {
    const candidate = `PIN_${String(i).padStart(3, "0")}`;
    if (!used.has(candidate)) return candidate;
  }
  return `PIN_${Date.now()}`;
}

function syncRuntimeComponentPins() {
  if (!currentBoardRuntime || !pinEditorState.componentId) return;
  const runtimeComponent = currentBoardRuntime.componentsById?.[pinEditorState.componentId];
  if (!runtimeComponent) return;
  runtimeComponent.pins = pinEditorState.pins.map((pin) => ({
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
    componentId: pin.componentId ?? pinEditorState.componentId ?? null,
    authoringSource: pin.authoringSource || "manual-click",
  }));
  runtimeComponent.raw = runtimeComponent.raw || {};
  runtimeComponent.raw.pins = runtimeComponent.pins.map((pin) => ({ ...pin }));
}

function createPinEditorOverlayElement(pin, selected = false) {
  const element = document.createElement("button");
  element.type = "button";
  element.style.width = `${PIN_EDITOR_MARKER_DIAMETER_IMAGE_PX}px`;
  element.style.height = `${PIN_EDITOR_MARKER_DIAMETER_IMAGE_PX}px`;
  element.style.borderRadius = "50%";
  element.style.border = selected ? "2px solid #fff7d6" : "1px solid #ffffff";
  const isManual = pin.authoringSource === "manual-click";
  element.style.background = selected
    ? "rgba(255, 184, 0, 0.96)"
    : (isManual ? "rgba(26, 174, 255, 0.9)" : "rgba(111, 255, 163, 0.85)");
  element.style.boxShadow = selected
    ? "0 0 12px rgba(255, 184, 0, 0.95)"
    : "0 0 7px rgba(26, 174, 255, 0.8)";
  element.style.pointerEvents = "none";
  element.style.padding = "0";
  element.title = `${pin.id}${pin.name ? ` (${pin.name})` : ""} @ (${pin.x}, ${pin.y}) [${pin.authoringSource || "unknown"}]`;
  return element;
}

function redrawPinEditorOverlays() {
  clearOverlayList(pinEditorOverlays);
  if (!viewerInstance || !currentBoardRuntime || !pinEditorState.isEditing) return;

  const { imgW, imgH, sx, sy } = currentBoardRuntime.spaces;
  pinEditorState.pins.forEach((pin) => {
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
    const selected = pin.id === pinEditorState.selectedPinId;
    const element = createPinEditorOverlayElement(pin, selected);
    viewerInstance.addOverlay({ element, location: rect });
    pinEditorOverlays.push({ element, pinId: pin.id });
  });
}

function clonePinEditorState() {
  return {
    componentId: pinEditorState.componentId,
    selectedPinId: pinEditorState.selectedPinId,
    isEditing: pinEditorState.isEditing,
    relocateOnNextClick: pinEditorState.relocateOnNextClick,
    pins: pinEditorState.pins.map((pin) => ({ ...pin })),
  };
}

function setPinEditorComponent(componentId) {
  const runtimeComponent = currentBoardRuntime?.componentsById?.[componentId];
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

  pinEditorState.componentId = runtimeComponent.id;
  pinEditorState.pins = pins;
  pinEditorState.selectedPinId = pins[0]?.id || null;
  pinEditorState.relocateOnNextClick = false;
  redrawPinEditorOverlays();
  return clonePinEditorState();
}

function pickEditorPinAtPoint(boardPoint) {
  const hitRadius = Math.max(8 / (currentBoardRuntime?.spaces?.sx || 1), 8 / (currentBoardRuntime?.spaces?.sy || 1), 6);
  const hitSq = hitRadius * hitRadius;
  const winner = pinEditorState.pins
    .map((pin) => {
      const dx = boardPoint.x - pin.x;
      const dy = boardPoint.y - pin.y;
      return { pin, distance: dx * dx + dy * dy };
    })
    .filter((entry) => entry.distance <= hitSq)
    .sort((a, b) => a.distance - b.distance)[0];
  return winner?.pin || null;
}

function addEditorPinAtPoint(boardPoint) {
  const selectedComponent = getSelectedRuntimeComponent() || currentBoardRuntime?.componentsById?.[currentSelection?.pick?.componentId] || null;
  const sequence = pinEditorState.pins.filter((pin) => pin.authoringSource === "manual-click").length + 1;
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
    componentId: pinEditorState.componentId || selectedComponent?.id || null,
    authoringSource: "manual-click",
  };
  pin.railId = inferPinRailId(pin);
  if (String(pin.railId || "").toUpperCase().includes("GND")) {
    pin.pinRole = "ground";
    pin.isGround = true;
  }
  if (String(pin.componentId || "").toUpperCase().startsWith("TP")) {
    pin.pinType = pin.pinType || "test_point";
    pin.pinRole = pin.pinRole || "test_point";
    pin.isTestPoint = true;
  }
  pinEditorState.pins.push(pin);
  pinEditorState.selectedPinId = pin.id;
  syncRuntimeComponentPins();
  redrawPinEditorOverlays();
  return { ...pin };
}

function getSelectedRuntimeComponent() {
  if (!pinEditorState.componentId) return null;
  return currentBoardRuntime?.componentsById?.[pinEditorState.componentId] || null;
}


function refreshAuthoringReadoutUi() {
  const state = getAuthoringState();
  const selectedComponentEl = document.querySelector("#authoring-selected-component");
  const createdPinCountEl = document.querySelector("#authoring-created-pin-count");
  if (selectedComponentEl) selectedComponentEl.textContent = state.selectedComponentId || "(none)";
  if (createdPinCountEl) createdPinCountEl.textContent = String(listCreatedPins().length);
}

function isAuthoringAddPinActive() {
  const state = getAuthoringState();
  return Boolean(state.enabled && state.activeTool === AUTHORING_TOOLS.ADD_PIN);
}

export function editComponentPins(componentId = null) {
  if (!currentBoardRuntime) {
    console.warn("[pcb] editComponentPins requires a loaded board.");
    return null;
  }

  const targetId = componentId
    || currentSelection?.pick?.componentId
    || currentSelection?.target?.componentId
    || null;

  if (!targetId) {
    console.warn("[pcb] No component selected. Pick a component first or pass componentId.");
    return null;
  }

  if (!setPinEditorComponent(targetId)) return null;
  pinEditorState.isEditing = true;
  redrawPinEditorOverlays();
  console.info(`[pcb] Pin editor enabled for component ${targetId}`);
  return clonePinEditorState();
}

export function enableComponentPinEditor() {
  if (!currentBoardRuntime) {
    console.warn("[pcb] enableComponentPinEditor requires a loaded board.");
    return false;
  }
  if (!pinEditorState.componentId) {
    const selectedComponentId = currentSelection?.pick?.componentId || currentSelection?.target?.componentId || null;
    if (selectedComponentId) {
      setPinEditorComponent(selectedComponentId);
    }
  }
  if (!pinEditorState.componentId) console.warn("[pcb] No component selected for pin editor. Manual loose pin authoring enabled.");
  pinEditorState.isEditing = true;
  redrawPinEditorOverlays();
  return true;
}

export function disableComponentPinEditor() {
  pinEditorState.isEditing = false;
  pinEditorState.relocateOnNextClick = false;
  redrawPinEditorOverlays();
  return true;
}

export function listComponentPins() {
  return pinEditorState.pins.map((pin) => ({ ...pin }));
}

export function listCreatedPins() {
  return listComponentPins().filter((pin) => pin.authoringSource === "manual-click");
}

export function removeLastCreatedPin() {
  const createdPins = listCreatedPins();
  const lastCreated = createdPins[createdPins.length - 1];
  if (!lastCreated) return null;
  const previousSelected = pinEditorState.selectedPinId;
  pinEditorState.selectedPinId = lastCreated.id;
  const removed = deleteSelectedPin();
  if (!removed) pinEditorState.selectedPinId = previousSelected;
  refreshAuthoringReadoutUi();
  return removed;
}

export function clearCreatedPins() {
  const removed = [];
  let current = removeLastCreatedPin();
  while (current) {
    removed.push(current);
    current = removeLastCreatedPin();
  }
  redrawPinEditorOverlays();
  refreshAuthoringReadoutUi();
  return removed;
}

export function selectPin(pinId) {
  const wanted = String(pinId || "");
  const pin = pinEditorState.pins.find((entry) => String(entry.id) === wanted);
  if (!pin) return null;
  pinEditorState.selectedPinId = pin.id;
  redrawPinEditorOverlays();
  return { ...pin };
}

function updatePin(pinId, patch = {}) {
  const wanted = String(pinId || pinEditorState.selectedPinId || "");
  if (!wanted) return null;
  const idx = pinEditorState.pins.findIndex((entry) => String(entry.id) === wanted);
  if (idx < 0) return null;
  const current = pinEditorState.pins[idx];
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
  pinEditorState.pins[idx] = next;
  if (pinEditorState.selectedPinId === wanted) pinEditorState.selectedPinId = next.id;
  syncRuntimeComponentPins();
  redrawPinEditorOverlays();
  return { ...next };
}

export function renamePin(pinId, newId) {
  return updatePin(pinId, { id: newId });
}

export function setPinName(pinId, name) {
  return updatePin(pinId, { name: name == null ? null : String(name) });
}

export function setPinNode(pinId, node) {
  return updatePin(pinId, { node: node == null ? null : String(node) });
}

export function setPinType(pinId, type) {
  if (type != null && !PIN_TYPE_VALUES.has(String(type))) console.warn(`[pcb] Unknown pinType: ${type}`);
  return updatePin(pinId, { pinType: type == null ? null : String(type) });
}

export function setPinRole(pinId, role) {
  if (role != null && !PIN_ROLE_VALUES.has(String(role))) console.warn(`[pcb] Unknown pinRole: ${role}`);
  return updatePin(pinId, { pinRole: role == null ? null : String(role) });
}

export function setPinGround(pinId, value) {
  const isGround = Boolean(value);
  const patch = { isGround };
  if (isGround) patch.pinRole = "ground";
  return updatePin(pinId, patch);
}

export function setPinTestPoint(pinId, value) {
  const isTestPoint = Boolean(value);
  const patch = { isTestPoint };
  if (isTestPoint) {
    patch.pinRole = "test_point";
    patch.pinType = "test_point";
  }
  return updatePin(pinId, patch);
}

export function setPinRail(pinId, railId) {
  return updatePin(pinId, { railId: railId == null ? null : String(railId) });
}

export function setPinRadius(pinId, radius) {
  return updatePin(pinId, { radius });
}

export function moveSelectedPinTo(x, y) {
  return updatePin(pinEditorState.selectedPinId, { x, y });
}

export function moveSelectedPinOnNextClick() {
  if (!pinEditorState.selectedPinId) return false;
  pinEditorState.relocateOnNextClick = true;
  return true;
}

export function deleteSelectedPin() {
  if (!pinEditorState.selectedPinId) return null;
  const idx = pinEditorState.pins.findIndex((pin) => pin.id === pinEditorState.selectedPinId);
  if (idx < 0) return null;
  const [removed] = pinEditorState.pins.splice(idx, 1);
  pinEditorState.selectedPinId = pinEditorState.pins[idx]?.id || pinEditorState.pins[idx - 1]?.id || null;
  syncRuntimeComponentPins();
  redrawPinEditorOverlays();
  return removed ? { ...removed } : null;
}

export function exportEditedComponentPins() {
  const component = getSelectedRuntimeComponent();
  if (!component) return null;
  const payload = {
    id: component.id,
    refdes: component.refdes,
    kind: component.kind,
    bbox: component.raw?.bbox || null,
    pins: listComponentPins(),
  };
  return payload;
}

export function exportCreatedPins() {
  return {
    boardId: currentBoard?.id || currentBoardRuntime?.board?.id || null,
    componentId: pinEditorState.componentId || null,
    pins: listCreatedPins(),
  };
}

export function exportCreatedPinsJson() {
  return JSON.stringify(exportCreatedPins(), null, 2);
}

export function exportSelectedComponentPatch() {
  const componentId = pinEditorState.componentId || currentSelection?.pick?.componentId || null;
  if (!componentId) return null;
  const pins = listCreatedPins().filter((pin) => (pin.componentId || componentId) === componentId);
  return { id: componentId, pins };
}

export function exportEditedComponentPinsJson() {
  const payload = exportEditedComponentPins();
  return payload ? JSON.stringify(payload, null, 2) : "";
}

export function dumpEditedComponent() {
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

export function getSelectedComponentId() {
  return currentSelection?.pick?.componentId || pinEditorState.componentId || null;
}

export function getSelectedComponent() {
  const id = getSelectedComponentId();
  if (!id) return null;
  return currentBoardRuntime?.componentsById?.[id] || null;
}

export function dumpSelectedComponentPins() {
  const id = getSelectedComponentId();
  if (!id) return [];
  return pinEditorState.pins.filter((pin) => (pin.componentId || id) === id).map((pin) => ({ ...pin }));
}

export function dumpSelectedPin() {
  if (!pinEditorState.selectedPinId) return null;
  return pinEditorState.pins.find((pin) => pin.id === pinEditorState.selectedPinId) || null;
}

export function debugPinEditorState() {
  return clonePinEditorState();
}

export function debugPinPlacementState() {
  const authoringState = getAuthoringState();
  return {
    enabled: pinEditorState.isEditing,
    authoringEnabled: authoringState.enabled,
    activeTool: authoringState.activeTool,
    selectedAuthoringComponentId: authoringState.selectedComponentId,
    selectedPinId: pinEditorState.selectedPinId,
    targetComponentId: pinEditorState.componentId,
    createdPins: listCreatedPins().length,
  };
}

export function enablePinPlacementMode() {
  setAuthoringMode(true);
  setAuthoringTool(AUTHORING_TOOLS.ADD_PIN);
  return getAuthoringState();
}

export function disablePinPlacementMode() {
  const nextState = setAuthoringTool(AUTHORING_TOOLS.SELECT);
  disableComponentPinEditor();
  return nextState;
}

export function selectCreatedPin(pinId) {
  return selectPin(pinId);
}

export function dumpViewerRuntime() {
  return {
    boardId: currentBoard?.id || null,
    padPickerEnabled,
    pickedPadCount: pickedPads.length,
    latestPadPoint,
    probeMode,
    selection: currentSelection,
    pinEditor: clonePinEditorState(),
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

function pointForMeasurementTarget(target, boardRuntime) {
  if (!target || !boardRuntime) return null;

  if (target.type === "probe") {
    const probe = boardRuntime.probesById?.[target.probeId || target.id] || null;
    if (probe && Number.isFinite(probe.x) && Number.isFinite(probe.y)) return { x: probe.x, y: probe.y };
  }

  if (target.type === "component-pin") {
    const component = boardRuntime.componentsById?.[target.componentId] || null;
    const contacts = [
      ...(Array.isArray(component?.pins) ? component.pins : []),
      ...(Array.isArray(component?.pads) ? component.pads : []),
    ];
    const contact = contacts.find((entry) => String(entry?.id || "") === String(target.pinId || ""));
    const x = Number(contact?.x ?? contact?.cx ?? contact?.px);
    const y = Number(contact?.y ?? contact?.cy ?? contact?.py);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }

  if (target.type === "component") {
    const component = boardRuntime.componentsById?.[target.componentId] || null;
    const box = component?.bbox || null;
    if (box) return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  }

  if (target.type === "rail") {
    const rail = boardRuntime.railsById?.[target.railId] || null;
    const probe = Array.isArray(rail?.probePoints) ? rail.probePoints[0] : null;
    if (probe && Number.isFinite(probe.x) && Number.isFinite(probe.y)) return { x: probe.x, y: probe.y };
    const box = rail?.overlayBox || null;
    if (box) return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  }

  if (target.type === "node" && target.railId) {
    return pointForMeasurementTarget({ type: "rail", railId: target.railId }, boardRuntime);
  }

  return null;
}

function drawPlacedProbeTargets() {
  clearOverlayList(placedProbeOverlays);
  if (!viewerInstance || !currentBoardRuntime) return;

  const { imgW, imgH, sx, sy } = currentBoardRuntime.spaces;
  const entries = [
    { key: "positive", label: "RED", fill: "#ff4d4f", glow: "rgba(255, 77, 79, 0.42)" },
    { key: "negative", label: "BLACK", fill: "#0f172a", glow: "rgba(148, 163, 184, 0.34)" },
  ];

  entries.forEach((entry) => {
    const target = placedProbeTargets[entry.key];
    const point = pointForMeasurementTarget(target, currentBoardRuntime);
    if (!point) return;

    const element = document.createElement("div");
    element.style.width = "46px";
    element.style.height = "46px";
    element.style.borderRadius = "50%";
    element.style.border = "2px solid rgba(255,255,255,0.94)";
    element.style.background = entry.fill;
    element.style.color = "#f8fafc";
    element.style.fontSize = "9px";
    element.style.fontWeight = "800";
    element.style.letterSpacing = "0.08em";
    element.style.display = "flex";
    element.style.alignItems = "center";
    element.style.justifyContent = "center";
    element.style.boxShadow = `0 0 0 3px ${entry.glow}, 0 0 14px ${entry.glow}`;
    element.style.pointerEvents = "none";
    element.textContent = entry.label;
    element.title = target?.label || entry.label;

    const markerImgPx = 46;
    const xi = point.x * sx;
    const yi = point.y * sy;
    const rect = new OpenSeadragon.Rect(
      (xi - markerImgPx / 2) / imgW,
      (yi - markerImgPx / 2) / imgH,
      markerImgPx / imgW,
      markerImgPx / imgH
    );

    viewerInstance.addOverlay({ element, location: rect });
    placedProbeOverlays.push({ element });
  });
}

export function drawProbePoints(viewer, boardRuntime) {
  clearOverlayList(probeOverlays);
  if (!viewer || !boardRuntime) return;

  const { imgW, imgH, sx, sy } = boardRuntime.spaces;
  const markerImgPx = 14;

  boardRuntime.probes.forEach((probe) => {
    const isGround = String(probe.railId || "").toUpperCase().includes("GND")
      || String(probe.label || "").toUpperCase().includes("GND");
    const overlaySize = isGround ? 22 : markerImgPx;
    const element = document.createElement("button");
    element.type = "button";
    element.style.width = `${overlaySize}px`;
    element.style.height = `${overlaySize}px`;
    element.style.background = isGround ? "#05070a" : "#ff4444";
    element.style.border = isGround ? "2px solid #f8fafc" : "2px solid white";
    element.style.borderRadius = "50%";
    element.style.cursor = currentProbeCursor();
    element.style.boxShadow = isGround
      ? "0 0 0 1px rgba(248, 250, 252, 0.35), 0 0 8px rgba(15, 23, 42, 0.75)"
      : "0 0 4px rgba(0,0,0,0.5)";
    element.style.pointerEvents = "auto";
    element.style.padding = "0";
    element.style.color = isGround ? "#f8fafc" : "yellow";
    element.style.fontSize = "9px";
    element.style.fontWeight = "800";
    element.style.lineHeight = "1";
    if (isGround) element.textContent = "G";
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
      (xi - overlaySize / 2) / imgW,
      (yi - overlaySize / 2) / imgH,
      overlaySize / imgW,
      overlaySize / imgH
    );

    viewer.addOverlay({ element, location: rect });
    probeOverlays.push({ element, probeId: probe.id, railId: probe.railId, isGround });
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
  applyViewerInteractionMode(viewer, mountPoint);
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
  applyViewerInteractionMode(viewer, mountPoint);
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
    if (pinEditorState.isEditing && pinEditorState.componentId === pick.componentId) {
      redrawPinEditorOverlays();
    }
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

  if (pick.type === "component" || pick.type === "component-pin") {
    setAuthoringSelection({ componentId: pick.componentId, pinId: pick.type === "component-pin" ? pick.pinId : null });
    refreshAuthoringReadoutUi();
    if (isAuthoringAddPinActive()) {
      setPinEditorComponent(pick.componentId);
      pinEditorState.isEditing = true;
      redrawPinEditorOverlays();
    }
  }

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

  const point = screenToBoardPoint(viewerInstance, currentBoardRuntime, event.position);
  const mountPoint = document.querySelector("#motherboardMap");

  if (isAuthoringAddPinActive()) {
    if (!point) {
      console.warn("[pcb] Could not resolve click point for Add Pin tool.");
      return;
    }

    const authoringState = getAuthoringState();
    const targetComponentId = authoringState.selectedComponentId
      || currentSelection?.pick?.componentId
      || pinEditorState.componentId
      || null;

    if (!targetComponentId) {
      if (mountPoint) setStatus(mountPoint, "Add Pin: select a component first, then click the board to place pins.");
      event.preventDefaultAction = true;
      return;
    }

    if (pinEditorState.componentId !== targetComponentId || !pinEditorState.isEditing) {
      setPinEditorComponent(targetComponentId);
      pinEditorState.isEditing = true;
    }

    const created = addEditorPinAtPoint(point.board);
    if (mountPoint && created) {
      const railHint = created.railId ? ` rail=${created.railId}` : "";
      setStatus(mountPoint, `Added pin ${created.id} @ (${created.x}, ${created.y})${railHint}`);
    }
    console.info("[pcb] Created authoring pin", created);
    refreshAuthoringReadoutUi();
    event.preventDefaultAction = true;
    return;
  }

  if (pinEditorState.isEditing) {
    if (!point) {
      console.warn("[pcb] Could not resolve click point for pin editor.");
      return;
    }

    const hitPin = pickEditorPinAtPoint(point.board);

    if (pinEditorState.relocateOnNextClick && pinEditorState.selectedPinId) {
      const moved = moveSelectedPinTo(point.board.x, point.board.y);
      pinEditorState.relocateOnNextClick = false;
      if (mountPoint && moved) {
        setStatus(mountPoint, `Moved pin ${moved.id} to (${moved.x}, ${moved.y})`);
      }
      event.preventDefaultAction = true;
      return;
    }

    if (hitPin) {
      pinEditorState.selectedPinId = hitPin.id;
      redrawPinEditorOverlays();
      if (mountPoint) setStatus(mountPoint, `Selected pin ${hitPin.id}${pinEditorState.componentId ? ` on ${pinEditorState.componentId}` : ""}`);
      event.preventDefaultAction = true;
      return;
    }

    const created = addEditorPinAtPoint(point.board);
    if (mountPoint && created) {
      const railHint = created.railId ? ` rail=${created.railId}` : "";
      setStatus(mountPoint, `Added pin ${created.id} @ (${created.x}, ${created.y})${railHint}`);
    }
    console.info("[pcb] Created authoring pin", created);
    refreshAuthoringReadoutUi();
    event.preventDefaultAction = true;
    return;
  }

  if (padPickerEnabled) {
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
  const toolbarHost = document.querySelector("#pcbViewerToolbar");

  const mountStyle = window.getComputedStyle(mountPoint);
  if (mountStyle.position === "static") mountPoint.style.position = "relative";
  mountPoint.style.overflow = "hidden";
  if (!mountPoint.style.minHeight) mountPoint.style.minHeight = "400px";

  const toolbarMarkup = `
    <div id="pcb-viewer-ui" class="pcb-viewer-ui">
      <div class="pcb-toolbar-cluster pcb-toolbar-cluster-stack pcb-authoring-panel" id="pcb-authoring-panel">
        <div class="pcb-authoring-header">
          <span class="pcb-toolbar-label">Developer Studio</span>
          <span class="pcb-authoring-badge">Authoring</span>
        </div>
        <button id="btn-authoring-toggle" class="pcb-toolbar-btn pcb-toolbar-btn-dev">Authoring Mode: OFF</button>
        <div class="pcb-authoring-active-tool">
          <span class="pcb-toolbar-label">Active Tool</span>
          <span id="authoring-active-tool" class="pcb-authoring-active-tool-value">Select</span>
        </div>
        <div class="pcb-authoring-readout">
          <span class="pcb-toolbar-label">Selected Component</span>
          <span id="authoring-selected-component" class="pcb-authoring-readout-value">(none)</span>
          <span class="pcb-toolbar-label">Created Pins</span>
          <span id="authoring-created-pin-count" class="pcb-authoring-readout-value">0</span>
        </div>
        <div id="authoring-tool-buttons" class="pcb-toolbar-group pcb-toolbar-group-wrap">
          ${AUTHORING_TOOL_BUTTONS.map((tool) => `<button class="pcb-toolbar-btn pcb-toolbar-btn-ghost pcb-authoring-tool-btn${tool.enabled ? "" : " is-placeholder"}" data-authoring-tool="${tool.id}" ${tool.enabled ? "" : "disabled"}>${tool.label}</button>`).join("")}
        </div>
      </div>
      <div class="pcb-toolbar-cluster">
        <label class="pcb-toolbar-field pcb-toolbar-field-wide">
          <span class="pcb-toolbar-label">Board</span>
          <select id="board-select" class="pcb-toolbar-select"></select>
        </label>
        <button id="btn-load-pcb" class="pcb-toolbar-btn pcb-toolbar-btn-primary">
          Load
        </button>
      </div>
      <div class="pcb-toolbar-cluster">
        <label class="pcb-toolbar-field pcb-toolbar-field-wide">
          <span class="pcb-toolbar-label">Rail Focus</span>
          <select id="rail-select" class="pcb-toolbar-select">
            <option value="">-- Select Rail --</option>
          </select>
        </label>
      </div>
      <div class="pcb-toolbar-cluster pcb-toolbar-cluster-stack">
        <span class="pcb-toolbar-label">Interaction</span>
        <div class="pcb-toolbar-group">
          <button id="btn-probe" class="pcb-toolbar-btn pcb-toolbar-btn-mode">
            Probe
          </button>
          <button id="btn-nav" class="pcb-toolbar-btn pcb-toolbar-btn-mode">
            Navigate
          </button>
        </div>
      </div>
      <div class="pcb-toolbar-cluster pcb-toolbar-cluster-stack">
        <span class="pcb-toolbar-label">Viewport</span>
        <div class="pcb-toolbar-group">
          <button id="btn-zoom-in" class="pcb-toolbar-btn pcb-toolbar-btn-ghost pcb-toolbar-btn-icon">
            +
          </button>
          <button id="btn-zoom-out" class="pcb-toolbar-btn pcb-toolbar-btn-ghost pcb-toolbar-btn-icon">
            -
          </button>
          <button id="btn-home" class="pcb-toolbar-btn pcb-toolbar-btn-ghost">
            Home
          </button>
        </div>
      </div>
      <span class="pcb-toolbar-spacer"></span>
      <div class="pcb-toolbar-readout">
        <span class="pcb-toolbar-label">Status</span>
        <span id="pcb-status" class="pcb-toolbar-status">
          Loading boards...
        </span>
      </div>
    </div>
  `;
  const canvasMarkup = '<div id="pcb-canvas-target" class="pcb-canvas-target"></div>';

  if (toolbarHost) {
    toolbarHost.innerHTML = toolbarMarkup;
    mountPoint.innerHTML = canvasMarkup;
  } else {
    mountPoint.innerHTML = `${toolbarMarkup}${canvasMarkup}`;
  }

  const toolbarRoot = toolbarHost || mountPoint;
  const uiLayer = toolbarRoot.querySelector("#pcb-viewer-ui");
  const select = toolbarRoot.querySelector("#board-select");
  const railSelect = toolbarRoot.querySelector("#rail-select");
  const loadBtn = toolbarRoot.querySelector("#btn-load-pcb");
  const probeBtn = toolbarRoot.querySelector("#btn-probe");
  const navBtn = toolbarRoot.querySelector("#btn-nav");
  const zoomInBtn = toolbarRoot.querySelector("#btn-zoom-in");
  const zoomOutBtn = toolbarRoot.querySelector("#btn-zoom-out");
  const homeBtn = toolbarRoot.querySelector("#btn-home");
  const canvasTarget = mountPoint.querySelector("#pcb-canvas-target");
  const authoringPanel = toolbarRoot.querySelector("#pcb-authoring-panel");
  const authoringToggleBtn = toolbarRoot.querySelector("#btn-authoring-toggle");
  const authoringActiveTool = toolbarRoot.querySelector("#authoring-active-tool");
  const authoringSelectedComponent = toolbarRoot.querySelector("#authoring-selected-component");
  const authoringCreatedPinCount = toolbarRoot.querySelector("#authoring-created-pin-count");
  const authoringToolButtons = Array.from(toolbarRoot.querySelectorAll("[data-authoring-tool]"));

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

  let boards = [];
  let manualNavDrag = null;

  function syncAuthoringUi() {
    const state = getAuthoringState();
    const activeTool = AUTHORING_TOOL_BUTTONS.find((tool) => tool.id === state.activeTool);
    const activeToolName = activeTool?.label || state.activeTool;

    authoringToggleBtn.textContent = `Authoring Mode: ${state.enabled ? "ON" : "OFF"}`;
    authoringToggleBtn.style.background = state.enabled
      ? "linear-gradient(180deg, #7a42ff 0%, #4a22aa 100%)"
      : "linear-gradient(180deg, #3b424d 0%, #2b3138 100%)";
    authoringPanel?.classList.toggle("is-authoring-active", state.enabled);
    uiLayer?.classList.toggle("is-authoring-active", state.enabled);

    if (authoringActiveTool) {
      authoringActiveTool.textContent = activeToolName;
    }
    if (authoringSelectedComponent) {
      authoringSelectedComponent.textContent = state.selectedComponentId || "(none)";
    }
    if (authoringCreatedPinCount) {
      authoringCreatedPinCount.textContent = String(listCreatedPins().length);
    }

    authoringToolButtons.forEach((button) => {
      const isActive = button.dataset.authoringTool === state.activeTool;
      button.classList.toggle("is-active", isActive);
      if (!button.disabled) {
        button.style.borderColor = isActive ? "rgba(177, 139, 255, 0.92)" : "rgba(95, 109, 123, 0.42)";
        button.style.boxShadow = isActive ? "0 0 0 1px rgba(135, 89, 255, 0.4)" : "none";
      }
    });
  }

  function setAuthoringModeState(enabled) {
    const nextState = setAuthoringMode(enabled);
    if (!nextState.enabled) {
      disableComponentPinEditor();
    }
    syncAuthoringUi();
    return getAuthoringState();
  }

  function setAuthoringToolState(toolName) {
    const nextState = setAuthoringTool(toolName);
    if (!nextState.enabled || nextState.activeTool !== AUTHORING_TOOLS.ADD_PIN) {
      disableComponentPinEditor();
    } else if (nextState.selectedComponentId) {
      setPinEditorComponent(nextState.selectedComponentId);
      pinEditorState.isEditing = true;
      redrawPinEditorOverlays();
    }
    syncAuthoringUi();
    return nextState;
  }

  authoringToggleBtn?.addEventListener("click", () => {
    const state = getAuthoringState();
    setAuthoringModeState(!state.enabled);
  });

  authoringToolButtons.forEach((button) => {
    if (button.disabled) return;
    button.addEventListener("click", () => {
      const toolName = button.dataset.authoringTool;
      setAuthoringToolState(toolName);
    });
  });

  syncAuthoringUi();

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
      setAuthoringSelection({ componentId: null, pinId: null });
      pinEditorState = {
        componentId: null,
        pins: [],
        selectedPinId: null,
        isEditing: false,
        relocateOnNextClick: false,
      };
      clearOverlayList(pinEditorOverlays);
      redrawPickedPadOverlays();
      refreshAuthoringReadoutUi();

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
    removeLastCreatedPin,
    clearCreatedPins,
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
    enableAuthoringMode: () => setAuthoringModeState(true),
    disableAuthoringMode: () => setAuthoringModeState(false),
    setAuthoringTool: (toolName) => setAuthoringToolState(toolName),
    debugAuthoringState: () => getAuthoringState(),
    debugPick,
  };
}
