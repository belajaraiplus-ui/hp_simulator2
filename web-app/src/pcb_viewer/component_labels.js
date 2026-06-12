function createComponentLabelOverlay(label) {
  const el = document.createElement("div");
  el.style.display = "inline-flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.width = "max-content";
  el.style.padding = "3px 10px";
  el.style.border = "1px solid rgba(74, 222, 128, 0.85)";
  el.style.borderRadius = "999px";
  el.style.background = "rgba(3, 10, 6, 0.92)";
  el.style.color = "#dcfce7";
  el.style.boxShadow = "0 0 8px rgba(74, 222, 128, 0.4)";
  el.style.fontSize = "11px";
  el.style.fontWeight = "700";
  el.style.letterSpacing = "0.04em";
  el.style.whiteSpace = "nowrap";
  el.style.pointerEvents = "none";
  el.style.userSelect = "none";
  el.textContent = label;
  return el;
}

export function createComponentLabelController({
  getViewer,
  getBoardRuntime,
  getSpaces,
}) {
  let entries = [];
  let viewportHandler = null;

  function clear() {
    const viewer = getViewer();
    if (viewportHandler && viewer) {
      try { viewer.removeHandler("update-viewport", viewportHandler); } catch { /* ok */ }
      try { viewer.removeHandler("animation", viewportHandler); } catch { /* ok */ }
      viewportHandler = null;
    }
    entries.forEach(({ el }) => el.parentNode?.removeChild(el));
    entries = [];
  }

  function updatePositions() {
    const viewer = getViewer();
    if (!viewer?.viewport) return;
    entries.forEach(({ el, vpPoint }) => {
      const screenPt = viewer.viewport.pixelFromPoint(vpPoint, true);
      if (screenPt) {
        el.style.left = `${screenPt.x}px`;
        el.style.top = `${screenPt.y}px`;
      }
    });
  }

  function ensureViewportHandler() {
    const viewer = getViewer();
    if (viewportHandler || !viewer) return;
    viewportHandler = updatePositions;
    viewer.addHandler("update-viewport", viewportHandler);
    viewer.addHandler("animation", viewportHandler);
  }

  function draw() {
    clear();
    const viewer = getViewer();
    const boardRuntime = getBoardRuntime();
    if (!viewer?.viewport || !boardRuntime) return;

    const container = viewer.container;
    if (!container) return;

    const { sx, sy } = getSpaces();
    boardRuntime.components.forEach((component) => {
      if (!component?.bbox) return;
      const label = String(component.refdes || component.id || "").trim();
      if (!label) return;

      const centerXi = ((component.bbox.minX + component.bbox.maxX) / 2) * sx;
      const topYi = component.bbox.minY * sy;
      const vpPoint = viewer.viewport.imageToViewportCoordinates(centerXi, topYi);
      const el = createComponentLabelOverlay(label);
      el.style.position = "absolute";
      el.style.left = "0";
      el.style.top = "0";
      el.style.zIndex = "100";
      el.style.transform = "translate(-50%, calc(-100% - 6px))";

      container.appendChild(el);
      entries.push({ el, vpPoint });
    });

    updatePositions();
    ensureViewportHandler();
  }

  return {
    clear,
    draw,
  };
}
