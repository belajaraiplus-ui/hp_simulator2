import { measureTarget as measureBoardTarget } from "../pcb_viewer/measurement_runtime.js";
import {
  createMultimeterUiState,
  normalizeMode as normalizeMultimeterMode,
  playContinuityBeep,
  renderMultimeterPanel,
} from "./multimeter.js";

function formatTime(t) {
  if (t == null) return "0.0s";
  return t.toFixed(1) + "s";
}

function formatValue(val, mode) {
  if (val == null) return "---";
  if (mode?.includes("continuity")) {
    return val > 0 ? "BEEP" : "OL";
  }
  if (mode?.includes("diode")) {
    return val > 0 ? val.toFixed(3) + "V" : "OL";
  }
  if (mode?.includes("ohm") || mode?.includes("resistance")) {
    return val > 1000000 ? "OL" : val.toFixed(1) + "Ohm";
  }
  return val.toFixed(3) + "V";
}

function targetDisplayLabel(target, fallback = "") {
  if (!target) return fallback;
  if (target.type === "component-pin") return target.label || `${target.componentId}:${target.pinId}`;
  if (target.type === "component") return target.label || target.componentId || fallback;
  if (target.type === "probe") {
    const railHint = target.railId ? ` [${target.railId}]` : "";
    return `${target.label || target.probeId || "Probe"}${railHint}`;
  }
  if (target.type === "rail") return target.label || target.railId || fallback;
  if (target.type === "node") return target.label || target.node || target.id || fallback;
  return target.label || target.id || fallback;
}

function cloneMeasurementTarget(target) {
  if (!target || typeof target !== "object") return null;
  return {
    ...target,
    rails: Array.isArray(target.rails) ? [...target.rails] : target.rails,
    pins: Array.isArray(target.pins) ? [...target.pins] : target.pins,
  };
}

function resolveTargetRailHint(target) {
  if (!target) return "";
  if (typeof target.railId === "string" && target.railId.trim()) return target.railId.trim();
  if (Array.isArray(target.rails)) {
    const railId = target.rails.find((value) => typeof value === "string" && value.trim());
    if (railId) return railId.trim();
  }
  return "";
}

export function createMultimeterController({
  elements = {},
  getTime = () => 0,
  getViewerApi = () => null,
  onDiagnosisTarget = () => {},
} = {}) {
  const {
    manualMeasureBtn,
    modeEl,
    targetTypeEl,
    railEl,
    railBEl,
    probePositiveBtn,
    probeNegativeBtn,
    componentEl,
    resultEl,
    modeLabelEl,
    targetLabelEl,
    statusEl,
    helpEl,
    historyEl,
  } = elements;

  let measurementHistoryData = [];
  let currentBoardRuntime = null;
  let currentMeasurementSelection = null;
  let latestMultimeterUiState = createMultimeterUiState();
  let activeProbePolarity = "positive";
  const probeTargets = {
    positive: null,
    negative: null,
  };

  function viewerApi() {
    return getViewerApi?.() || null;
  }

  function renderHistory() {
    if (!historyEl) return;

    if (!measurementHistoryData || measurementHistoryData.length === 0) {
      historyEl.innerHTML = '<div class="measEmpty">No measurements yet</div>';
      return;
    }

    const recent = measurementHistoryData.slice(-20).reverse();
    historyEl.innerHTML = `
      <div class="measHeader">
        <span>Time</span>
        <span>Target</span>
        <span>Value</span>
      </div>
      ${recent.map((m) => `
        <div class="measItem">
          <span class="measTime">${formatTime(m.time)}</span>
          <span class="measTarget">${m.target || "?"}</span>
          <span class="measValue">${m.display_value || formatValue(m.observed_value, m.target)}</span>
          ${(m.noise > 0 || m.stress_added > 0) ? `
            <div class="measMeta">
              ${m.noise > 0 ? `<span class="measNoise">+/-${m.noise.toFixed(3)}</span>` : ""}
              ${m.stress_added > 0 ? `<span class="measStress">${(m.stress_added * 100).toFixed(1)}%</span>` : ""}
            </div>
          ` : ""}
        </div>
      `).join("")}
    `;
  }

  function setHistory(history) {
    measurementHistoryData = Array.isArray(history) ? history : [];
    renderHistory();
  }

  function renderFeedback(result) {
    latestMultimeterUiState = result || createMultimeterUiState();
    renderMultimeterPanel({
      resultEl,
      modeEl: modeLabelEl,
      targetEl: targetLabelEl,
      statusEl,
      helpEl,
    }, latestMultimeterUiState);
  }

  function appendHistoryEntry(result) {
    if (!result?.ok) return;
    measurementHistoryData.push({
      time: getTime?.() ?? 0,
      target: result.historyTarget || result.targetLabel || "?",
      observed_value: result.historyValue,
      display_value: result.displayValue,
      noise: 0,
      stress_added: 0,
    });
    if (measurementHistoryData.length > 200) {
      measurementHistoryData = measurementHistoryData.slice(-200);
    }
    renderHistory();
  }

  function writeProbeInput(inputEl, target, placeholder) {
    if (!inputEl) return;
    inputEl.value = targetDisplayLabel(target, "");
    inputEl.placeholder = placeholder;
    inputEl.dataset.targetType = target?.type || "";
    inputEl.dataset.targetId = target?.id || "";
    inputEl.dataset.railId = resolveTargetRailHint(target);
    inputEl.title = target ? targetDisplayLabel(target) : placeholder;
  }

  function syncProbeInputFields() {
    writeProbeInput(railEl, probeTargets.positive, "Touch red probe on PCB");
    writeProbeInput(railBEl, probeTargets.negative, "Touch black probe on PCB");
  }

  function measurementPairLabel() {
    if (probeTargets.positive && probeTargets.negative) {
      return `${targetDisplayLabel(probeTargets.positive)} -> ${targetDisplayLabel(probeTargets.negative)}`;
    }
    if (probeTargets.positive) return targetDisplayLabel(probeTargets.positive);
    return "None";
  }

  function probePlacementHelp(mode = normalizeMultimeterMode(modeEl?.value || "voltage")) {
    const redReady = Boolean(probeTargets.positive);
    const blackReady = Boolean(probeTargets.negative);
    if (!redReady && !blackReady) return "Arm RED or BLACK, then click measurable points on the PCB.";
    if (!redReady) return "Place the red probe on the point you want to measure.";
    if (!blackReady) return `Place the black probe on the reference point for ${mode} mode.`;
    return `RED on ${targetDisplayLabel(probeTargets.positive)} and BLACK on ${targetDisplayLabel(probeTargets.negative)}. Press MEASURE to read ${mode}.`;
  }

  function updateProbeSelectionFeedback({
    status = "idle",
    mode = normalizeMultimeterMode(modeEl?.value || "voltage"),
    displayValue = latestMultimeterUiState?.displayValue || "--",
  } = {}) {
    renderFeedback({
      ...latestMultimeterUiState,
      mode,
      targetLabel: measurementPairLabel(),
      displayValue,
      status,
      helpText: probePlacementHelp(mode),
      summary: `Mode: ${mode} | Target: ${measurementPairLabel()} | Result: ${displayValue}`,
    });
  }

  function setProbeTarget(polarity, target) {
    const key = polarity === "negative" ? "negative" : "positive";
    probeTargets[key] = cloneMeasurementTarget(target);
    syncProbeInputFields();
    viewerApi()?.setPlacedProbeTargets?.(probeTargets);
  }

  function clearProbeTargets() {
    probeTargets.positive = null;
    probeTargets.negative = null;
    syncProbeInputFields();
    viewerApi()?.setPlacedProbeTargets?.(probeTargets);
  }

  function buildManualMeasurementTarget() {
    if (probeTargets.positive) return cloneMeasurementTarget(probeTargets.positive);
    if (currentMeasurementSelection?.target) return cloneMeasurementTarget(currentMeasurementSelection.target);

    const targetType = targetTypeEl?.value || "rail";
    if (targetType === "component") {
      const componentId = componentEl?.value?.trim();
      if (!componentId) return null;
      const component = currentBoardRuntime?.componentsById?.[componentId] || null;
      return {
        type: "component",
        id: `component:${componentId}`,
        componentId,
        rails: component?.rails || [],
        pins: component?.pins || [],
        label: component?.refdes || component?.label || componentId,
        source: "multimeter-ui",
      };
    }

    const railId = railEl?.dataset?.railId?.trim();
    if (!railId) return null;
    const rail = currentBoardRuntime?.railsById?.[railId] || null;
    return {
      type: "rail",
      id: `rail:${railId}`,
      railId,
      label: rail?.label || railId,
      source: "multimeter-ui",
    };
  }

  function buildReferenceTarget() {
    if (probeTargets.negative) return cloneMeasurementTarget(probeTargets.negative);

    const railId = railBEl?.dataset?.railId?.trim();
    if (!railId) return null;
    const rail = currentBoardRuntime?.railsById?.[railId] || null;
    return {
      type: "rail",
      id: `rail:${railId}`,
      railId,
      label: rail?.label || railId,
      source: "multimeter-ui",
    };
  }

  function syncMultimeterInputsFromTarget(target) {
    if (!target) return;

    if (target.type === "component" || target.type === "component-pin") {
      if (targetTypeEl) {
        targetTypeEl.value = "component";
        targetTypeEl.dispatchEvent(new Event("change"));
      }
      if (componentEl) {
        componentEl.value = target.componentId || "";
      }
      return;
    }

    if (targetTypeEl) {
      targetTypeEl.value = "rail";
      targetTypeEl.dispatchEvent(new Event("change"));
    }
  }

  function syncReferenceInputFromTarget(target) {
    writeProbeInput(railBEl, target, "Touch black probe on PCB");
  }

  function applyActiveProbePolarity() {
    const isNegative = activeProbePolarity === "negative";
    if (probePositiveBtn) {
      probePositiveBtn.classList.toggle("is-active", !isNegative);
      probePositiveBtn.setAttribute("aria-pressed", String(!isNegative));
    }
    if (probeNegativeBtn) {
      probeNegativeBtn.classList.toggle("is-active", isNegative);
      probeNegativeBtn.setAttribute("aria-pressed", String(isNegative));
    }
  }

  function setActiveProbePolarity(polarity = "positive", { focusInput = false } = {}) {
    activeProbePolarity = polarity === "negative" ? "negative" : "positive";
    applyActiveProbePolarity();
    viewerApi()?.setProbePolarity?.(activeProbePolarity);

    if (!focusInput) return;
    if (activeProbePolarity === "negative") {
      railBEl?.focus();
      return;
    }
    railEl?.focus();
  }

  async function performMeasurement(target, { source = "manual" } = {}) {
    const activeTarget = target || buildManualMeasurementTarget();
    const mode = normalizeMultimeterMode(modeEl?.value || "voltage");
    const reference = buildReferenceTarget();

    currentMeasurementSelection = activeTarget
      ? { target: activeTarget, reference, source }
      : currentMeasurementSelection;

    const result = await measureBoardTarget({
      mode,
      target: activeTarget,
      reference,
      boardRuntime: currentBoardRuntime,
    });

    renderFeedback(result);
    onDiagnosisTarget?.(activeTarget);
    if (result?.ok) {
      appendHistoryEntry(result);
      if (result.beep) {
        playContinuityBeep();
      }
    }
    return result;
  }

  function populateComponentOptions(components) {
    if (!componentEl || !Array.isArray(components)) return;
    componentEl.innerHTML = ['<option value="">Select Component</option>']
      .concat(components.map((c) => `<option value="${c.id}">${c.refdes || c.id} (${c.name || c.kind || "Component"})</option>`))
      .join("");
  }

  function resetForBoard({ runtime = null, mode = normalizeMultimeterMode(modeEl?.value || "voltage") } = {}) {
    currentBoardRuntime = runtime;
    currentMeasurementSelection = null;
    clearProbeTargets();
    renderFeedback({
      ...createMultimeterUiState(),
      mode,
      summary: `Mode: ${mode} | Target: None | Result: --`,
      helpText: "Place the red and black probes on measurable points on the motherboard.",
    });
  }

  function handleTargetSelected(detail = {}) {
    const target = detail.target || null;
    currentBoardRuntime = detail.boardRuntime || currentBoardRuntime;

    if (activeProbePolarity === "negative") {
      setProbeTarget("negative", target);
      syncReferenceInputFromTarget(target);
      updateProbeSelectionFeedback();
      return;
    }

    if (!target) return;
    setProbeTarget("positive", target);
    currentMeasurementSelection = {
      target: cloneMeasurementTarget(target),
      reference: buildReferenceTarget(),
      source: detail.source || "board",
    };
    syncMultimeterInputsFromTarget(target);
    updateProbeSelectionFeedback();
  }

  function handlePickMissed() {
    renderFeedback({
      ok: false,
      mode: normalizeMultimeterMode(modeEl?.value || "voltage"),
      targetLabel: measurementPairLabel(),
      displayValue: "--",
      status: "warning",
      helpText: "No measurable target was found at the clicked position.",
      summary: "Click landed outside probe, component, and rail geometry.",
    });
  }

  function installEventListeners() {
    renderFeedback(latestMultimeterUiState);
    if (targetTypeEl) {
      targetTypeEl.addEventListener("change", () => {
        const isComponent = targetTypeEl.value === "component";
        if (componentEl) componentEl.disabled = !isComponent;
      });
      targetTypeEl.dispatchEvent(new Event("change"));
    }

    if (modeEl) {
      modeEl.addEventListener("change", () => {
        const mode = normalizeMultimeterMode(modeEl.value);
        updateProbeSelectionFeedback({ mode });
      });
    }

    applyActiveProbePolarity();
    syncProbeInputFields();
    probePositiveBtn?.addEventListener("click", () => setActiveProbePolarity("positive", { focusInput: true }));
    probeNegativeBtn?.addEventListener("click", () => setActiveProbePolarity("negative", { focusInput: true }));
    railEl?.addEventListener("focus", () => setActiveProbePolarity("positive"));
    railEl?.addEventListener("pointerdown", () => setActiveProbePolarity("positive"));
    railBEl?.addEventListener("focus", () => setActiveProbePolarity("negative"));
    railBEl?.addEventListener("pointerdown", () => setActiveProbePolarity("negative"));

    window.addEventListener("pcb:measurement-target-selected", (evt) => {
      handleTargetSelected(evt?.detail || {});
    });
    window.addEventListener("pcb:pick-missed", handlePickMissed);

    if (manualMeasureBtn) {
      manualMeasureBtn.onclick = async () => {
        await performMeasurement(currentMeasurementSelection?.target || null, { source: "manual" });
      };
    }
  }

  return {
    buildManualMeasurementTarget,
    clearProbeTargets,
    getBoardRuntime: () => currentBoardRuntime,
    getSelection: () => currentMeasurementSelection,
    getUiState: () => latestMultimeterUiState,
    installEventListeners,
    performMeasurement,
    populateComponentOptions,
    renderFeedback,
    renderHistory,
    resetForBoard,
    setBoardRuntime: (runtime) => {
      currentBoardRuntime = runtime || null;
    },
    setHistory,
  };
}
