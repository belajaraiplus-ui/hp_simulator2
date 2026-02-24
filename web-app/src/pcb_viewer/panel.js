// web-app/src/pcb_viewer/panel.js
import { createDeepZoomViewer } from "./viewer/deepzoom.js";
import OpenSeadragon from "openseadragon";
import { getBoardList, loadBoard as loadBoardData, loadComponents, loadRails, getTileUrl, clearCache } from "../assets/loader.js";
import { measureRail } from "../engine/adapter.js";

let viewerInstance = null;
let railOverlays = [];
let currentBoard = null;
let activeRail = null;
let probeMode = false;
let probeOverlays = [];

function boardDimensions() {
  const width = currentBoard?.image?.full_width_px || 2048;
  const height = currentBoard?.image?.full_height_px || 2048;
  return { width, height };
}

export function getBoardSize() {
  const w = currentBoard?.image?.full_width_px;
  const h = currentBoard?.image?.full_height_px;
  return { w, h };
}

export function clearScene() {
  if (viewerInstance) {
    probeOverlays.forEach(p => {
      try { viewerInstance.removeOverlay(p.element); } catch {}
    });
    probeOverlays = [];
    
    railOverlays.forEach((el) => {
      try { viewerInstance.removeOverlay(el); } catch {}
    });
    railOverlays = [];
    
    safeDestroyViewer();
  }
  
  currentBoard = null;
  activeRail = null;
  probeMode = false;
  
  clearCache();
  
  const railSelect = document.querySelector("#rail-select");
  if (railSelect) railSelect.innerHTML = '<option value="">-- Select Rail --</option>';
}

export function drawRailOverlay(viewer, rail) {
  if (!viewer || !rail.overlay) return;
  let { w, h } = getBoardSize();
  w = w || 2048;
  h = h || 2048;

  railOverlays.forEach((el) => {
    try { viewer.removeOverlay(el); } catch {}
  });
  railOverlays = [];
  const polys = Array.isArray(rail.overlay) ? rail.overlay : [];
  polys.forEach(poly => {
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.border = "2px solid rgba(255,200,0,0.7)";
    el.style.background = "rgba(255,200,0,0.2)";
    el.style.pointerEvents = "none";
    const xs = poly.map(p => p[0]);
    const ys = poly.map(p => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const rect = new OpenSeadragon.Rect(
      minX / w,
      minY / h,
      (maxX - minX) / w,
      (maxY - minY) / h
    );
    viewer.addOverlay({
      element: el,
      location: rect
    });
    railOverlays.push(el);
  });
}

export function drawProbePoints(viewer, rails) {
  let { w, h } = getBoardSize();
  w = w || 2048;
  h = h || 2048;

  probeOverlays.forEach(p => viewer.removeOverlay(p.element));
  probeOverlays = [];
  
  if (!viewer || !rails) return;
  
  rails.forEach(rail => {
    const probePoints = rail.probe_points || [];
    probePoints.forEach(tp => {
      const el = document.createElement("div");
      el.style.width = "12px";
      el.style.height = "12px";
      el.style.background = "#ff4444";
      el.style.border = "2px solid white";
      el.style.borderRadius = "50%";
      el.style.cursor = "pointer";
      el.style.boxShadow = "0 0 4px rgba(0,0,0,0.5)";
      el.style.pointerEvents = "auto";
      el.dataset.probeId = tp.id;
      el.title = tp.label || tp.id;
      
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const railId = rail.id;
        console.log("Probe target:", tp.id, "rail:", railId);
        measureRail(railId).then((measurement) => {
          window.dispatchEvent(new CustomEvent("pcb:probe-measured", {
            detail: { probeId: tp.id, railId, measurement }
          }));
        }).catch((err) => {
          console.error("Probe measurement failed:", err);
        });
      });
      
      const rect = new OpenSeadragon.Rect(
        tp.x / w - 6 / w,
        tp.y / h - 6 / h,
        12 / w,
        12 / h
      );
      
      viewer.addOverlay({
        element: el,
        location: rect
      });
      probeOverlays.push({ element: el, railId: rail.id });
    });
  });
}

export function toggleProbeMode(viewer, rails) {
  probeMode = !probeMode;
  if (probeMode) {
    drawProbePoints(viewer, rails);
  } else {
    probeOverlays.forEach(p => viewer.removeOverlay(p.element));
    probeOverlays = [];
  }
  return probeMode;
}
export function onRailSelected(railId) {
  if (!currentBoard || !currentBoard.rails) return;

  const rail = currentBoard.rails.find(r => r.id === railId);
  if (!rail) return;

  activeRail = railId;
  drawRailOverlay(viewerInstance, rail);
}

function setStatus(mountPoint, msg) {
  const el = mountPoint.querySelector("#pcb-status");
  if (el) el.textContent = msg;
}

function safeDestroyViewer() {
  if (viewerInstance && typeof viewerInstance.destroy === "function") {
    try {
      viewerInstance.destroy();
    } catch {
      // ignore
    }
  }
  viewerInstance = null;
}

export function initPcbViewerPanel({ mountSelector, onBoardReady } = {}) {
  const mountPoint = document.querySelector(mountSelector);
  if (!mountPoint) return;

  // IMPORTANT: mountPoint harus relative supaya overlay & canvas benar,
  // dan overflow hidden supaya canvas tidak “lepas”
  const mpStyle = window.getComputedStyle(mountPoint);
  if (mpStyle.position === "static") mountPoint.style.position = "relative";
  mountPoint.style.overflow = "hidden";

  // Kalau parent layout tidak memberi height, minimal ini mencegah tinggi 0
  // (Anda boleh hapus jika layout CSS sudah memastikan tinggi)
  if (!mountPoint.style.minHeight) mountPoint.style.minHeight = "400px";

  // UI + Canvas
  // pointer-events:
  // - overlay container: NONE (biar drag/zoom masuk ke viewer)
  // - select/button: AUTO (biar tetap bisa diklik)
  mountPoint.innerHTML = `
    <div id="pcb-viewer-ui"
      style="
        position:absolute; top:15px; left:15px; z-index:1000;
        background:rgba(30,30,30,0.9);
        padding:10px; border-radius:6px;
        display:flex; gap:10px; border:1px solid #444;
        align-items:center;
        pointer-events:none;
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
        style="background:#28a745; color:white; border:none; padding:5px 15px; cursor:pointer; border-radius:4px; pointer-events:auto;">
        PROBE
      </button>

      <span id="pcb-status" style="color:#bbb; font-size:12px; margin-left:6px;">
        Loading boards...
      </span>
    </div>

    <div id="pcb-canvas-target" style="width:100%; height:100%;"></div>
  `;

  const select = mountPoint.querySelector("#board-select");
  const railSelect = mountPoint.querySelector("#rail-select");
  const loadBtn = mountPoint.querySelector("#btn-load-pcb");
  const probeBtn = mountPoint.querySelector("#btn-probe");
  const canvasTarget = mountPoint.querySelector("#pcb-canvas-target");

  // extra safety
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

      select.innerHTML = boards
        .map((b) => `<option value="${b.id}">${b.name || b.id}</option>`)
        .join("");

      setStatus(mountPoint, `Boards: ${boards.length}`);
    } catch (e) {
      console.error("Failed to load boards manifest:", e);
      select.innerHTML = "";
      setStatus(mountPoint, `Failed to load boards: ${e.message}`);
    } finally {
      loadBtn.disabled = false;
    }
  }

  async function loadBoard(boardId) {
    if (!boardId) {
      setStatus(mountPoint, "No board selected");
      return;
    }

    probeMode = false;
    probeBtn.style.background = "#28a745";
    
    setStatus(mountPoint, `Loading board: ${boardId}...`);
    loadBtn.disabled = true;

    try {
      const boardData = await loadBoardData(boardId);

      safeDestroyViewer();

      viewerInstance = await createDeepZoomViewer({
        el: canvasTarget,
        board: boardData,
        getTileUrl: (level, x, y) => getTileUrl(boardId, level, x, y),
      });

      const components = await loadComponents(boardId);
      const rails = await loadRails(boardId);
      currentBoard = { ...boardData, components, rails };

      railSelect.innerHTML = '<option value="">-- Select Rail --</option>' +
        rails.map(r => `<option value="${r.id}">${r.label || r.id}</option>`).join("");

      railSelect.onchange = () => {
        if (railSelect.value) {
          onRailSelected(railSelect.value);
        }
      };

      probeBtn.onclick = () => {
        const isActive = toggleProbeMode(viewerInstance, rails);
        probeBtn.style.background = isActive ? "#1e7e34" : "#28a745";
      };

      setStatus(mountPoint, `Loaded: ${boardData?.name || boardId}`);

      if (typeof onBoardReady === "function") {
        onBoardReady({ board: boardData, components, rails });
      }

      document.querySelectorAll(".rail-item").forEach(el => {
        el.addEventListener("click", () => {
          const id = el.dataset.rail;
          onRailSelected(id);
        });
      });
    } catch (e) {
      console.error("Load board failed:", e);
      setStatus(mountPoint, `Load failed: ${e.message}`);
      safeDestroyViewer();
    } finally {
      loadBtn.disabled = false;
    }
  }

  // bind click
  loadBtn.onclick = () => loadBoard(select.value);
  
  // Auto-load on selection change
  select.addEventListener("change", () => loadBoard(select.value));

  // init
  loadBoardsList().then(() => {
    // auto-load first board so UI doesn't feel dead
    if (select.value) loadBoard(select.value);
  });
  
  return { loadBoard, clearScene, getBoardList };
}
