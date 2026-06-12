import OpenSeadragon from "openseadragon";
import { clearViewerOverlayList } from "./viewer/overlays.js";

const PAD_MARKER_DIAMETER_IMAGE_PX = 12;

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

export function createPadPickerController({
  getViewer,
  getBoardRuntime,
  getBoard,
  getProbeMode,
  getMountPoint,
  setStatus,
}) {
  let enabled = false;
  let pickedPads = [];
  let pickedPadOverlays = [];
  let pickedPadCounter = 0;
  let latestPadPoint = null;
  let latestPickedPadId = null;

  function clearOverlays() {
    clearViewerOverlayList(getViewer(), pickedPadOverlays);
  }

  function redraw() {
    clearOverlays();
    const viewer = getViewer();
    const runtime = getBoardRuntime();
    if (!viewer || !runtime || !pickedPads.length) return;

    const { imgW, imgH, sx, sy } = runtime.spaces;
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
      viewer.addOverlay({ element, location: rect });
      pickedPadOverlays.push({ element, padId: pad.id });
    });
  }

  function ensureRuntime(actionName) {
    if (!getViewer() || !getBoardRuntime()) {
      console.warn(`[pcb] ${actionName} requires a loaded board/runtime.`);
      return false;
    }
    return true;
  }

  function addAtPoint(point, { radius = 6 } = {}) {
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
    redraw();
    return pad;
  }

  function enable() {
    if (!ensureRuntime("enablePadPicker")) return false;
    enabled = true;
    const mountPoint = getMountPoint?.();
    if (mountPoint) setStatus(mountPoint, "Pad picker enabled. Click motherboard to add pads.");
    redraw();
    console.info("[pcb] Pad picker enabled");
    return true;
  }

  function disable() {
    enabled = false;
    const mountPoint = getMountPoint?.();
    if (mountPoint) {
      setStatus(
        mountPoint,
        getProbeMode()
          ? "Pad picker disabled. Probe mode active."
          : "Pad picker disabled. Navigate mode active."
      );
    }
    console.info("[pcb] Pad picker disabled");
    return true;
  }

  function list() {
    return pickedPads.map((pad) => ({ ...pad }));
  }

  function clear() {
    pickedPads = [];
    pickedPadCounter = 0;
    latestPickedPadId = null;
    latestPadPoint = null;
    redraw();
    console.info("[pcb] Cleared picked pads");
    return [];
  }

  function removeLast() {
    if (!pickedPads.length) return null;
    const removed = pickedPads.pop() || null;
    latestPickedPadId = pickedPads.length ? pickedPads[pickedPads.length - 1].id : null;
    redraw();
    console.info("[pcb] Removed picked pad", removed?.id || "");
    return removed ? { ...removed } : null;
  }

  function exportPayload() {
    const board = getBoard();
    const runtime = getBoardRuntime();
    return {
      boardId: board?.id || runtime?.board?.id || null,
      pads: list(),
    };
  }

  function reset() {
    clearOverlays();
    enabled = false;
    pickedPads = [];
    pickedPadCounter = 0;
    latestPadPoint = null;
    latestPickedPadId = null;
  }

  return {
    addAtPoint,
    clear,
    clearOverlays,
    disable,
    enable,
    exportJson: () => JSON.stringify(exportPayload(), null, 2),
    exportPayload,
    getLatestPoint: () => latestPadPoint,
    isEnabled: () => enabled,
    list,
    redraw,
    removeLast,
    reset,
  };
}
