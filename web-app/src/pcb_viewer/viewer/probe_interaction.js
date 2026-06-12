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

export const POSITIVE_PROBE_CURSOR = buildProbeCursor();
export const NEGATIVE_PROBE_CURSOR = buildProbeCursor({
  handle: "#2c313a",
  handleHighlight: "#636b78",
  guard: "#11161d",
  collar: "#596170",
  cableCap: "#07090c",
});
export const NAVIGATE_CURSOR = "zoom-in";

export function currentProbeCursor(polarity = "positive") {
  return polarity === "negative" ? NEGATIVE_PROBE_CURSOR : POSITIVE_PROBE_CURSOR;
}

function getViewerCursorTargets(viewer) {
  if (!viewer) return [];
  return [viewer.canvas, viewer.container, viewer.element].filter(Boolean);
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

export function applyViewerInteractionMode({
  viewer,
  mountPoint = null,
  probeMode = true,
  activeProbePolarity = "positive",
  setStatus,
} = {}) {
  if (!viewer) return;

  setViewerNavigationEnabled(viewer, false);
  const cursor = probeMode ? currentProbeCursor(activeProbePolarity) : NAVIGATE_CURSOR;
  getViewerCursorTargets(viewer).forEach((target) => {
    target.style.cursor = cursor;
    target.style.touchAction = probeMode ? "auto" : "none";
  });

  if (mountPoint && typeof setStatus === "function") {
    setStatus(
      mountPoint,
      probeMode
        ? `Probe mode active (${activeProbePolarity === "negative" ? "NEG" : "POS"}). Click probe, component, or rail to measure.`
        : "Navigate mode active. Pan/zoom PCB, then switch back to probe mode to measure."
    );
  }
}
