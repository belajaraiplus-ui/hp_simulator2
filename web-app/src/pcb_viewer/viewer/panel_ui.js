const TOOLBAR_MARKUP = `
  <div id="pcb-viewer-ui" class="pcb-viewer-ui">
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

const CANVAS_MARKUP = '<div id="pcb-canvas-target" class="pcb-canvas-target"></div>';

export function mountPanelShell({ mountPoint, toolbarHost }) {
  const mountStyle = window.getComputedStyle(mountPoint);
  if (mountStyle.position === "static") mountPoint.style.position = "relative";
  mountPoint.style.overflow = "hidden";
  if (!mountPoint.style.minHeight) mountPoint.style.minHeight = "400px";

  if (toolbarHost) {
    toolbarHost.innerHTML = TOOLBAR_MARKUP;
    mountPoint.innerHTML = CANVAS_MARKUP;
  } else {
    mountPoint.innerHTML = `${TOOLBAR_MARKUP}${CANVAS_MARKUP}`;
  }

  const toolbarRoot = toolbarHost || mountPoint;
  return {
    canvasTarget: mountPoint.querySelector("#pcb-canvas-target"),
    homeBtn: toolbarRoot.querySelector("#btn-home"),
    loadBtn: toolbarRoot.querySelector("#btn-load-pcb"),
    navBtn: toolbarRoot.querySelector("#btn-nav"),
    probeBtn: toolbarRoot.querySelector("#btn-probe"),
    railSelect: toolbarRoot.querySelector("#rail-select"),
    select: toolbarRoot.querySelector("#board-select"),
    uiLayer: toolbarRoot.querySelector("#pcb-viewer-ui"),
    zoomInBtn: toolbarRoot.querySelector("#btn-zoom-in"),
    zoomOutBtn: toolbarRoot.querySelector("#btn-zoom-out"),
  };
}

export function stopViewerInputOnUiLayer(uiLayer) {
  if (!uiLayer) return;
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

export function renderBoardOptions(select, boards) {
  select.innerHTML = boards
    .map((board) => `<option value="${board.id}">${board.name || board.id}</option>`)
    .join("");
}

export function renderRailOptions(railSelect, rails) {
  railSelect.innerHTML = '<option value="">-- Select Rail --</option>'
    + rails.map((rail) => `<option value="${rail.id}">${rail.label || rail.id}</option>`).join("");
}

export function syncModeButtons({ probeBtn, navBtn, zoomInBtn, zoomOutBtn, homeBtn, probeMode }) {
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
