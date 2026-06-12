export function clearViewerOverlayList(viewer, list) {
  if (!viewer) {
    list.length = 0;
    return;
  }
  list.forEach((entry) => {
    try {
      viewer.removeOverlay(entry.element || entry);
    } catch {
      // Overlay cleanup is best-effort; stale entries are cleared below.
    }
  });
  list.length = 0;
}

export function createRectOverlay({ border, background, boxShadow = "none" }) {
  const el = document.createElement("div");
  el.style.position = "absolute";
  el.style.border = border;
  el.style.background = background;
  el.style.boxShadow = boxShadow;
  el.style.pointerEvents = "none";
  return el;
}
