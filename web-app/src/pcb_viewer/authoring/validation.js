export function validateAuthoringState({
  state,
  boxComponentIds,
  resolvePinComponentId,
  fallbackStandaloneComponentId,
}) {
  const issues = [];

  const pinIds = new Set();
  state.pins.forEach((pin) => {
    if (pinIds.has(pin.id)) {
      issues.push({ severity: "error", message: `Duplicate pin ID: ${pin.id}` });
    }
    pinIds.add(pin.id);
  });

  const boxIds = new Set();
  state.boxes.forEach((box) => {
    if (boxIds.has(box.id)) {
      issues.push({ severity: "error", message: `Duplicate box ID: ${box.id}` });
    }
    boxIds.add(box.id);
  });

  state.pins.forEach((pin) => {
    if (!resolvePinComponentId(pin, boxComponentIds)) {
      issues.push({
        severity: "warning",
        message: `Pin ${pin.id} will be saved as standalone component ${fallbackStandaloneComponentId(pin)}`,
      });
    }
    if (!pin.node && !pin.railId) {
      issues.push({ severity: "warning", message: `Pin ${pin.id} missing node/railId` });
    }
    if (!pin.pinType) {
      issues.push({ severity: "info", message: `Pin ${pin.id} missing pinType` });
    }
    if (!pin.pinRole) {
      issues.push({ severity: "info", message: `Pin ${pin.id} missing pinRole` });
    }
  });

  state.boxes.forEach((box) => {
    if (!box.label) {
      issues.push({ severity: "warning", message: `Box ${box.id} has no label` });
    }
    if (!box.kind) {
      issues.push({ severity: "info", message: `Box ${box.id} has no kind` });
    }
  });

  state.boxes.forEach((box) => {
    const boxPins = state.pins.filter((pin) => pin.boxId === box.id);
    if (boxPins.length === 0) {
      issues.push({ severity: "info", message: `Box ${box.id} has no pins yet` });
    }
  });

  if (state.pins.length > 0) {
    const measurable = state.pins.filter((pin) => pin.node || pin.railId);
    if (measurable.length < state.pins.length) {
      issues.push({
        severity: "warning",
        message: `${state.pins.length - measurable.length} of ${state.pins.length} pins not yet measurable (missing node/rail)`,
      });
    }
  }

  if (issues.length === 0 && (state.pins.length > 0 || state.boxes.length > 0)) {
    issues.push({ severity: "info", message: "All authoring data looks valid." });
  }

  return issues;
}
