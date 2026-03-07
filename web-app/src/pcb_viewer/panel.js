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
import { pickAtScreenPoint, pickBoardTarget, resolveMeasurementTarget, describePick } from "./viewer/picking.js";

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

export function clearScene() {
  clearOverlayList(probeOverlays);
  clearOverlayList(railOverlays);
  clearOverlayList(componentOverlays);
  clearOverlayList(psuTargetOverlays);
  safeDestroyViewer();

  currentBoard = null;
  currentBoardRuntime = null;
  currentSelection = null;
  psuTargetRail = null;
  probeMode = true;

  clearCache();

  const railSelect = document.querySelector("#rail-select");
  if (railSelect) railSelect.innerHTML = '<option value="">-- Select Rail --</option>';
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
    element.style.cursor = "pointer";
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
      <button id="btn-probe"
        style="background:#1e7e34; color:white; border:none; padding:5px 15px; cursor:pointer; border-radius:4px; pointer-events:auto;">
        PROBES ON
      </button>
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
    ].forEach((name) => uiLayer.addEventListener(name, stopViewerInput, { capture: true }));
  }

  railSelect.addEventListener("change", () => {
    if (railSelect.value) onRailSelected(railSelect.value);
  });

  canvasTarget.style.width = "100%";
  canvasTarget.style.height = "100%";

  let boards = [];

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

      viewerInstance.addHandler("canvas-click", handleCanvasClick);

      railSelect.innerHTML = '<option value="">-- Select Rail --</option>'
        + currentBoardRuntime.rails.map((rail) => `<option value="${rail.id}">${rail.label || rail.id}</option>`).join("");

      probeMode = true;
      drawProbePoints(viewerInstance, currentBoardRuntime);
      probeBtn.textContent = "PROBES ON";
      probeBtn.style.background = "#1e7e34";
      probeBtn.onclick = () => {
        const active = toggleProbeMode(viewerInstance, currentBoardRuntime);
        probeBtn.textContent = active ? "PROBES ON" : "PROBES OFF";
        probeBtn.style.background = active ? "#1e7e34" : "#6c757d";
      };

      setStatus(mountPoint, `Loaded: ${boardData?.name || boardId}. Click probe, component, or rail to measure.`);

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
    debugPick,
  };
}
