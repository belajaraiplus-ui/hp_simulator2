import {
  PIN_ROLE_OPTIONS,
  PIN_TYPE_OPTIONS,
} from "./constants.js";

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildPinInspectorHTML(pin) {
  return `
    <div class="as-inspector-grid">
      <label class="as-field">
        <span class="as-field-label">ID</span>
        <input type="text" class="as-input" data-field="id" value="${esc(pin.id)}">
      </label>
      <label class="as-field">
        <span class="as-field-label">Name</span>
        <input type="text" class="as-input" data-field="name" value="${esc(pin.name || "")}">
      </label>
      <label class="as-field">
        <span class="as-field-label">Pin Type</span>
        <select class="as-select" data-field="pinType">
          ${PIN_TYPE_OPTIONS.map((v) => `<option value="${v}" ${pin.pinType === v ? "selected" : ""}>${v || "-- none --"}</option>`).join("")}
        </select>
      </label>
      <label class="as-field">
        <span class="as-field-label">Pin Role</span>
        <select class="as-select" data-field="pinRole">
          ${PIN_ROLE_OPTIONS.map((v) => `<option value="${v}" ${pin.pinRole === v ? "selected" : ""}>${v || "-- none --"}</option>`).join("")}
        </select>
      </label>
      <label class="as-field">
        <span class="as-field-label">Node</span>
        <input type="text" class="as-input" data-field="node" value="${esc(pin.node || "")}">
      </label>
      <label class="as-field">
        <span class="as-field-label">Rail ID</span>
        <input type="text" class="as-input" data-field="railId" value="${esc(pin.railId || "")}">
      </label>
      <label class="as-field">
        <span class="as-field-label">Radius</span>
        <input type="number" class="as-input" data-field="radius" value="${pin.radius}" min="1" step="1">
      </label>
      <label class="as-field">
        <span class="as-field-label">X</span>
        <input type="number" class="as-input" data-field="x" value="${pin.x}">
      </label>
      <label class="as-field">
        <span class="as-field-label">Y</span>
        <input type="number" class="as-input" data-field="y" value="${pin.y}">
      </label>
      <label class="as-field as-field-checkbox">
        <input type="checkbox" data-field="isGround" ${pin.isGround ? "checked" : ""}>
        <span>Is Ground</span>
      </label>
      <label class="as-field as-field-checkbox">
        <input type="checkbox" data-field="isTestPoint" ${pin.isTestPoint ? "checked" : ""}>
        <span>Is Test Point</span>
      </label>
    </div>
    <button class="as-btn as-btn-danger as-btn-sm" id="as-delete-pin">Delete Pin</button>
  `;
}

export function buildBoxInspectorHTML(box) {
  return `
    <div class="as-inspector-grid">
      <label class="as-field">
        <span class="as-field-label">Label</span>
        <input type="text" class="as-input" data-field="label" value="${esc(box.label || "")}">
      </label>
      <label class="as-field">
        <span class="as-field-label">Kind</span>
        <input type="text" class="as-input" data-field="kind" value="${esc(box.kind || "")}">
      </label>
      <label class="as-field">
        <span class="as-field-label">Component ID</span>
        <input type="text" class="as-input" data-field="componentId" value="${esc(box.componentId || "")}">
      </label>
      <label class="as-field">
        <span class="as-field-label">Border Color</span>
        <input type="text" class="as-input" data-field="strokeColor" value="${esc(box.style.strokeColor)}" placeholder="rgba(...)">
      </label>
      <label class="as-field">
        <span class="as-field-label">Fill Color</span>
        <input type="text" class="as-input" data-field="fillColor" value="${esc(box.style.fillColor)}" placeholder="rgba(...)">
      </label>
      <label class="as-field">
        <span class="as-field-label">Border Width</span>
        <input type="number" class="as-input" data-field="strokeWidth" value="${box.style.strokeWidth}" min="0" step="1">
      </label>
      <div class="as-field-info">Position: (${box.x}, ${box.y}) Size: ${box.w}x${box.h}</div>
    </div>
    <button class="as-btn as-btn-danger as-btn-sm" id="as-delete-box">Delete Box</button>
  `;
}
