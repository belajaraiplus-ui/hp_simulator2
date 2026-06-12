import OpenSeadragon from "openseadragon";

export function setProbeOverlayVisualState(probeOverlays, selectedProbeId = null) {
  probeOverlays.forEach((probe) => {
    const active = selectedProbeId && probe.probeId === selectedProbeId;
    const idleBackground = probe.isGround ? "#05070a" : "#ff4444";
    const idleBorder = probe.isGround ? "2px solid #f8fafc" : "2px solid white";
    probe.element.style.background = active ? "#ffe066" : idleBackground;
    probe.element.style.border = active ? "2px solid #fff4bf" : idleBorder;
    probe.element.style.color = probe.isGround ? "#f8fafc" : "transparent";
    probe.element.style.transform = active ? "scale(1.25)" : "scale(1)";
    probe.element.style.boxShadow = active
      ? "0 0 8px rgba(255, 224, 102, 0.9)"
      : (probe.isGround
        ? "0 0 0 1px rgba(248, 250, 252, 0.35), 0 0 8px rgba(15, 23, 42, 0.75)"
        : "0 0 4px rgba(0,0,0,0.5)");
  });
}

export function applyProbeOverlayCursor(probeOverlays, cursor) {
  probeOverlays.forEach((probe) => {
    probe.element.style.cursor = cursor;
  });
}

export function pointForMeasurementTarget(target, boardRuntime) {
  if (!target || !boardRuntime) return null;

  if (target.type === "probe") {
    const probe = boardRuntime.probesById?.[target.probeId || target.id] || null;
    if (probe && Number.isFinite(probe.x) && Number.isFinite(probe.y)) return { x: probe.x, y: probe.y };
  }

  if (target.type === "component-pin") {
    const component = boardRuntime.componentsById?.[target.componentId] || null;
    const contacts = [
      ...(Array.isArray(component?.pins) ? component.pins : []),
      ...(Array.isArray(component?.pads) ? component.pads : []),
    ];
    const contact = contacts.find((entry) => String(entry?.id || "") === String(target.pinId || ""));
    const x = Number(contact?.x ?? contact?.cx ?? contact?.px);
    const y = Number(contact?.y ?? contact?.cy ?? contact?.py);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }

  if (target.type === "component") {
    const component = boardRuntime.componentsById?.[target.componentId] || null;
    const box = component?.bbox || null;
    if (box) return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  }

  if (target.type === "rail") {
    const rail = boardRuntime.railsById?.[target.railId] || null;
    const probe = Array.isArray(rail?.probePoints) ? rail.probePoints[0] : null;
    if (probe && Number.isFinite(probe.x) && Number.isFinite(probe.y)) return { x: probe.x, y: probe.y };
    const box = rail?.overlayBox || null;
    if (box) return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  }

  if (target.type === "node" && target.railId) {
    return pointForMeasurementTarget({ type: "rail", railId: target.railId }, boardRuntime);
  }

  return null;
}

export function drawPlacedProbeTargetOverlays({
  viewer,
  boardRuntime,
  placedProbeTargets,
  placedProbeOverlays,
  clearOverlayList,
}) {
  clearOverlayList(placedProbeOverlays);
  if (!viewer || !boardRuntime) return;

  const { imgW, imgH, sx, sy } = boardRuntime.spaces;
  const entries = [
    { key: "positive", label: "RED", fill: "#ff4d4f", glow: "rgba(255, 77, 79, 0.42)" },
    { key: "negative", label: "BLACK", fill: "#0f172a", glow: "rgba(148, 163, 184, 0.34)" },
  ];

  entries.forEach((entry) => {
    const target = placedProbeTargets[entry.key];
    const point = pointForMeasurementTarget(target, boardRuntime);
    if (!point) return;

    const element = document.createElement("div");
    element.style.width = "46px";
    element.style.height = "46px";
    element.style.borderRadius = "50%";
    element.style.border = "2px solid rgba(255,255,255,0.94)";
    element.style.background = entry.fill;
    element.style.color = "#f8fafc";
    element.style.fontSize = "9px";
    element.style.fontWeight = "800";
    element.style.letterSpacing = "0.08em";
    element.style.display = "flex";
    element.style.alignItems = "center";
    element.style.justifyContent = "center";
    element.style.boxShadow = `0 0 0 3px ${entry.glow}, 0 0 14px ${entry.glow}`;
    element.style.pointerEvents = "none";
    element.textContent = entry.label;
    element.title = target?.label || entry.label;

    const markerImgPx = 46;
    const xi = point.x * sx;
    const yi = point.y * sy;
    const rect = new OpenSeadragon.Rect(
      (xi - markerImgPx / 2) / imgW,
      (yi - markerImgPx / 2) / imgH,
      markerImgPx / imgW,
      markerImgPx / imgH
    );

    viewer.addOverlay({ element, location: rect });
    placedProbeOverlays.push({ element });
  });
}

export function drawProbePointOverlays({
  viewer,
  boardRuntime,
  probeOverlays,
  clearOverlayList,
  getCursor,
  onProbePicked,
}) {
  clearOverlayList(probeOverlays);
  if (!viewer || !boardRuntime) return;

  const { imgW, imgH, sx, sy } = boardRuntime.spaces;
  const markerImgPx = 14;

  boardRuntime.probes.forEach((probe) => {
    const isGround = String(probe.railId || "").toUpperCase().includes("GND")
      || String(probe.label || "").toUpperCase().includes("GND");
    const overlaySize = isGround ? 22 : markerImgPx;
    const element = document.createElement("button");
    element.type = "button";
    element.style.width = `${overlaySize}px`;
    element.style.height = `${overlaySize}px`;
    element.style.background = isGround ? "#05070a" : "#ff4444";
    element.style.border = isGround ? "2px solid #f8fafc" : "2px solid white";
    element.style.borderRadius = "50%";
    element.style.cursor = getCursor();
    element.style.boxShadow = isGround
      ? "0 0 0 1px rgba(248, 250, 252, 0.35), 0 0 8px rgba(15, 23, 42, 0.75)"
      : "0 0 4px rgba(0,0,0,0.5)";
    element.style.pointerEvents = "auto";
    element.style.padding = "0";
    element.style.color = isGround ? "#f8fafc" : "yellow";
    element.style.fontSize = "9px";
    element.style.fontWeight = "800";
    element.style.lineHeight = "1";
    if (isGround) element.textContent = "G";
    element.title = probe.label || probe.id;
    element.dataset.probeId = probe.id;

    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onProbePicked({
        type: "probe",
        id: probe.id,
        probeId: probe.id,
        railId: probe.railId,
        label: probe.label,
        raw: probe,
      });
    });

    const xi = probe.x * sx;
    const yi = probe.y * sy;
    const rect = new OpenSeadragon.Rect(
      (xi - overlaySize / 2) / imgW,
      (yi - overlaySize / 2) / imgH,
      overlaySize / imgW,
      overlaySize / imgH
    );

    viewer.addOverlay({ element, location: rect });
    probeOverlays.push({ element, probeId: probe.id, railId: probe.railId, isGround });
  });
}
