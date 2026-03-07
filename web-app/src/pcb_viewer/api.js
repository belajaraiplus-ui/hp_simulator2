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

  return {
    enablePadPicker: window.enablePadPicker,
    disablePadPicker: window.disablePadPicker,
    listPickedPads: window.listPickedPads,
    clearPickedPads: window.clearPickedPads,
    removeLastPickedPad: window.removeLastPickedPad,
    exportPickedPads: window.exportPickedPads,
    exportPickedPadsJson: window.exportPickedPadsJson,
    dumpViewerRuntime: window.dumpViewerRuntime,
  };
}
