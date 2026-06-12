/**
 * PCB Authoring Studio
 * Developer-only tool for pin authoring, box annotations, metadata editing,
 * export preview, and validation — all integrated into the PCB Viewer UI.
 */

import OpenSeadragon from "openseadragon";
import {
  TOOL_NAMES,
} from "./authoring/constants.js";
import {
  boxBoundsFromAuthoringBox,
  buildBoardOverlayRect,
  dragDeltaToBoardDelta,
  normalizeAuthoringId,
  safeScreenToBoardPoint,
  suppressOverlayPointerEvent,
  updateBoxOverlayPosition,
} from "./authoring/geometry.js";
import {
  buildBoxComponentIdMap as buildBoxComponentIdMapForBoxes,
  getComponentIdForBox,
  resolvePinComponentId as resolvePinComponentIdForState,
} from "./authoring/component_resolver.js";
import { validateAuthoringState } from "./authoring/validation.js";
import {
  buildAuthoringComponentPatchData,
  buildAuthoringExportJson,
  fallbackStandaloneComponentId,
} from "./authoring/export_payload.js";
import {
  buildBoxInspectorHTML,
  buildPinInspectorHTML,
} from "./authoring/inspector_html.js";

// ─── Constants ─────────────────────────────────────────────────────────────────

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

function buildBoxComponentIdMap() {
  return buildBoxComponentIdMapForBoxes(authoringState.boxes);
}

function resolvePinComponentId(pin, boxComponentIds = buildBoxComponentIdMap()) {
  return resolvePinComponentIdForState(pin, {
    boxes: authoringState.boxes,
    boardRuntime: _boardRuntime,
    boxComponentIds,
  });
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

      const boardDelta = dragDeltaToBoardDelta(_viewerInstance, event.delta, spaces);
      if (!boardDelta) return;

      liveBox.x = Number(liveBox.x || 0) + boardDelta.x;
      liveBox.y = Number(liveBox.y || 0) + boardDelta.y;
      updateBoxOverlayPosition(_viewerInstance, liveBox, element, spaces);
      event.originalEvent?.stopPropagation?.();
      event.originalEvent?.preventDefault?.();
    },
    releaseHandler: (event) => {
      event.preventDefaultAction = true;
      const liveBox = authoringState.boxes.find((entry) => entry.id === box.id);
      if (liveBox) {
        liveBox.x = Math.round(Number(liveBox.x || 0));
        liveBox.y = Math.round(Number(liveBox.y || 0));
        updateBoxOverlayPosition(_viewerInstance, liveBox, element, spaces);
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
  const point = safeScreenToBoardPoint(_screenToBoardPointFn, viewerInstance, boardRuntime, event.position);
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
      return safeScreenToBoardPoint(_screenToBoardPointFn, _viewerInstance, _boardRuntime, {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
        coordinateSpace: "viewer-local",
      });
    }

    return safeScreenToBoardPoint(_screenToBoardPointFn, _viewerInstance, _boardRuntime, {
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
    const rect = buildBoardOverlayRect(_viewerInstance, box, spaces);
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
    const rect = buildBoardOverlayRect(_viewerInstance, {
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
  const boxComponentIds = buildBoxComponentIdMap();
  return buildAuthoringComponentPatchData({
    state: authoringState,
    boardRuntime: _boardRuntime,
    boxComponentIds,
    resolvePinComponentId,
  });
}

function buildExportJson() {
  return buildAuthoringExportJson({
    state: authoringState,
    boardRuntime: _boardRuntime,
    buildComponentPatchData,
  });
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
  const boxComponentIds = buildBoxComponentIdMap();
  return validateAuthoringState({
    state: authoringState,
    boxComponentIds,
    resolvePinComponentId,
    fallbackStandaloneComponentId,
  });
}

/* legacy validation tail removed.
  const issues = [];

    issues.push({ severity: "info", message: "✅ All authoring data looks valid!" });
  }

*/
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
