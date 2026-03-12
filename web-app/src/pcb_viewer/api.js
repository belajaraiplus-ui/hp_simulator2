let getViewerApi = () => null;

function resolveViewerApi() {
  const api = getViewerApi?.();
  if (!api) {
    console.warn("[pcb] Viewer API is not ready yet. Load a board first.");
    return null;
  }
  return api;
}

function callViewer(methodName, ...args) {
  const api = resolveViewerApi();
  const method = api?.[methodName];
  if (typeof method !== "function") {
    console.warn(`[pcb] Method not available: ${methodName}`);
    return null;
  }
  return method(...args);
}

export function installPcbViewerDevApi({ viewerApiProvider } = {}) {
  getViewerApi = typeof viewerApiProvider === "function" ? viewerApiProvider : () => null;

  window.enablePadPicker = () => callViewer("enablePadPicker");
  window.disablePadPicker = () => callViewer("disablePadPicker");
  window.listPickedPads = () => callViewer("listPickedPads") || [];
  window.clearPickedPads = () => callViewer("clearPickedPads") || [];
  window.removeLastPickedPad = () => callViewer("removeLastPickedPad");
  window.exportPickedPads = () => callViewer("exportPickedPads");
  window.exportPickedPadsJson = () => callViewer("exportPickedPadsJson") || "";
  window.dumpViewerRuntime = () => callViewer("dumpViewerRuntime");

  window.enableComponentPinEditor = () => callViewer("enableComponentPinEditor");
  window.disableComponentPinEditor = () => callViewer("disableComponentPinEditor");
  window.enablePinPlacementMode = () => callViewer("enablePinPlacementMode");
  window.disablePinPlacementMode = () => callViewer("disablePinPlacementMode");
  window.editComponentPins = (componentId) => callViewer("editComponentPins", componentId);
  window.listComponentPins = () => callViewer("listComponentPins") || [];
  window.listCreatedPins = () => callViewer("listCreatedPins") || [];
  window.removeLastCreatedPin = () => callViewer("removeLastCreatedPin");
  window.clearCreatedPins = () => callViewer("clearCreatedPins") || [];
  window.selectPin = (pinId) => callViewer("selectPin", pinId);
  window.selectCreatedPin = (pinId) => callViewer("selectCreatedPin", pinId);
  window.renamePin = (pinId, newId) => callViewer("renamePin", pinId, newId);
  window.setPinName = (pinId, name) => callViewer("setPinName", pinId, name);
  window.setPinType = (pinId, type) => callViewer("setPinType", pinId, type);
  window.setPinRole = (pinId, role) => callViewer("setPinRole", pinId, role);
  window.setPinNode = (pinId, node) => callViewer("setPinNode", pinId, node);
  window.setPinRail = (pinId, railId) => callViewer("setPinRail", pinId, railId);
  window.setPinGround = (pinId, isGround) => callViewer("setPinGround", pinId, isGround);
  window.setPinTestPoint = (pinId, isTestPoint) => callViewer("setPinTestPoint", pinId, isTestPoint);
  window.setPinRadius = (pinId, radius) => callViewer("setPinRadius", pinId, radius);
  window.deleteSelectedPin = () => callViewer("deleteSelectedPin");
  window.moveSelectedPinTo = (x, y) => callViewer("moveSelectedPinTo", x, y);
  window.moveSelectedPinOnNextClick = () => callViewer("moveSelectedPinOnNextClick");
  window.exportEditedComponentPins = () => callViewer("exportEditedComponentPins");
  window.exportEditedComponentPinsJson = () => callViewer("exportEditedComponentPinsJson") || "";
  window.exportCreatedPins = () => callViewer("exportCreatedPins");
  window.exportCreatedPinsJson = () => callViewer("exportCreatedPinsJson") || "";
  window.exportSelectedComponentPatch = () => callViewer("exportSelectedComponentPatch");
  window.dumpEditedComponent = () => callViewer("dumpEditedComponent");
  window.getSelectedComponentId = () => callViewer("getSelectedComponentId");
  window.getSelectedComponent = () => callViewer("getSelectedComponent");
  window.dumpSelectedComponentPins = () => callViewer("dumpSelectedComponentPins") || [];
  window.dumpSelectedPin = () => callViewer("dumpSelectedPin");
  window.debugPinEditorState = () => callViewer("debugPinEditorState");
  window.debugPinPlacementState = () => callViewer("debugPinPlacementState");

  window.enableAuthoringMode = () => callViewer("enableAuthoringMode");
  window.disableAuthoringMode = () => callViewer("disableAuthoringMode");
  window.setAuthoringTool = (toolName) => callViewer("setAuthoringTool", toolName);
  window.debugAuthoringState = () => callViewer("debugAuthoringState");

  return {
    enablePadPicker: window.enablePadPicker,
    disablePadPicker: window.disablePadPicker,
    listPickedPads: window.listPickedPads,
    clearPickedPads: window.clearPickedPads,
    removeLastPickedPad: window.removeLastPickedPad,
    exportPickedPads: window.exportPickedPads,
    exportPickedPadsJson: window.exportPickedPadsJson,
    enableComponentPinEditor: window.enableComponentPinEditor,
    disableComponentPinEditor: window.disableComponentPinEditor,
    enablePinPlacementMode: window.enablePinPlacementMode,
    disablePinPlacementMode: window.disablePinPlacementMode,
    editComponentPins: window.editComponentPins,
    listComponentPins: window.listComponentPins,
    listCreatedPins: window.listCreatedPins,
    removeLastCreatedPin: window.removeLastCreatedPin,
    clearCreatedPins: window.clearCreatedPins,
    selectPin: window.selectPin,
    selectCreatedPin: window.selectCreatedPin,
    renamePin: window.renamePin,
    setPinName: window.setPinName,
    setPinType: window.setPinType,
    setPinRole: window.setPinRole,
    setPinNode: window.setPinNode,
    setPinRail: window.setPinRail,
    setPinGround: window.setPinGround,
    setPinTestPoint: window.setPinTestPoint,
    setPinRadius: window.setPinRadius,
    deleteSelectedPin: window.deleteSelectedPin,
    moveSelectedPinTo: window.moveSelectedPinTo,
    moveSelectedPinOnNextClick: window.moveSelectedPinOnNextClick,
    exportEditedComponentPins: window.exportEditedComponentPins,
    exportEditedComponentPinsJson: window.exportEditedComponentPinsJson,
    exportCreatedPins: window.exportCreatedPins,
    exportCreatedPinsJson: window.exportCreatedPinsJson,
    exportSelectedComponentPatch: window.exportSelectedComponentPatch,
    dumpEditedComponent: window.dumpEditedComponent,
    getSelectedComponentId: window.getSelectedComponentId,
    getSelectedComponent: window.getSelectedComponent,
    dumpSelectedComponentPins: window.dumpSelectedComponentPins,
    dumpSelectedPin: window.dumpSelectedPin,
    debugPinEditorState: window.debugPinEditorState,
    debugPinPlacementState: window.debugPinPlacementState,
    enableAuthoringMode: window.enableAuthoringMode,
    disableAuthoringMode: window.disableAuthoringMode,
    setAuthoringTool: window.setAuthoringTool,
    debugAuthoringState: window.debugAuthoringState,
    dumpViewerRuntime: window.dumpViewerRuntime,
  };
}
