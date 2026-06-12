import { State } from "../state.js";
import { loadScenario } from "../engine/scenario.js";
import { environmentEffects } from "../physics/effects.js";

const defaultScenario = {
  id: "default",
  title: "Default - Free Play",
  description: "Mode bebas untuk eksplorasi.",
  complaint: "Tidak ada keluhan spesifik.",
  background: "Sistem berjalan di kondisi netral.",
  tools: "Semua alat tersedia.",
  timeLimit: "Tidak terbatas",
  difficulty: "easy",
};

let scenarios = [defaultScenario];
let currentScenario = defaultScenario;
let scenariosCatalogLoaded = false;
let pendingScenarioId = null;

function worldToDifficulty(world) {
  switch (world) {
    case "STABLE_LAB":
    case "IDEAL_BENCH":
      return "easy";
    case "PREVIOUSLY_REPAIRED_DEVICE":
    case "POST_PREVIOUS_REPAIR":
      return "medium";
    case "HOT_HUMID_WORKSHOP":
    case "NOISY_POWER_ENV":
    case "POST_WATER_EXPOSURE":
      return "hard";
    default:
      return "medium";
  }
}

function domainFromScenarioId(id) {
  const prefix = String(id || "").split("_")[0];
  switch (prefix) {
    case "battery": return "Battery";
    case "display": return "Display";
    case "logic": return "Logic";
    case "memory": return "Memory";
    case "mechanical": return "Mechanical";
    case "power": return "Power";
    case "rf": return "RF";
    case "security": return "Security";
    case "storage": return "Storage";
    case "swhw": return "SW-HW";
    case "thermal": return "Thermal";
    case "water": return "Water";
    default: return "Other";
  }
}

function normalizeScenario(raw) {
  const tools = raw?.constraints?.tools || "Ketersediaan alat ditentukan kondisi bengkel.";
  const timePressure = raw?.constraints?.time_pressure || "sedang";
  return {
    id: raw.id,
    title: raw.title,
    description: raw.title,
    complaint: raw.customer_complaint || "Keluhan tidak tersedia.",
    background: raw.background_story || "Latar tidak tersedia.",
    tools,
    timeLimit: timePressure,
    difficulty: worldToDifficulty(raw.world_profile),
  };
}

async function fetchScenariosFromApi() {
  const res = await fetch("/api/scenarios");
  if (!res.ok) {
    throw new Error(`Failed to fetch scenarios: HTTP ${res.status}`);
  }
  const payload = await res.json();
  if (!Array.isArray(payload)) {
    throw new Error("Invalid scenarios payload");
  }
  return payload.map(normalizeScenario);
}

export function getCurrentScenario() {
  return currentScenario;
}

export function setScenario(scenarioId) {
  const scenario = scenarios.find((s) => s.id === scenarioId);
  if (!scenario) {
    if (!scenariosCatalogLoaded) {
      pendingScenarioId = scenarioId;
    }
    return false;
  }

  pendingScenarioId = null;

  currentScenario = scenario;
  State.setScenario(scenario);

  loadScenario(scenarioId)
    .then((result) => {
      if (!result?.ok) {
        console.warn("Scenario load returned non-ok:", result);
        return;
      }

      if (result.profile) {
        environmentEffects.setEnvironment(
          result.profile.ambient_temperature,
          result.profile.humidity_factor,
          result.profile.emi_noise_floor
        );
      }
      console.log("Scenario and environment initialized:", scenario.title);
    })
    .catch((err) => {
      console.error("Failed to initialize scenario:", scenarioId, err);
    });

  return true;
}

export function getScenarios() {
  return scenarios;
}

export function getScenariosByDifficulty(difficulty) {
  return scenarios.filter((s) => s.difficulty === difficulty);
}

export async function initScenarioSelector() {
  const select = document.getElementById("scenarioSelect");
  if (!select) {
    console.warn("Scenario selector not found");
    return;
  }

  try {
    const remoteScenarios = await fetchScenariosFromApi();
    scenarios = [defaultScenario, ...remoteScenarios];
  } catch (err) {
    console.error("Failed loading scenarios from API, fallback to default only:", err);
    scenarios = [defaultScenario];
  } finally {
    scenariosCatalogLoaded = true;
  }

  select.innerHTML = "";

  const freeOpt = document.createElement("option");
  freeOpt.value = defaultScenario.id;
  freeOpt.textContent = defaultScenario.title;
  select.appendChild(freeOpt);

  const grouped = new Map();
  for (const scenario of scenarios.filter((s) => s.id !== "default")) {
    const domain = domainFromScenarioId(scenario.id);
    if (!grouped.has(domain)) grouped.set(domain, []);
    grouped.get(domain).push(scenario);
  }

  for (const domain of Array.from(grouped.keys()).sort()) {
    const group = document.createElement("optgroup");
    group.label = domain;
    const items = grouped.get(domain).sort((a, b) => a.title.localeCompare(b.title));
    for (const s of items) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.title;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }

  if (pendingScenarioId) {
    const restored = setScenario(pendingScenarioId);
    if (!restored) {
      console.warn("Pending scenario restore failed after catalog load:", pendingScenarioId);
    }
  }

  select.value = currentScenario.id;
  select.addEventListener("change", (e) => {
    setScenario(e.target.value);
    updateScenarioDisplay();
  });
}

export function updateScenarioDisplay() {
  const label = document.getElementById("boardProfileLabel");
  if (label && currentScenario) {
    const difficultyColors = { easy: "#28a745", medium: "#ffc107", hard: "#fd7e14", expert: "#dc3545" };
    const color = difficultyColors[currentScenario.difficulty] || "#6c757d";
    label.innerHTML = `<span style="color: ${color}">${currentScenario.title}</span>`;
  }

  const scenarioInfo = document.getElementById("scenarioInfo");
  if (!scenarioInfo || !currentScenario) return;

  scenarioInfo.innerHTML = `
    <div class="scenario-detail"><strong>Keluhan:</strong> ${currentScenario.complaint}</div>
    <div class="scenario-detail"><strong>Latar:</strong> ${currentScenario.background}</div>
    <div class="scenario-detail"><strong>Tools:</strong> ${currentScenario.tools}</div>
    <div class="scenario-detail"><strong>Waktu:</strong> ${currentScenario.timeLimit}</div>
  `;
}
