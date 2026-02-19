// web-app/src/pcb_viewer/panel.js
import { createDeepZoomViewer } from "./viewer/deepzoom.js";

let viewerInstance = null;

// Prefer relative "/api" so Vite proxy works (recommended).
// Fallback to absolute for direct backend access if needed.
const API_BASE = "/api";
const API_FALLBACK = "http://127.0.0.1:8080/api";

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`${url} -> ${res.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url} returned non-JSON: ${text}`);
  }
}

async function fetchJsonWithFallback(path) {
  // path harus diawali dengan "/"
  try {
    return await fetchJson(`${API_BASE}${path}`);
  } catch (_e) {
    return await fetchJson(`${API_FALLBACK}${path}`);
  }
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

      <span id="pcb-status" style="color:#bbb; font-size:12px; margin-left:6px;">
        Loading boards...
      </span>
    </div>

    <div id="pcb-canvas-target" style="width:100%; height:100%;"></div>
  `;

  const select = mountPoint.querySelector("#board-select");
  const loadBtn = mountPoint.querySelector("#btn-load-pcb");
  const canvasTarget = mountPoint.querySelector("#pcb-canvas-target");

  // extra safety
  canvasTarget.style.width = "100%";
  canvasTarget.style.height = "100%";

  let boards = [];

  async function loadBoardsList() {
    setStatus(mountPoint, "Loading boards...");
    loadBtn.disabled = true;

    try {
      // /api/boards -> { version, boards: [...] }
      const manifest = await fetchJsonWithFallback("/boards");
      boards = Array.isArray(manifest?.boards) ? manifest.boards : [];

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

    setStatus(mountPoint, `Loading board: ${boardId}...`);
    loadBtn.disabled = true;

    try {
      // board.json
      const boardData = await fetchJsonWithFallback(`/boards/${encodeURIComponent(boardId)}/board`);

      // destroy viewer lama (jika ada)
      safeDestroyViewer();

      // init deep zoom viewer
      viewerInstance = await createDeepZoomViewer({
        el: canvasTarget,
        board: boardData,
      });

      // components.json -> { version, components: [...] }
      let componentsFile = null;
      try {
        componentsFile = await fetchJsonWithFallback(`/boards/${encodeURIComponent(boardId)}/components`);
      } catch (e) {
        console.warn("components load failed (non-fatal):", e);
      }

      const components = Array.isArray(componentsFile?.components)
        ? componentsFile.components
        : [];

      setStatus(mountPoint, `Loaded: ${boardData?.name || boardId}`);

      if (typeof onBoardReady === "function") {
        onBoardReady({ board: boardData, components });
      }
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

  // init
  loadBoardsList().then(() => {
    // auto-load first board so UI doesn't feel dead
    if (select.value) loadBoard(select.value);
  });
}
