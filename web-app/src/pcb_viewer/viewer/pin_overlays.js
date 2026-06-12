import {
  normalizePinContact,
  PIN_EDITOR_DEFAULT_RADIUS,
  PIN_EDITOR_MARKER_DIAMETER_IMAGE_PX,
} from "./pin_metadata.js";

export function inferPinRailId(pin, boardRuntime) {
  if (!pin || !boardRuntime?.rails || !boardRuntime.rails.length) return null;
  const candidates = boardRuntime.rails.filter((rail) => rail?.overlayBox
    && pin.x >= rail.overlayBox.minX && pin.x <= rail.overlayBox.maxX
    && pin.y >= rail.overlayBox.minY && pin.y <= rail.overlayBox.maxY);
  if (candidates.length) return candidates[0].id;

  const nearest = boardRuntime.rails
    .filter((rail) => rail?.overlayBox)
    .map((rail) => {
      const cx = (rail.overlayBox.minX + rail.overlayBox.maxX) / 2;
      const cy = (rail.overlayBox.minY + rail.overlayBox.maxY) / 2;
      const dx = pin.x - cx;
      const dy = pin.y - cy;
      return { id: rail.id, distance: dx * dx + dy * dy };
    })
    .sort((a, b) => a.distance - b.distance)[0];
  return nearest?.id || null;
}

export function createPinEditorOverlayElement(pin, selected = false) {
  const element = document.createElement("button");
  element.type = "button";
  element.style.width = `${PIN_EDITOR_MARKER_DIAMETER_IMAGE_PX}px`;
  element.style.height = `${PIN_EDITOR_MARKER_DIAMETER_IMAGE_PX}px`;
  element.style.borderRadius = "50%";
  element.style.border = selected ? "2px solid #fff7d6" : "1px solid #ffffff";
  const isManual = pin.authoringSource === "manual-click";
  element.style.background = selected
    ? "rgba(255, 184, 0, 0.96)"
    : (isManual ? "rgba(26, 174, 255, 0.9)" : "rgba(111, 255, 163, 0.85)");
  element.style.boxShadow = selected
    ? "0 0 12px rgba(255, 184, 0, 0.95)"
    : "0 0 7px rgba(26, 174, 255, 0.8)";
  element.style.pointerEvents = "none";
  element.style.padding = "0";
  element.title = `${pin.id}${pin.name ? ` (${pin.name})` : ""} @ (${pin.x}, ${pin.y}) [${pin.authoringSource || "unknown"}]`;
  return element;
}

function formatRuntimePinLabel(pin) {
  const pinLabel = pin.name && pin.name !== pin.id ? `${pin.id} - ${pin.name}` : (pin.name || pin.id);
  return pin.componentLabel && pin.componentLabel !== "_unassigned"
    ? `${pin.componentLabel} (${pinLabel})`
    : pinLabel;
}

export function getRuntimePinVisualState(pin, selectedPick) {
  const pinComponentId = String(pin?.componentId || "");
  const selectedComponentId = String(selectedPick?.componentId || "");
  const selected = selectedPick?.type === "component-pin"
    && selectedComponentId === pinComponentId
    && String(selectedPick?.pinId || "") === String(pin?.id || "");
  const componentSelected = selectedPick?.type === "component"
    && selectedComponentId
    && selectedComponentId === pinComponentId;
  return {
    selected,
    componentSelected,
    showLabel: selected || componentSelected,
  };
}

export function createRuntimePinOverlayElement(pin, { selected = false, showLabel = false, componentSelected = false } = {}) {
  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";
  wrapper.style.width = "100%";
  wrapper.style.height = "100%";
  wrapper.style.pointerEvents = "none";
  wrapper.style.overflow = "visible";

  const marker = document.createElement("div");
  marker.style.width = "100%";
  marker.style.height = "100%";
  marker.style.borderRadius = "50%";
  marker.style.boxSizing = "border-box";
  marker.style.border = selected
    ? "2px solid #fff7d6"
    : (componentSelected ? "2px solid rgba(255, 222, 140, 0.92)" : "1px solid #ffffff");
  marker.style.background = selected
    ? "rgba(255, 184, 0, 0.96)"
    : (pin.isGround
      ? "rgba(120, 120, 120, 0.92)"
      : (pin.isTestPoint ? "rgba(255, 214, 10, 0.9)" : "rgba(26, 174, 255, 0.88)"));
  marker.style.boxShadow = selected
    ? "0 0 12px rgba(255, 184, 0, 0.95)"
    : (componentSelected
      ? "0 0 10px rgba(255, 205, 86, 0.7)"
      : "0 0 7px rgba(26, 174, 255, 0.72)");
  wrapper.appendChild(marker);

  if (showLabel) {
    const label = document.createElement("div");
    label.textContent = formatRuntimePinLabel(pin);
    label.style.position = "absolute";
    label.style.left = "50%";
    label.style.bottom = "calc(100% + 6px)";
    label.style.transform = "translateX(-50%)";
    label.style.padding = "3px 8px";
    label.style.borderRadius = "999px";
    label.style.border = selected
      ? "1px solid rgba(255, 184, 0, 0.9)"
      : "1px solid rgba(255, 222, 140, 0.9)";
    label.style.background = selected
      ? "rgba(20, 12, 2, 0.96)"
      : "rgba(25, 18, 8, 0.94)";
    label.style.color = selected ? "#fff6d6" : "#fff1c4";
    label.style.fontSize = "11px";
    label.style.fontWeight = "700";
    label.style.whiteSpace = "nowrap";
    label.style.boxShadow = selected
      ? "0 0 12px rgba(255, 184, 0, 0.35)"
      : "0 0 10px rgba(255, 214, 120, 0.22)";
    wrapper.appendChild(label);
  }

  wrapper.title = `${formatRuntimePinLabel(pin)} @ (${pin.x}, ${pin.y})`;
  return wrapper;
}

export function listRuntimePins(boardRuntime) {
  const pins = [];
  (Array.isArray(boardRuntime?.components) ? boardRuntime.components : []).forEach((component) => {
    (Array.isArray(component?.pins) ? component.pins : []).forEach((pin, index) => {
      const normalized = normalizePinContact(pin, `${component?.id || "PIN"}_${index + 1}`);
      if (!normalized) return;
      pins.push({
        ...normalized,
        componentId: normalized.componentId || component?.id || null,
        componentLabel: component?.refdes || component?.label || component?.id || null,
      });
    });
  });
  return pins;
}
