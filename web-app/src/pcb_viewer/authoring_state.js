export const AUTHORING_TOOLS = Object.freeze({
  SELECT: "select",
  ADD_PIN: "add_pin",
  EDIT_PIN: "edit_pin",
  COMPONENT: "component",
  VALIDATE: "validate",
  EXPORT: "export",
});

const TOOL_SET = new Set(Object.values(AUTHORING_TOOLS));

const DEFAULT_AUTHORING_STATE = Object.freeze({
  enabled: false,
  activeTool: AUTHORING_TOOLS.SELECT,
  selectedComponentId: null,
  selectedPinId: null,
});

let authoringState = { ...DEFAULT_AUTHORING_STATE };

function cloneState() {
  return { ...authoringState };
}

export function getAuthoringState() {
  return cloneState();
}

export function resetAuthoringState() {
  authoringState = { ...DEFAULT_AUTHORING_STATE };
  return cloneState();
}

export function setAuthoringMode(enabled) {
  authoringState.enabled = Boolean(enabled);
  if (!authoringState.enabled) {
    authoringState.selectedComponentId = null;
    authoringState.selectedPinId = null;
  }
  return cloneState();
}

export function setAuthoringTool(toolName) {
  const nextTool = String(toolName || "").toLowerCase();
  if (!TOOL_SET.has(nextTool)) {
    throw new Error(`Unknown authoring tool: ${toolName}`);
  }
  authoringState.activeTool = nextTool;
  return cloneState();
}

export function setAuthoringSelection({ componentId = null, pinId = null } = {}) {
  authoringState.selectedComponentId = componentId || null;
  authoringState.selectedPinId = pinId || null;
  return cloneState();
}
