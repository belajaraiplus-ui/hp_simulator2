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
  window.editComponentPins = (componentId) => callViewer("editComponentPins", componentId);
  window.listComponentPins = () => callViewer("listComponentPins") || [];
  window.selectPin = (pinId) => callViewer("selectPin", pinId);
  window.renamePin = (pinId, newId) => callViewer("renamePin", pinId, newId);
  window.setPinName = (pinId, name) => callViewer("setPinName", pinId, name);
  window.setPinNode = (pinId, node) => callViewer("setPinNode", pinId, node);
  window.setPinRail = (pinId, railId) => callViewer("setPinRail", pinId, railId);
  window.setPinRadius = (pinId, radius) => callViewer("setPinRadius", pinId, radius);
  window.deleteSelectedPin = () => callViewer("deleteSelectedPin");
  window.moveSelectedPinTo = (x, y) => callViewer("moveSelectedPinTo", x, y);
  window.moveSelectedPinOnNextClick = () => callViewer("moveSelectedPinOnNextClick");
  window.exportEditedComponentPins = () => callViewer("exportEditedComponentPins");
  window.exportEditedComponentPinsJson = () => callViewer("exportEditedComponentPinsJson") || "";
  window.dumpEditedComponent = () => callViewer("dumpEditedComponent");
  window.dumpSelectedPin = () => callViewer("dumpSelectedPin");
  window.debugPinEditorState = () => callViewer("debugPinEditorState");

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
    editComponentPins: window.editComponentPins,
    listComponentPins: window.listComponentPins,
    selectPin: window.selectPin,
    renamePin: window.renamePin,
    setPinName: window.setPinName,
    setPinNode: window.setPinNode,
    setPinRail: window.setPinRail,
    setPinRadius: window.setPinRadius,
    deleteSelectedPin: window.deleteSelectedPin,
    moveSelectedPinTo: window.moveSelectedPinTo,
    moveSelectedPinOnNextClick: window.moveSelectedPinOnNextClick,
    exportEditedComponentPins: window.exportEditedComponentPins,
    exportEditedComponentPinsJson: window.exportEditedComponentPinsJson,
    dumpEditedComponent: window.dumpEditedComponent,
    dumpSelectedPin: window.dumpSelectedPin,
    debugPinEditorState: window.debugPinEditorState,
    dumpViewerRuntime: window.dumpViewerRuntime,
  };
}
