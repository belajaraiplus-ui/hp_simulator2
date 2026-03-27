/**
 * PCB Authoring Studio
 * Developer-only tool for pin authoring, box annotations, metadata editing,
 * export preview, and validation — all integrated into the PCB Viewer UI.
 */

import OpenSeadragon from "openseadragon";

// ─── Constants ─────────────────────────────────────────────────────────────────
const PIN_TYPE_OPTIONS = [
  "", "resistor", "capacitor", "diode", "mosfet", "ic", "fuse",
  "inductor", "jumper", "test_point", "passive", "signal", "power", "ground",
];
const PIN_ROLE_OPTIONS = [
  "", "ground", "signal", "power", "passive", "test_point",
  "anode", "cathode", "gate", "drain", "source", "input", "output", "pin1", "pin2",
];
const PIN_COMPONENT_SNAP_DISTANCE = 96;

const TOOL_NAMES = ["select", "box", "pin", "edit"];

// ─── State ─────────────────────────────────────────────────────────────────────
let authoringState = {
  enabled: false,
  activeTool: "select",
  selectedComponentId: null,
  selectedPinId: null,
  selectedBoxId: null,
  boxes: [],
  pins: [],
  boxCounter: 0,
  pinCounter: 0,
  exportMode: "all",
};

// Drawing state for box drag
let dragState = null; // { startBoard, startScreen }

// References injected from panel.js
let _viewerInstance = null;
let _boardRuntime = null;
let _getSpaces = null;

// Overlay tracking
let boxOverlays = [];
let pinOverlays = [];
let dragPreviewEl = null;

// Guard against duplicate drag handler registration
let _boxDragInstalled = false;

// DOM references
let studioPanel = null;
let toolButtons = {};
let inspectorEl = null;
let exportPanelEl = null;
let validationPanelEl = null;
let statusEl = null;

// ─── Initialization ────────────────────────────────────────────────────────────

export function initAuthoringStudio({
  viewerInstance,
  boardRuntime,
  getSpaces,
  mountTarget,
  screenToBoardPoint,
}) {
  _viewerInstance = viewerInstance;
  _boardRuntime = boardRuntime;
  _getSpaces = getSpaces;
  _screenToBoardPointFn = screenToBoardPoint;

  // Build studio panel if not yet created
  if (!studioPanel) {
    buildStudioPanel(mountTarget);
  }

  // Re-sync on board load
  refreshOverlays();
  refreshInspector();
  refreshExportPanel();
  refreshValidationPanel();
}

let _screenToBoardPointFn = null;

/**
 * Wrapper: ensures that screen coords are wrapped as OpenSeadragon.Point
 * before passing to the picking.js screenToBoardPoint function, because
 * OSD's viewport.pointFromPixel internally calls .minus() which only exists
 * on OSD Point objects.
 */
function safeScreenToBoardPoint(viewer, runtime, screenXY) {
  if (!_screenToBoardPointFn || !viewer || !runtime) return null;
  // If it's already an OSD Point (has .minus method), just pass through
  if (screenXY && typeof screenXY.minus === "function") {
    return _screenToBoardPointFn(viewer, runtime, screenXY);
  }
  // Otherwise create a proper OSD Point
  const x = screenXY?.x ?? screenXY?.position?.x;
  const y = screenXY?.y ?? screenXY?.position?.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const osdPoint = new OpenSeadragon.Point(x, y);
  if (screenXY?.coordinateSpace) {
    osdPoint.coordinateSpace = screenXY.coordinateSpace;
  }
  return _screenToBoardPointFn(viewer, runtime, osdPoint);
}

export function updateAuthoringViewerRefs({ viewerInstance, boardRuntime, getSpaces }) {
  _viewerInstance = viewerInstance;
  _boardRuntime = boardRuntime;
  if (getSpaces) _getSpaces = getSpaces;
  refreshOverlays();
}

export function getAuthoringState() {
  return { ...authoringState, boxes: authoringState.boxes.map(b => ({ ...b, style: { ...b.style } })), pins: authoringState.pins.map(p => ({ ...p })) };
}

export function isAuthoringEnabled() {
  return authoringState.enabled;
}

export function getActiveTool() {
  return authoringState.activeTool;
}

export function isBoxDragActive() {
  return dragState !== null;
}

function normalizeAuthoringId(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function collectUsedAuthoringIds(prefix) {
  const used = new Set();
  const add = (value) => {
    const normalized = normalizeAuthoringId(value);
    if (normalized) used.add(normalized);
  };

  if (prefix === "BOX") {
    Object.keys(_boardRuntime?.componentsById || {}).forEach(add);
    authoringState.boxes.forEach((box) => {
      add(box?.id);
      add(box?.componentId);
    });
    return used;
  }

  authoringState.pins.forEach((pin) => add(pin?.id));
  (_boardRuntime?.components || []).forEach((component) => {
    (component?.pins || []).forEach((pin) => add(pin?.id));
  });
  return used;
}

function nextAuthoringId(prefix) {
  const counterKey = prefix === "BOX" ? "boxCounter" : "pinCounter";
  const used = collectUsedAuthoringIds(prefix);

  while (true) {
    authoringState[counterKey] += 1;
    const candidate = `${prefix}_${String(authoringState[counterKey]).padStart(3, "0")}`;
    if (!used.has(candidate)) return candidate;
  }
}

function getComponentIdForBox(box) {
  return normalizeAuthoringId(box?.componentId) || normalizeAuthoringId(box?.id);
}

function getComponentIdForPin(pin, boxComponentIds = new Map()) {
  return normalizeAuthoringId(pin?.componentId)
    || boxComponentIds.get(pin?.boxId)
    || normalizeAuthoringId(pin?.boxId)
    || null;
}

function pointFromPin(pin) {
  const x = Number(pin?.x);
  const y = Number(pin?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function boxBoundsFromAuthoringBox(box) {
  const bbox = buildBoxBbox(box);
  if (!bbox) return null;
  return {
    minX: bbox.x,
    minY: bbox.y,
    maxX: bbox.x + bbox.w,
    maxY: bbox.y + bbox.h,
  };
}

function boxArea(bounds) {
  if (!bounds) return Number.POSITIVE_INFINITY;
  return Math.max(1, (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY));
}

function distancePointToBounds(point, bounds) {
  if (!point || !bounds) return Number.POSITIVE_INFINITY;
  const dx = point.x < bounds.minX
    ? bounds.minX - point.x
    : (point.x > bounds.maxX ? point.x - bounds.maxX : 0);
  const dy = point.y < bounds.minY
    ? bounds.minY - point.y
    : (point.y > bounds.maxY ? point.y - bounds.maxY : 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function findAuthoringComponentIdAtBoardPoint(boardPoint, boxComponentIds = new Map()) {
  if (!boardPoint || !Array.isArray(authoringState.boxes)) return null;
  const matches = authoringState.boxes
    .map((box) => ({ box, bounds: boxBoundsFromAuthoringBox(box) }))
    .filter((entry) => entry.bounds)
    .filter((entry) => (
      boardPoint.x >= entry.bounds.minX
      && boardPoint.x <= entry.bounds.maxX
      && boardPoint.y >= entry.bounds.minY
      && boardPoint.y <= entry.bounds.maxY
    ))
    .sort((left, right) => boxArea(left.bounds) - boxArea(right.bounds));
  const componentId = matches[0]?.box ? getComponentIdForPin({ boxId: matches[0].box.id }, boxComponentIds) : null;
  return normalizeAuthoringId(componentId);
}

function findRuntimeComponentIdAtBoardPoint(boardPoint) {
  if (!boardPoint || !Array.isArray(_boardRuntime?.components)) return null;
  const matches = _boardRuntime.components
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

function findNearestAuthoringComponentId(boardPoint, boxComponentIds = new Map(), maxDistance = PIN_COMPONENT_SNAP_DISTANCE) {
  if (!boardPoint || !Array.isArray(authoringState.boxes)) return null;
  const [nearest] = authoringState.boxes
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

function findNearestRuntimeComponentId(boardPoint, maxDistance = PIN_COMPONENT_SNAP_DISTANCE) {
  if (!boardPoint || !Array.isArray(_boardRuntime?.components)) return null;
  const [nearest] = _boardRuntime.components
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

function buildBoxComponentIdMap() {
  const boxComponentIds = new Map();
  authoringState.boxes.forEach((box) => {
    const componentId = getComponentIdForBox(box);
    if (componentId) boxComponentIds.set(box.id, componentId);
  });
  return boxComponentIds;
}

function resolvePinComponentId(pin, boxComponentIds = buildBoxComponentIdMap()) {
  const explicit = getComponentIdForPin(pin, boxComponentIds);
  if (explicit) return explicit;

  const boardPoint = pointFromPin(pin);
  if (!boardPoint) return null;

  return findAuthoringComponentIdAtBoardPoint(boardPoint, boxComponentIds)
    || findRuntimeComponentIdAtBoardPoint(boardPoint)
    || findNearestAuthoringComponentId(boardPoint, boxComponentIds)
    || findNearestRuntimeComponentId(boardPoint)
    || null;
}

function cloneExistingComponent(componentId) {
  const raw = componentId ? _boardRuntime?.componentsById?.[componentId]?.raw : null;
  if (!raw || typeof raw !== "object") return null;
  return JSON.parse(JSON.stringify(raw));
}

function buildBoxBbox(box) {
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

function buildShapeFromBbox(bbox) {
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

function fallbackStandaloneComponentId(pin) {
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

function buildBoardOverlayRect({ x, y, w, h }, spaces) {
  if (!_viewerInstance?.viewport || !spaces) return null;
  const { sx, sy } = spaces;
  const minXi = Number(x) * sx;
  const minYi = Number(y) * sy;
  const maxXi = (Number(x) + Number(w)) * sx;
  const maxYi = (Number(y) + Number(h)) * sy;
  const topLeft = _viewerInstance.viewport.imageToViewportCoordinates(minXi, minYi);
  const botRight = _viewerInstance.viewport.imageToViewportCoordinates(maxXi, maxYi);
  return new OpenSeadragon.Rect(
    topLeft.x,
    topLeft.y,
    Math.max(0.001, botRight.x - topLeft.x),
    Math.max(0.001, botRight.y - topLeft.y)
  );
}

function suppressOverlayPointerEvent(event) {
  if (!event) return;
  event.stopPropagation?.();
  event.preventDefault?.();
}

function updateBoxOverlayPosition(box, element, spaces) {
  if (!_viewerInstance || !box || !element) return;
  const rect = buildBoardOverlayRect(box, spaces);
  if (!rect) return;
  _viewerInstance.updateOverlay(element, rect);
  element.title = `${box.id}${box.label ? ` (${box.label})` : ""} @ (${box.x}, ${box.y}) ${box.w}Ã—${box.h}`;
}

function dragDeltaToBoardDelta(delta, spaces) {
  if (!_viewerInstance?.viewport || !delta || !spaces) return null;
  const sx = Number(spaces?.sx);
  const sy = Number(spaces?.sy);
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx === 0 || sy === 0) return null;

  const viewportDelta = _viewerInstance.viewport.deltaPointsFromPixels(delta);
  const imageOrigin = _viewerInstance.viewport.viewportToImageCoordinates(new OpenSeadragon.Point(0, 0));
  const imageTarget = _viewerInstance.viewport.viewportToImageCoordinates(
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

function wireEditableBoxOverlay(box, element, spaces) {
  if (!_viewerInstance || !box || !element) return null;
  if (authoringState.activeTool !== "edit") return null;

  ["pointerdown", "pointermove", "pointerup", "click"].forEach((name) => {
    element.addEventListener(name, suppressOverlayPointerEvent);
  });

  const tracker = new OpenSeadragon.MouseTracker({
    element,
    pressHandler: (event) => {
      event.preventDefaultAction = true;
      authoringState.selectedBoxId = box.id;
      authoringState.selectedPinId = null;
      setAuthoringStatus(`Selected box ${box.id}`);
      refreshInspector();
      refreshItemsList();
      event.originalEvent?.stopPropagation?.();
      event.originalEvent?.preventDefault?.();
    },
    dragHandler: (event) => {
      event.preventDefaultAction = true;
      const liveBox = authoringState.boxes.find((entry) => entry.id === box.id);
      if (!liveBox) return;

      const boardDelta = dragDeltaToBoardDelta(event.delta, spaces);
      if (!boardDelta) return;

      liveBox.x = Number(liveBox.x || 0) + boardDelta.x;
      liveBox.y = Number(liveBox.y || 0) + boardDelta.y;
      updateBoxOverlayPosition(liveBox, element, spaces);
      event.originalEvent?.stopPropagation?.();
      event.originalEvent?.preventDefault?.();
    },
    releaseHandler: (event) => {
      event.preventDefaultAction = true;
      const liveBox = authoringState.boxes.find((entry) => entry.id === box.id);
      if (liveBox) {
        liveBox.x = Math.round(Number(liveBox.x || 0));
        liveBox.y = Math.round(Number(liveBox.y || 0));
        updateBoxOverlayPosition(liveBox, element, spaces);
        setAuthoringStatus(`Moved box ${liveBox.id} to (${liveBox.x}, ${liveBox.y})`);
      }
      refreshOverlays();
      refreshInspector();
      refreshItemsList();
      refreshExportPanel();
      refreshValidationPanel();
      event.originalEvent?.stopPropagation?.();
      event.originalEvent?.preventDefault?.();
    },
  });
  tracker.setTracking(true);
  return tracker;
}

// ─── Build Studio Panel ────────────────────────────────────────────────────────

function buildStudioPanel(mountTarget) {
  const layoutEl = document.querySelector(".layout");
  if (!layoutEl) return;

  studioPanel = document.createElement("aside");
  studioPanel.id = "authoring-studio";
  studioPanel.className = "authoring-studio";
  studioPanel.innerHTML = buildStudioHTML();
  layoutEl.appendChild(studioPanel);

  // Wire up event handlers
  wireToggleButton();
  wireToolButtons();
  wireInspector();
  wireExportPanel();
  wireValidationPanel();

  syncUI();
}

function buildStudioHTML() {
  return `
    <div class="as-header">
      <div class="as-title-row">
        <span class="as-icon">🛠</span>
        <h2 class="as-title">Authoring Studio</h2>
        <span class="as-badge">DEV</span>
      </div>
      <button id="as-toggle" class="as-toggle-btn" title="Toggle Authoring Mode">OFF</button>
    </div>

    <div class="as-body" id="as-body">
      <!-- Toolbar -->
      <div class="as-section">
        <div class="as-section-label">Tools</div>
        <div class="as-toolbar">
          <button class="as-tool-btn" data-tool="select" title="Select">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 2l10 10h-6l4 10-3 1-4-10-5 4z"/></svg>
            <span>Select</span>
          </button>
          <button class="as-tool-btn" data-tool="box" title="Box Annotation">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
            <span>Box</span>
          </button>
          <button class="as-tool-btn" data-tool="pin" title="Add Pin">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="10" r="4"/><path d="M12 14v7"/><path d="M8 21h8"/></svg>
            <span>Pin</span>
          </button>
          <button class="as-tool-btn" data-tool="edit" title="Edit Mode">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3l4 4L7 21H3v-4z"/></svg>
            <span>Edit</span>
          </button>
        </div>
      </div>

      <!-- Status -->
      <div class="as-status" id="as-status">Ready. Select a tool to begin.</div>

      <!-- Inspector (Box or Pin) -->
      <div class="as-section" id="as-inspector" style="display:none;">
        <div class="as-section-label" id="as-inspector-title">Inspector</div>
        <div id="as-inspector-body"></div>
      </div>

      <!-- Items List -->
      <div class="as-section">
        <div class="as-section-label">Items <span id="as-items-count" class="as-count">0</span></div>
        <div class="as-items-list" id="as-items-list"></div>
      </div>

      <!-- Export Panel -->
      <div class="as-section">
        <div class="as-section-label">Export</div>
        <div class="as-export-controls">
          <select id="as-export-mode" class="as-select">
            <option value="all">All (Boxes + Pins)</option>
            <option value="boxes">Boxes Only</option>
            <option value="pins">Pins Only</option>
            <option value="component-patch">Component Patch</option>
          </select>
          <div class="as-btn-row">
            <button id="as-copy-export" class="as-btn as-btn-accent">📋 Copy JSON</button>
            <button id="as-save-to-file" class="as-btn as-btn-save" title="Save directly to components.json on disk via API">💾 Save to File</button>
          </div>
        </div>
        <pre id="as-export-preview" class="as-json-preview"></pre>
      </div>

      <!-- Validation Panel -->
      <div class="as-section">
        <div class="as-section-label">Validation <span id="as-validation-count" class="as-count">0</span></div>
        <div id="as-validation-list" class="as-validation-list"></div>
      </div>
    </div>
  `;
}

// ─── Wire UI ───────────────────────────────────────────────────────────────────

function wireToggleButton() {
  const btn = studioPanel.querySelector("#as-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    authoringState.enabled = !authoringState.enabled;
    syncUI();
    if (authoringState.enabled) {
      setAuthoringStatus("Authoring Mode ON. Select a tool.");
    } else {
      setAuthoringStatus("Authoring Mode OFF.");
      authoringState.activeTool = "select";
    }
    refreshOverlays();
  });
}

function wireToolButtons() {
  const btns = studioPanel.querySelectorAll(".as-tool-btn");
  btns.forEach(btn => {
    const tool = btn.dataset.tool;
    toolButtons[tool] = btn;
    btn.addEventListener("click", () => {
      if (!authoringState.enabled) return;
      authoringState.activeTool = tool;
      syncToolButtons();
      setAuthoringStatus(toolStatusMessage(tool));
      refreshOverlays();
    });
  });
}

function wireInspector() {
  inspectorEl = studioPanel.querySelector("#as-inspector");
}

function wireExportPanel() {
  exportPanelEl = studioPanel.querySelector("#as-export-preview");
  const modeSelect = studioPanel.querySelector("#as-export-mode");
  if (modeSelect) {
    modeSelect.addEventListener("change", () => {
      authoringState.exportMode = modeSelect.value;
      refreshExportPanel();
    });
  }
  const copyBtn = studioPanel.querySelector("#as-copy-export");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const json = buildExportJson();
      navigator.clipboard.writeText(json).then(() => {
        setAuthoringStatus("✅ JSON copied to clipboard!");
        copyBtn.textContent = "✅ Copied!";
        setTimeout(() => { copyBtn.textContent = "📋 Copy JSON"; }, 1500);
      }).catch(() => {
        setAuthoringStatus("❌ Copy failed. Select text manually.");
      });
    });
  }

  // Save to File button
  const saveBtn = studioPanel.querySelector("#as-save-to-file");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => saveToFile(saveBtn));
  }
}

function wireValidationPanel() {
  validationPanelEl = studioPanel.querySelector("#as-validation-list");
}

// ─── Sync UI ───────────────────────────────────────────────────────────────────

function syncUI() {
  if (!studioPanel) return;
  const toggle = studioPanel.querySelector("#as-toggle");
  const body = studioPanel.querySelector("#as-body");

  if (toggle) {
    toggle.textContent = authoringState.enabled ? "ON" : "OFF";
    toggle.classList.toggle("as-toggle-on", authoringState.enabled);
  }

  if (body) {
    body.style.display = authoringState.enabled ? "flex" : "none";
  }

  studioPanel.classList.toggle("as-active", authoringState.enabled);
  syncToolButtons();
  refreshItemsList();
  refreshExportPanel();
  refreshValidationPanel();
}

function syncToolButtons() {
  Object.entries(toolButtons).forEach(([tool, btn]) => {
    btn.classList.toggle("as-tool-active", authoringState.activeTool === tool);
  });
}

function toolStatusMessage(tool) {
  switch (tool) {
    case "select": return "Select mode. Click items on the board to select.";
    case "box": return "Box Annotation mode. Drag on the PCB to draw a box.";
    case "pin": return "Add Pin mode. Click on the PCB to place a pin.";
    case "edit": return "Edit mode. Click a pin or box to edit its properties.";
    default: return "Ready.";
  }
}

function setAuthoringStatus(msg) {
  const el = studioPanel?.querySelector("#as-status");
  if (el) el.textContent = msg;
}

// ─── Canvas Click / Drag Handling ──────────────────────────────────────────────
// These are called from panel.js when authoring is active.

export function handleAuthoringCanvasClick(event, viewerInstance, boardRuntime) {
  if (!authoringState.enabled || !viewerInstance || !boardRuntime) return false;
  if (!event?.quick) return false;

  // event.position from OSD is already an OSD Point — safe to pass directly
  const point = safeScreenToBoardPoint(viewerInstance, boardRuntime, event.position);
  if (!point) return false;

  const tool = authoringState.activeTool;

  if (tool === "pin") {
    addPinAtBoardPoint(point.board);
    event.preventDefaultAction = true;
    return true;
  }

  if (tool === "select" || tool === "edit") {
    const hit = pickAuthoringItem(point.board);
    if (hit) {
      if (hit.type === "pin") {
        selectPin(hit.id);
      } else if (hit.type === "box") {
        selectBox(hit.id);
      }
      event.preventDefaultAction = true;
      return true;
    }
  }

  return false;
}

// Box drag — uses pointer events on the canvas target
// Handlers are stored so they can be removed and reinstalled on board reload.
let _boxDragHandlers = null;

export function installBoxDragHandlers(canvasTarget, viewerInstance, boardRuntime) {
  if (!canvasTarget) return;

  // Remove previous handlers if present (board reload case)
  if (_boxDragHandlers) {
    canvasTarget.removeEventListener("pointerdown", _boxDragHandlers.down, true);
    canvasTarget.removeEventListener("pointermove", _boxDragHandlers.move, true);
    canvasTarget.removeEventListener("pointerup",   _boxDragHandlers.end,  true);
    canvasTarget.removeEventListener("pointercancel", _boxDragHandlers.end, true);
    _boxDragHandlers = null;
  }
  _boxDragInstalled = true;

  // Always use live module-level refs (_viewerInstance, _boardRuntime) so that
  // after updateAuthoringViewerRefs() the handlers pick up the new viewer.
  const resolvePointerBoardPoint = (e) => {
    const rect = canvasTarget.getBoundingClientRect?.();
    if (rect) {
      return safeScreenToBoardPoint(_viewerInstance, _boardRuntime, {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
        coordinateSpace: "viewer-local",
      });
    }

    return safeScreenToBoardPoint(_viewerInstance, _boardRuntime, {
      x: e.clientX,
      y: e.clientY,
      coordinateSpace: "client",
    });
  };

  const onPointerDown = (e) => {
    if (!authoringState.enabled || authoringState.activeTool !== "box") return;
    if (!_viewerInstance?.viewport) return;

    const boardPt = resolvePointerBoardPoint(e);
    if (!boardPt) return;

    dragState = {
      startBoard: { ...boardPt.board },
      startScreen: { x: e.clientX, y: e.clientY },
      pointerId: e.pointerId,
    };

    // Create drag preview element
    if (!dragPreviewEl) {
      dragPreviewEl = document.createElement("div");
      dragPreviewEl.className = "as-drag-preview";
      document.body.appendChild(dragPreviewEl);
    }
    dragPreviewEl.style.display = "block";
    dragPreviewEl.style.left = `${e.clientX}px`;
    dragPreviewEl.style.top = `${e.clientY}px`;
    dragPreviewEl.style.width = "0px";
    dragPreviewEl.style.height = "0px";

    canvasTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerMove = (e) => {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    if (!dragPreviewEl) return;

    const x1 = Math.min(dragState.startScreen.x, e.clientX);
    const y1 = Math.min(dragState.startScreen.y, e.clientY);
    const w = Math.abs(e.clientX - dragState.startScreen.x);
    const h = Math.abs(e.clientY - dragState.startScreen.y);

    dragPreviewEl.style.left = `${x1}px`;
    dragPreviewEl.style.top = `${y1}px`;
    dragPreviewEl.style.width = `${w}px`;
    dragPreviewEl.style.height = `${h}px`;

    e.preventDefault();
    e.stopPropagation();
  };

  const endDrag = (e) => {
    if (!dragState) return;
    if (e?.pointerId != null && e.pointerId !== dragState.pointerId) return;

    if (dragPreviewEl) {
      dragPreviewEl.style.display = "none";
    }

    canvasTarget.releasePointerCapture?.(dragState.pointerId);

    // Calculate end board point
    const boardPt = resolvePointerBoardPoint(e);

    if (boardPt) {
      const startB = dragState.startBoard;
      const endB = boardPt.board;
      const minX = Math.min(startB.x, endB.x);
      const minY = Math.min(startB.y, endB.y);
      const maxX = Math.max(startB.x, endB.x);
      const maxY = Math.max(startB.y, endB.y);
      const w = maxX - minX;
      const h = maxY - minY;

      // Only create box if drag was meaningful (> 3 units in board space)
      if (w > 3 || h > 3) {
        addBox({
          x: Math.round(minX),
          y: Math.round(minY),
          w: Math.round(w),
          h: Math.round(h),
        });
      }
    }

    dragState = null;
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  canvasTarget.addEventListener("pointerdown",  onPointerDown, true);
  canvasTarget.addEventListener("pointermove",  onPointerMove, true);
  canvasTarget.addEventListener("pointerup",    endDrag,       true);
  canvasTarget.addEventListener("pointercancel", endDrag,      true);

  // Save refs for cleanup on next board load
  _boxDragHandlers = { down: onPointerDown, move: onPointerMove, end: endDrag };
}

// ─── Box CRUD ──────────────────────────────────────────────────────────────────

function addBox({ x, y, w, h }) {
  const id = nextAuthoringId("BOX");
  const box = {
    id,
    componentId: authoringState.selectedComponentId || null,
    x, y, w, h,
    label: null,
    kind: null,
    style: {
      strokeColor: "rgba(0,0,0,0.85)",
      fillColor: "rgba(255,255,0,0.12)",
      strokeWidth: 2,
    },
    authoringSource: "manual-box",
  };
  authoringState.boxes.push(box);
  authoringState.selectedBoxId = id;
  authoringState.selectedPinId = null;
  authoringState.selectedComponentId = getComponentIdForBox(box);
  setAuthoringStatus(`Created box ${id} at (${x}, ${y}) ${w}×${h}`);
  refreshOverlays();
  refreshInspector();
  refreshItemsList();
  refreshExportPanel();
  refreshValidationPanel();
  return box;
}

function selectBox(boxId) {
  const box = authoringState.boxes.find(b => b.id === boxId) || null;
  authoringState.selectedBoxId = boxId;
  authoringState.selectedPinId = null;
  authoringState.selectedComponentId = getComponentIdForBox(box);
  setAuthoringStatus(`Selected box ${boxId}`);
  refreshOverlays();
  refreshInspector();
  refreshItemsList();
}

function updateBox(boxId, patch) {
  const box = authoringState.boxes.find(b => b.id === boxId);
  if (!box) return null;
  Object.assign(box, patch);
  if (patch.style) box.style = { ...box.style, ...patch.style };
  refreshOverlays();
  refreshInspector();
  refreshExportPanel();
  refreshValidationPanel();
  return box;
}

function deleteBox(boxId) {
  const idx = authoringState.boxes.findIndex(b => b.id === boxId);
  if (idx < 0) return;
  authoringState.boxes.splice(idx, 1);
  if (authoringState.selectedBoxId === boxId) {
    authoringState.selectedBoxId = null;
  }
  // Remove pins linked to this box
  authoringState.pins = authoringState.pins.filter(p => p.boxId !== boxId);
  setAuthoringStatus(`Deleted box ${boxId}`);
  refreshOverlays();
  refreshInspector();
  refreshItemsList();
  refreshExportPanel();
  refreshValidationPanel();
}

// ─── Pin CRUD ──────────────────────────────────────────────────────────────────

function addPinAtBoardPoint(boardPoint) {
  const id = nextAuthoringId("PIN");

  // Find enclosing box
  let boxId = authoringState.selectedBoxId || null;
  if (!boxId) {
    const enclosingBox = authoringState.boxes.find(b =>
      boardPoint.x >= b.x && boardPoint.x <= b.x + b.w &&
      boardPoint.y >= b.y && boardPoint.y <= b.y + b.h
    );
    if (enclosingBox) boxId = enclosingBox.id;
  }

  const selectedBox = boxId
    ? authoringState.boxes.find((entry) => entry.id === boxId) || null
    : null;
  const boxComponentIds = buildBoxComponentIdMap();
  const inferredComponentId = resolvePinComponentId({
    componentId: normalizeAuthoringId(authoringState.selectedComponentId),
    boxId,
    x: Math.round(boardPoint.x),
    y: Math.round(boardPoint.y),
  }, boxComponentIds);

  const pin = {
    id,
    name: id,
    x: Math.round(boardPoint.x),
    y: Math.round(boardPoint.y),
    radius: 6,
    componentId: inferredComponentId,
    boxId,
    node: null,
    railId: null,
    pinType: null,
    pinRole: null,
    isGround: false,
    isTestPoint: false,
    authoringSource: "manual-click",
  };

  // Auto-infer rail
  if (_boardRuntime?.rails) {
    const rail = _boardRuntime.rails.find(r => r?.overlayBox &&
      pin.x >= r.overlayBox.minX && pin.x <= r.overlayBox.maxX &&
      pin.y >= r.overlayBox.minY && pin.y <= r.overlayBox.maxY
    );
    if (rail) {
      pin.railId = rail.id;
      pin.node = rail.id;
      if (String(rail.id).toUpperCase().includes("GND")) {
        pin.isGround = true;
        pin.pinRole = "ground";
      }
    }
  }

  authoringState.pins.push(pin);
  authoringState.selectedPinId = id;
  authoringState.selectedBoxId = null;
  authoringState.selectedComponentId = inferredComponentId;

  if (boxId) {
    setAuthoringStatus(`Created pin ${id} at (${pin.x}, ${pin.y}) in ${boxId}`);
  } else if (inferredComponentId) {
    setAuthoringStatus(`Created pin ${id} at (${pin.x}, ${pin.y}) on ${inferredComponentId}`);
  } else {
    setAuthoringStatus(`⚠ Pin ${id} at (${pin.x}, ${pin.y}) — no box/component selected`);
  }

  refreshOverlays();
  refreshInspector();
  refreshItemsList();
  refreshExportPanel();
  refreshValidationPanel();
  return pin;
}

function selectPin(pinId) {
  const pin = authoringState.pins.find((entry) => entry.id === pinId) || null;
  const selectedBox = pin?.boxId
    ? authoringState.boxes.find((entry) => entry.id === pin.boxId) || null
    : null;
  const boxComponentIds = buildBoxComponentIdMap();
  authoringState.selectedPinId = pinId;
  authoringState.selectedBoxId = null;
  authoringState.selectedComponentId = resolvePinComponentId(pin, boxComponentIds)
    || normalizeAuthoringId(pin?.componentId)
    || getComponentIdForBox(selectedBox)
    || null;
  setAuthoringStatus(`Selected pin ${pinId}`);
  refreshOverlays();
  refreshInspector();
  refreshItemsList();
}

function updatePinField(pinId, field, value) {
  const pin = authoringState.pins.find(p => p.id === pinId);
  if (!pin) return;

  if (field === "id") {
    const oldId = pin.id;
    pin.id = String(value).trim() || oldId;
    pin.name = pin.name === oldId ? pin.id : pin.name;
    if (authoringState.selectedPinId === oldId) authoringState.selectedPinId = pin.id;
  } else if (field === "x" || field === "y" || field === "radius") {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) pin[field] = field === "radius" ? num : Math.round(num);
  } else if (field === "isGround" || field === "isTestPoint") {
    pin[field] = Boolean(value);
  } else {
    pin[field] = value === "" ? null : value;
  }

  refreshOverlays();
  refreshExportPanel();
  refreshValidationPanel();
}

function deletePin(pinId) {
  const idx = authoringState.pins.findIndex(p => p.id === pinId);
  if (idx < 0) return;
  authoringState.pins.splice(idx, 1);
  if (authoringState.selectedPinId === pinId) {
    authoringState.selectedPinId = null;
  }
  setAuthoringStatus(`Deleted pin ${pinId}`);
  refreshOverlays();
  refreshInspector();
  refreshItemsList();
  refreshExportPanel();
  refreshValidationPanel();
}

// ─── Hit Testing ───────────────────────────────────────────────────────────────

function pickAuthoringItem(boardPoint) {
  // Check pins first (smaller, higher priority)
  const hitRadius = 12;
  for (const pin of authoringState.pins) {
    const dx = boardPoint.x - pin.x;
    const dy = boardPoint.y - pin.y;
    if (dx * dx + dy * dy <= hitRadius * hitRadius) {
      return { type: "pin", id: pin.id };
    }
  }

  // Check boxes
  for (const box of authoringState.boxes) {
    if (boardPoint.x >= box.x && boardPoint.x <= box.x + box.w &&
        boardPoint.y >= box.y && boardPoint.y <= box.y + box.h) {
      return { type: "box", id: box.id };
    }
  }

  return null;
}

// ─── Overlay Rendering ─────────────────────────────────────────────────────────

function clearAuthoringOverlays() {
  if (!_viewerInstance) return;
  [...boxOverlays, ...pinOverlays].forEach(entry => {
    try {
      entry.tracker?.destroy?.();
      _viewerInstance.removeOverlay(entry.element);
    } catch { /* ignore */ }
  });
  boxOverlays = [];
  pinOverlays = [];
}

export function refreshOverlays() {
  clearAuthoringOverlays();
  if (!_viewerInstance || !_boardRuntime || !authoringState.enabled) return;

  const spaces = _getSpaces?.() || _boardRuntime.spaces;
  if (!spaces) return;

  // Draw boxes
  authoringState.boxes.forEach(box => {
    const rect = buildBoardOverlayRect(box, spaces);
    if (!rect) return;

    const el = document.createElement("div");
    const selected = box.id === authoringState.selectedBoxId;
    el.style.position = "absolute";
    el.style.border = `${box.style.strokeWidth}px solid ${box.style.strokeColor}`;
    el.style.background = box.style.fillColor;
    el.style.boxSizing = "border-box";
    el.style.pointerEvents = authoringState.activeTool === "edit" ? "auto" : "none";
    if (selected) {
      el.style.boxShadow = "0 0 0 2px rgba(255,184,0,0.8), 0 0 12px rgba(255,184,0,0.4)";
    }

    // Label
    if (box.label || box.kind) {
      const labelEl = document.createElement("span");
      labelEl.style.cssText = `
        position:absolute; top:2px; left:4px;
        font-size:10px; font-weight:700; color:#fff;
        background:rgba(0,0,0,0.6); padding:1px 4px;
        border-radius:2px; pointer-events:none; white-space:nowrap;
      `;
      labelEl.textContent = [box.label, box.kind].filter(Boolean).join(" · ");
      el.appendChild(labelEl);
    }

    el.title = `${box.id}${box.label ? ` (${box.label})` : ""} @ (${box.x}, ${box.y}) ${box.w}×${box.h}`;
    _viewerInstance.addOverlay({ element: el, location: rect });
    const tracker = wireEditableBoxOverlay(box, el, spaces);
    boxOverlays.push({ element: el, boxId: box.id, tracker });
  });

  // Draw pins
  authoringState.pins.forEach(pin => {
    const r = Math.max(1, (pin.radius || 6));
    const rect = buildBoardOverlayRect({
      x: pin.x - r,
      y: pin.y - r,
      w: r * 2,
      h: r * 2,
    }, spaces);
    if (!rect) return;

    const selected = pin.id === authoringState.selectedPinId;
    const el = document.createElement("div");
    el.style.width = "14px";
    el.style.height = "14px";
    el.style.borderRadius = "50%";
    el.style.border = selected ? "2px solid #fff7d6" : "1px solid #ffffff";
    el.style.background = selected
      ? "rgba(255, 184, 0, 0.96)"
      : (pin.isGround ? "rgba(120, 120, 120, 0.9)" : "rgba(0, 200, 255, 0.9)");
    el.style.boxShadow = selected
      ? "0 0 12px rgba(255, 184, 0, 0.95)"
      : "0 0 7px rgba(0, 200, 255, 0.8)";
    el.style.pointerEvents = "none";
    el.title = `${pin.id}${pin.name && pin.name !== pin.id ? ` (${pin.name})` : ""} @ (${pin.x}, ${pin.y})`;

    _viewerInstance.addOverlay({ element: el, location: rect });
    pinOverlays.push({ element: el, pinId: pin.id });
  });
}

// ─── Inspector ─────────────────────────────────────────────────────────────────

function refreshInspector() {
  if (!inspectorEl) return;
  const titleEl = studioPanel?.querySelector("#as-inspector-title");
  const bodyEl = studioPanel?.querySelector("#as-inspector-body");
  if (!bodyEl) return;

  const selectedPin = authoringState.selectedPinId
    ? authoringState.pins.find(p => p.id === authoringState.selectedPinId)
    : null;
  const selectedBox = authoringState.selectedBoxId
    ? authoringState.boxes.find(b => b.id === authoringState.selectedBoxId)
    : null;

  if (!selectedPin && !selectedBox) {
    inspectorEl.style.display = "none";
    return;
  }

  inspectorEl.style.display = "block";

  if (selectedPin) {
    if (titleEl) titleEl.textContent = `📌 Pin: ${selectedPin.id}`;
    bodyEl.innerHTML = buildPinInspectorHTML(selectedPin);
    wirePinInspectorEvents(bodyEl, selectedPin);
  } else if (selectedBox) {
    if (titleEl) titleEl.textContent = `📦 Box: ${selectedBox.id}`;
    bodyEl.innerHTML = buildBoxInspectorHTML(selectedBox);
    wireBoxInspectorEvents(bodyEl, selectedBox);
  }
}

function buildPinInspectorHTML(pin) {
  return `
    <div class="as-inspector-grid">
      <label class="as-field">
        <span class="as-field-label">ID</span>
        <input type="text" class="as-input" data-field="id" value="${esc(pin.id)}">
      </label>
      <label class="as-field">
        <span class="as-field-label">Name</span>
        <input type="text" class="as-input" data-field="name" value="${esc(pin.name || "")}">
      </label>
      <label class="as-field">
        <span class="as-field-label">Pin Type</span>
        <select class="as-select" data-field="pinType">
          ${PIN_TYPE_OPTIONS.map(v => `<option value="${v}" ${pin.pinType === v ? "selected" : ""}>${v || "-- none --"}</option>`).join("")}
        </select>
      </label>
      <label class="as-field">
        <span class="as-field-label">Pin Role</span>
        <select class="as-select" data-field="pinRole">
          ${PIN_ROLE_OPTIONS.map(v => `<option value="${v}" ${pin.pinRole === v ? "selected" : ""}>${v || "-- none --"}</option>`).join("")}
        </select>
      </label>
      <label class="as-field">
        <span class="as-field-label">Node</span>
        <input type="text" class="as-input" data-field="node" value="${esc(pin.node || "")}">
      </label>
      <label class="as-field">
        <span class="as-field-label">Rail ID</span>
        <input type="text" class="as-input" data-field="railId" value="${esc(pin.railId || "")}">
      </label>
      <label class="as-field">
        <span class="as-field-label">Radius</span>
        <input type="number" class="as-input" data-field="radius" value="${pin.radius}" min="1" step="1">
      </label>
      <label class="as-field">
        <span class="as-field-label">X</span>
        <input type="number" class="as-input" data-field="x" value="${pin.x}">
      </label>
      <label class="as-field">
        <span class="as-field-label">Y</span>
        <input type="number" class="as-input" data-field="y" value="${pin.y}">
      </label>
      <label class="as-field as-field-checkbox">
        <input type="checkbox" data-field="isGround" ${pin.isGround ? "checked" : ""}>
        <span>Is Ground</span>
      </label>
      <label class="as-field as-field-checkbox">
        <input type="checkbox" data-field="isTestPoint" ${pin.isTestPoint ? "checked" : ""}>
        <span>Is Test Point</span>
      </label>
    </div>
    <button class="as-btn as-btn-danger as-btn-sm" id="as-delete-pin">🗑 Delete Pin</button>
  `;
}

function wirePinInspectorEvents(container, pin) {
  container.querySelectorAll("[data-field]").forEach(el => {
    const field = el.dataset.field;
    const eventType = el.type === "checkbox" ? "change" : "input";
    el.addEventListener(eventType, () => {
      const value = el.type === "checkbox" ? el.checked : el.value;
      updatePinField(pin.id, field, value);
    });
  });

  const deleteBtn = container.querySelector("#as-delete-pin");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => deletePin(pin.id));
  }
}

function buildBoxInspectorHTML(box) {
  return `
    <div class="as-inspector-grid">
      <label class="as-field">
        <span class="as-field-label">Label</span>
        <input type="text" class="as-input" data-field="label" value="${esc(box.label || "")}">
      </label>
      <label class="as-field">
        <span class="as-field-label">Kind</span>
        <input type="text" class="as-input" data-field="kind" value="${esc(box.kind || "")}">
      </label>
      <label class="as-field">
        <span class="as-field-label">Component ID</span>
        <input type="text" class="as-input" data-field="componentId" value="${esc(box.componentId || "")}">
      </label>
      <label class="as-field">
        <span class="as-field-label">Border Color</span>
        <input type="text" class="as-input" data-field="strokeColor" value="${esc(box.style.strokeColor)}" placeholder="rgba(...)">
      </label>
      <label class="as-field">
        <span class="as-field-label">Fill Color</span>
        <input type="text" class="as-input" data-field="fillColor" value="${esc(box.style.fillColor)}" placeholder="rgba(...)">
      </label>
      <label class="as-field">
        <span class="as-field-label">Border Width</span>
        <input type="number" class="as-input" data-field="strokeWidth" value="${box.style.strokeWidth}" min="0" step="1">
      </label>
      <div class="as-field-info">Position: (${box.x}, ${box.y}) Size: ${box.w}×${box.h}</div>
    </div>
    <button class="as-btn as-btn-danger as-btn-sm" id="as-delete-box">🗑 Delete Box</button>
  `;
}

function wireBoxInspectorEvents(container, box) {
  container.querySelectorAll("[data-field]").forEach(el => {
    const field = el.dataset.field;
    el.addEventListener("input", () => {
      const styleFields = ["strokeColor", "fillColor", "strokeWidth"];
      if (styleFields.includes(field)) {
        const val = field === "strokeWidth" ? Number(el.value) : el.value;
        updateBox(box.id, { style: { [field]: val } });
      } else {
        updateBox(box.id, { [field]: el.value === "" ? null : el.value });
      }
    });
  });

  const deleteBtn = container.querySelector("#as-delete-box");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => deleteBox(box.id));
  }
}

// ─── Items List ────────────────────────────────────────────────────────────────

function refreshItemsList() {
  const listEl = studioPanel?.querySelector("#as-items-list");
  const countEl = studioPanel?.querySelector("#as-items-count");
  if (!listEl) return;

  const total = authoringState.boxes.length + authoringState.pins.length;
  if (countEl) countEl.textContent = total;

  if (total === 0) {
    listEl.innerHTML = '<div class="as-items-empty">No items yet. Use Box or Pin tools to add.</div>';
    return;
  }

  let html = "";

  authoringState.boxes.forEach(box => {
    const sel = box.id === authoringState.selectedBoxId;
    html += `<div class="as-item ${sel ? "as-item-selected" : ""}" data-type="box" data-id="${box.id}">
      <span class="as-item-icon">📦</span>
      <span class="as-item-label">${box.id}${box.label ? ` · ${esc(box.label)}` : ""}</span>
      <span class="as-item-meta">${box.w}×${box.h}</span>
    </div>`;
  });

  authoringState.pins.forEach(pin => {
    const sel = pin.id === authoringState.selectedPinId;
    html += `<div class="as-item ${sel ? "as-item-selected" : ""}" data-type="pin" data-id="${pin.id}">
      <span class="as-item-icon">📌</span>
      <span class="as-item-label">${pin.id}${pin.name && pin.name !== pin.id ? ` · ${esc(pin.name)}` : ""}</span>
      <span class="as-item-meta">(${pin.x}, ${pin.y})</span>
    </div>`;
  });

  listEl.innerHTML = html;

  // Wire click events
  listEl.querySelectorAll(".as-item").forEach(el => {
    el.addEventListener("click", () => {
      const type = el.dataset.type;
      const id = el.dataset.id;
      if (type === "box") selectBox(id);
      else if (type === "pin") selectPin(id);
    });
  });
}

// ─── Export ────────────────────────────────────────────────────────────────────

function buildComponentPatchData() {
  const compMap = {};
  const boxComponentIds = buildBoxComponentIdMap();
  const authoredPinsByComponentId = new Map();
  const standalonePins = [];

  authoringState.pins.forEach((pin) => {
    const resolvedComponentId = resolvePinComponentId(pin, boxComponentIds);
    const componentId = resolvedComponentId || fallbackStandaloneComponentId(pin);
    if (!resolvedComponentId) standalonePins.push({ ...pin, componentId });
    if (!authoredPinsByComponentId.has(componentId)) {
      authoredPinsByComponentId.set(componentId, []);
    }
    authoredPinsByComponentId.get(componentId).push(buildAuthoredPinPayload(pin));
  });

  authoringState.boxes.forEach((box) => {
    const componentId = boxComponentIds.get(box.id);
    if (!componentId) return;
    const existing = cloneExistingComponent(componentId);
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
    const existing = cloneExistingComponent(componentId);
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

function buildComponentPatchPayload() {
  return buildComponentPatchData().components;
}

function buildExportJson() {
  const mode = authoringState.exportMode;
  let data;

  if (mode === "boxes") {
    data = { boxes: authoringState.boxes.map(b => ({ ...b, style: { ...b.style } })) };
  } else if (mode === "pins") {
    data = { pins: authoringState.pins.map(p => ({ ...p })) };
  } else if (mode === "component-patch") {
    const { components, standalonePins } = buildComponentPatchData();
    data = standalonePins.length
      ? { components, standalonePins }
      : { components };
  } else {
    data = {
      boardId: _boardRuntime?.board?.id || null,
      boxes: authoringState.boxes.map(b => ({ ...b, style: { ...b.style } })),
      pins: authoringState.pins.map(p => ({ ...p })),
    };
  }

  return JSON.stringify(data, null, 2);
}

async function saveToFile(btn) {
  const boardId = _boardRuntime?.board?.id;
  if (!boardId) {
    setAuthoringStatus("❌ No board loaded — cannot save.");
    return;
  }

  const { components, standalonePins } = buildComponentPatchData();
  if (!components.length) {
    setAuthoringStatus("⚠️ Nothing to save (no boxes/pins).");
    return;
  }

  const originalText = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Saving..."; }

  try {
    const res = await fetch(`/api/boards/${boardId}/authoring/patch-components`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ components, overwrite: false }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const result = await res.json();
    setAuthoringStatus(
      standalonePins.length
        ? `✅ Saved! ${result.components_written} component(s) written → ${result.total_components} total. ${standalonePins.length} pin(s) saved as standalone components.`
        : `✅ Saved! ${result.components_written} component(s) written → ${result.total_components} total in components.json`
    );
    if (btn) { btn.textContent = "✅ Saved!"; }
    setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = "💾 Save to File"; } }, 2500);

    // Notify panel.js to refresh labels (board data changed)
    window.dispatchEvent(new CustomEvent("pcb:authoring-saved", { detail: { boardId } }));

  } catch (err) {
    console.error("[authoring] saveToFile failed:", err);
    setAuthoringStatus(`❌ Save failed: ${err.message}`);
    if (btn) { btn.disabled = false; btn.textContent = originalText || "💾 Save to File"; }
  }
}

function refreshExportPanel() {
  if (!exportPanelEl) return;
  if (!authoringState.enabled) {
    exportPanelEl.textContent = "";
    return;
  }
  exportPanelEl.textContent = buildExportJson();
}

// ─── Validation ────────────────────────────────────────────────────────────────

function runValidation() {
  const issues = [];
  const boxComponentIds = buildBoxComponentIdMap();

  // Check for duplicate pin IDs
  const pinIds = new Set();
  authoringState.pins.forEach(pin => {
    if (pinIds.has(pin.id)) {
      issues.push({ severity: "error", message: `Duplicate pin ID: ${pin.id}` });
    }
    pinIds.add(pin.id);
  });

  // Check for duplicate box IDs
  const boxIds = new Set();
  authoringState.boxes.forEach(box => {
    if (boxIds.has(box.id)) {
      issues.push({ severity: "error", message: `Duplicate box ID: ${box.id}` });
    }
    boxIds.add(box.id);
  });

  // Check pins without a resolvable component owner
  authoringState.pins.forEach(pin => {
    if (!resolvePinComponentId(pin, boxComponentIds)) {
      issues.push({ severity: "warning", message: `Pin ${pin.id} will be saved as standalone component ${fallbackStandaloneComponentId(pin)}` });
    }
    if (!pin.node && !pin.railId) {
      issues.push({ severity: "warning", message: `Pin ${pin.id} missing node/railId` });
    }
    if (!pin.pinType) {
      issues.push({ severity: "info", message: `Pin ${pin.id} missing pinType` });
    }
    if (!pin.pinRole) {
      issues.push({ severity: "info", message: `Pin ${pin.id} missing pinRole` });
    }
  });

  // Check boxes without label/kind
  authoringState.boxes.forEach(box => {
    if (!box.label) {
      issues.push({ severity: "warning", message: `Box ${box.id} has no label` });
    }
    if (!box.kind) {
      issues.push({ severity: "info", message: `Box ${box.id} has no kind` });
    }
  });

  // Check box has pins
  authoringState.boxes.forEach(box => {
    const boxPins = authoringState.pins.filter(p => p.boxId === box.id);
    if (boxPins.length === 0) {
      issues.push({ severity: "info", message: `Box ${box.id} has no pins yet` });
    }
  });

  // Measurability check
  if (authoringState.pins.length > 0) {
    const measurable = authoringState.pins.filter(p => p.node || p.railId);
    if (measurable.length < authoringState.pins.length) {
      issues.push({
        severity: "warning",
        message: `${authoringState.pins.length - measurable.length} of ${authoringState.pins.length} pins not yet measurable (missing node/rail)`,
      });
    }
  }

  if (issues.length === 0 && (authoringState.pins.length > 0 || authoringState.boxes.length > 0)) {
    issues.push({ severity: "info", message: "✅ All authoring data looks valid!" });
  }

  return issues;
}

function refreshValidationPanel() {
  const listEl = studioPanel?.querySelector("#as-validation-list");
  const countEl = studioPanel?.querySelector("#as-validation-count");
  if (!listEl) return;

  if (!authoringState.enabled) {
    listEl.innerHTML = "";
    if (countEl) countEl.textContent = "0";
    return;
  }

  const issues = runValidation();
  if (countEl) countEl.textContent = issues.length;

  if (issues.length === 0) {
    listEl.innerHTML = '<div class="as-validation-empty">No items to validate.</div>';
    return;
  }

  listEl.innerHTML = issues.map(issue => {
    const icon = issue.severity === "error" ? "🔴" : issue.severity === "warning" ? "🟡" : "🔵";
    return `<div class="as-validation-item as-validation-${issue.severity}">
      <span class="as-validation-icon">${icon}</span>
      <span class="as-validation-msg">${esc(issue.message)}</span>
    </div>`;
  }).join("");
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Developer Helpers (window.*) ──────────────────────────────────────────────

export function installAuthoringDevHelpers() {
  window.enableAuthoringMode = () => {
    authoringState.enabled = true;
    syncUI();
    return true;
  };
  window.disableAuthoringMode = () => {
    authoringState.enabled = false;
    syncUI();
    return true;
  };
  window.setAuthoringTool = (toolName) => {
    if (!TOOL_NAMES.includes(toolName)) return false;
    authoringState.activeTool = toolName;
    syncToolButtons();
    return true;
  };
  window.debugAuthoringState = () => getAuthoringState();
  window.listCreatedAuthoringPins = () => authoringState.pins.map(p => ({ ...p }));
  window.listBoxes = () => authoringState.boxes.map(b => ({ ...b, style: { ...b.style } }));
  window.dumpSelectedAuthoringPin = () => {
    if (!authoringState.selectedPinId) return null;
    return authoringState.pins.find(p => p.id === authoringState.selectedPinId) || null;
  };
  window.dumpSelectedBox = () => {
    if (!authoringState.selectedBoxId) return null;
    return authoringState.boxes.find(b => b.id === authoringState.selectedBoxId) || null;
  };
  window.exportAuthoringJson = () => buildExportJson();
  window.exportSelectedComponentPatchAuthoring = () => {
    const mode = authoringState.exportMode;
    authoringState.exportMode = "component-patch";
    const json = buildExportJson();
    authoringState.exportMode = mode;
    return json;
  };
}

// ─── Reset on board change ─────────────────────────────────────────────────────

export function resetAuthoringOnBoardChange() {
  authoringState.boxes = [];
  authoringState.pins = [];
  authoringState.boxCounter = 0;
  authoringState.pinCounter = 0;
  authoringState.selectedBoxId = null;
  authoringState.selectedPinId = null;
  authoringState.selectedComponentId = null;
  // Reset drag-handler guard so installBoxDragHandlers reinstalls cleanly
  // on the new canvas/viewer after a board reload.
  _boxDragInstalled = false;
  dragState = null;
  clearAuthoringOverlays();
  if (authoringState.enabled) {
    refreshOverlays();
    refreshInspector();
    refreshItemsList();
    refreshExportPanel();
    refreshValidationPanel();
  }
}

// ─── For panel.js to check if drag should be intercepted ───────────────────────

export function shouldInterceptDrag() {
  return authoringState.enabled && authoringState.activeTool === "box";
}

export function isAuthoringActive() {
  return authoringState.enabled;
}
