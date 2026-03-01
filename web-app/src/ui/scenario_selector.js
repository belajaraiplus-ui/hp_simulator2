import { State } from "../state.js";
import { loadScenario } from "../engine/scenario.js";
import { faultSimulator } from "../physics/fault_simulator.js";
import { environmentEffects } from "../physics/effects.js";

const RAW_SCENARIOS = [
  {
    id: "battery_mid_soc_sudden_shutdown",
    title: "Perangkat mati mendadak meskipun baterai masih tersisa",
    world: "NOISY_POWER_ENV",
    complaint: "Perangkat mati tiba-tiba di tengah penggunaan",
    background: "Perangkat digunakan dengan beban tidak tetap; sumber daya eksternal sering berubah",
  },
  {
    id: "battery_sense_data_instability",
    title: "Status baterai berubah-ubah tanpa pola yang konsisten",
    world: "POST_PREVIOUS_REPAIR",
    complaint: "Persentase baterai meloncat tanpa transisi wajar",
    background: "Perangkat pernah dibongkar; baterai pernah dilepas pasang",
  },
  {
    id: "battery_voltage_capacity_mismatch",
    title: "Persentase baterai tidak mencerminkan daya tahan sebenarnya",
    world: "STABLE_LAB",
    complaint: "Persentase baterai turun cepat dalam waktu singkat",
    background: "Baterai terlihat penuh setelah pengisian; perangkat langsung digunakan setelah charger dicabut",
  },
  {
    id: "display_backlight_power_path_failure",
    title: "Layar tampak gelap meskipun sistem berjalan",
    world: "POST_PREVIOUS_REPAIR",
    complaint: "Layar tampak hitam namun masih ada bayangan samar",
    background: "Layar diganti sebelumnya; perangkat sempat menyala normal setelah servis",
  },
  {
    id: "display_emi_induced_ghost_touch",
    title: "Layar merespons sentuhan yang tidak dilakukan pengguna",
    world: "NOISY_POWER_ENV",
    complaint: "Layar melakukan input acak tanpa sentuhan",
    background: "Perangkat sering digunakan sambil terhubung charger dengan kualitas yang bervariasi",
  },
  {
    id: "display_ghost_touch_emi",
    title: "Ghost Touch Saat Dicas",
    world: "HOT_HUMID_WORKSHOP",
    complaint: "Layar bergerak sendiri saat dicas. Kalau charger dicabut, kadang normal.",
    background: "Layar pernah diganti di tempat lain. Pemilik sering pakai charger murah.",
  },
  {
    id: "display_intermittent_touch_zones",
    title: "Sebagian area layar tidak selalu merespons sentuhan",
    world: "POST_PREVIOUS_REPAIR",
    complaint: "Area tertentu layar tidak merespons secara konsisten",
    background: "Perangkat pernah dibongkar; layar dipasang kembali setelah servis",
  },
  {
    id: "display_system_alive_no_image",
    title: "Perangkat menyala namun layar tidak menampilkan gambar",
    world: "POST_PREVIOUS_REPAIR",
    complaint: "Tidak ada tampilan visual di layar",
    background: "Perangkat pernah dibongkar; layar pernah dilepas",
  },
  {
    id: "logic_peripheral_bus_contention",
    title: "Fungsi periferal saling mengganggu saat digunakan bersamaan",
    world: "POST_PREVIOUS_REPAIR",
    complaint: "Satu fungsi periferal gagal saat fungsi lain aktif",
    background: "Perangkat pernah dibongkar; beberapa fungsi periferal tidak konsisten",
  },
  {
    id: "logic_random_reset_without_brownout",
    title: "Perangkat melakukan restart acak tanpa indikasi penurunan daya",
    world: "NOISY_POWER_ENV",
    complaint: "Perangkat restart tiba-tiba",
    background: "Restart terjadi tanpa pola waktu yang jelas",
  },
  {
    id: "logic_timing_margin_collapse_under_heat",
    title: "Perangkat menjadi tidak stabil setelah suhu meningkat",
    world: "HOT_HUMID_WORKSHOP",
    complaint: "Perangkat restart atau freeze setelah panas",
    background: "Perangkat digunakan dalam waktu lama di lingkungan panas",
  },
  {
    id: "mechanical_intermittent_contact",
    title: "Perangkat mati atau berubah perilaku saat digerakkan",
    world: "POST_PREVIOUS_REPAIR",
    complaint: "Perangkat mati saat digoyang ringan",
    background: "Masalah muncul setelah pergerakan tertentu",
  },
  {
    id: "memory_instability_random_boot_failure",
    title: "Perangkat gagal menyala secara acak setelah restart",
    world: "STABLE_LAB",
    complaint: "Perangkat kadang gagal boot",
    background: "Restart dilakukan beberapa kali; kegagalan boot tidak selalu terjadi",
  },
  {
    id: "power_abnormal_idle_current_draw",
    title: "Konsumsi arus meningkat meskipun perangkat dalam kondisi idle",
    world: "HOT_HUMID_WORKSHOP",
    complaint: "Konsumsi arus lebih tinggi dari yang diharapkan saat idle",
    background: "Perangkat terasa hangat meskipun tidak digunakan",
  },
  {
    id: "power_boot_only_under_external_power",
    title: "Perangkat hanya dapat menyala saat terhubung ke sumber daya eksternal",
    world: "HOT_HUMID_WORKSHOP",
    complaint: "Perangkat dapat menyala hanya saat terhubung charger atau PSU",
    background: "Perangkat digunakan hingga mati; pengisian dilakukan di lingkungan panas",
  },
  {
    id: "power_fake_charging_charge_illusion",
    title: "Indikator pengisian muncul, namun kapasitas baterai tidak bertambah",
    world: "NOISY_POWER_ENV",
    complaint: "Ikon pengisian daya muncul saat charger terhubung",
    background: "Pengisian dilakukan di lingkungan dengan kualitas listrik tidak stabil",
  },
  {
    id: "power_thermal_escalation_during_charging",
    title: "Perangkat cepat panas dan berhenti mengisi saat proses pengisian",
    world: "HOT_HUMID_WORKSHOP",
    complaint: "Suhu perangkat meningkat signifikan saat pengisian",
    background: "Perangkat sering digunakan sambil mengisi daya",
  },
  {
    id: "power_total_failure_zero_current",
    title: "Perangkat mati total dan tidak menunjukkan konsumsi arus",
    world: "POST_PREVIOUS_REPAIR",
    complaint: "Perangkat tidak merespons tombol daya",
    background: "Perangkat tidak dapat dinyalakan sejak terakhir digunakan",
  },
  {
    id: "rf_baseband_functional_but_isolated",
    title: "Perangkat mendeteksi modul jaringan namun tidak dapat terhubung",
    world: "STABLE_LAB",
    complaint: "Informasi jaringan terdeteksi namun koneksi tidak berjalan",
    background: "Perangkat dinyalakan ulang beberapa kali tanpa perubahan",
  },
  {
    id: "rf_no_service_intermit",
    title: "No Service, Sinyal Kadang Muncul",
    world: "HOT_HUMID_WORKSHOP",
    complaint: "SIM terbaca, tapi tidak ada sinyal. Kadang muncul sebentar lalu hilang lagi.",
    background: "Perangkat pernah jatuh dan lama dipakai panas",
  },
  {
    id: "rf_no_service_intermittent",
    title: "Perangkat mendeteksi kartu SIM namun tidak mendapatkan layanan jaringan",
    world: "POST_PREVIOUS_REPAIR",
    complaint: "Indikator sinyal muncul lalu hilang berulang",
    background: "Perangkat pernah terjatuh; sinyal sebelumnya tidak bermasalah",
  },
  {
    id: "rf_power_path_instability",
    title: "Sinyal menurun drastis saat perangkat mencoba terhubung",
    world: "NOISY_POWER_ENV",
    complaint: "Sinyal turun saat panggilan atau data aktif",
    background: "Perangkat terasa hangat saat transmisi data",
  },
  {
    id: "security_secure_subsystem_lockout",
    title: "Perangkat terkunci dan tidak dapat digunakan meskipun menyala",
    world: "STABLE_LAB",
    complaint: "Akses ke sistem dibatasi",
    background: "Pembaruan sistem dilakukan sebelumnya; tidak ada kerusakan fisik",
  },
  {
    id: "storage_progressive_degradation",
    title: "Kinerja perangkat menurun dan menjadi tidak stabil seiring waktu",
    world: "HOT_HUMID_WORKSHOP",
    complaint: "Aplikasi sering lambat atau tidak merespons",
    background: "Penurunan performa terjadi bertahap",
  },
  {
    id: "swhw_interaction_runaway",
    title: "Perangkat menunjukkan kegagalan berulang hanya pada kondisi tertentu",
    world: "NOISY_POWER_ENV",
    complaint: "Kegagalan terjadi berulang pada kondisi spesifik",
    background: "Perangkat kembali normal saat kondisi pemicu diubah",
  },
  {
    id: "thermal_localized_hotspot",
    title: "Satu area perangkat menjadi sangat panas tanpa beban tinggi",
    world: "HOT_HUMID_WORKSHOP",
    complaint: "Panas terkonsentrasi di area tertentu",
    background: "Tidak ada aktivitas berat saat hotspot muncul",
  },
  {
    id: "thermal_systemic_inefficiency",
    title: "Perangkat cepat panas karena pelepasan panas tidak efektif",
    world: "POST_PREVIOUS_REPAIR",
    complaint: "Perangkat cepat panas dalam penggunaan ringan",
    background: "Perangkat pernah dibongkar; suhu meningkat lebih cepat dari biasanya",
  },
  {
    id: "water_damage_progressive",
    title: "Bekas Air, Masih Nyala",
    world: "HOT_HUMID_WORKSHOP",
    complaint: "HP kadang mati sendiri. Setelah dikeringkan sempat normal, tapi sekarang makin sering bermasalah.",
    background: "Perangkat pernah terkena air hujan dan hanya dikeringkan tanpa dibongkar",
  },
  {
    id: "water_progressive_electrochemical_corrosion",
    title: "Perangkat mengalami masalah bertahap setelah paparan cairan",
    world: "POST_WATER_EXPOSURE",
    complaint: "Fungsi tertentu berhenti bekerja secara bertahap",
    background: "Masalah muncul beberapa hari setelah perangkat terkena cairan",
  },
];

function worldToDifficulty(world) {
  switch (world) {
    case "STABLE_LAB":
      return "easy";
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

function worldToTools(world) {
  if (world === "STABLE_LAB") return "Multimeter, PSU, dan Oscilloscope tersedia.";
  if (world === "POST_WATER_EXPOSURE") return "Multimeter dan PSU tersedia. Pengukuran agresif berisiko.";
  if (world === "NOISY_POWER_ENV") return "Multimeter dan PSU tersedia. Hasil ukur dapat terdistorsi noise.";
  return "Multimeter dan PSU tersedia. Oscilloscope terbatas tergantung kebutuhan kasus.";
}

function worldToTimePressure(world) {
  if (world === "STABLE_LAB") return "Tekanan waktu rendah.";
  if (world === "HOT_HUMID_WORKSHOP") return "Tekanan waktu sedang hingga tinggi.";
  return "Tekanan waktu sedang.";
}

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

export const SCENARIOS = [
  defaultScenario,
  ...RAW_SCENARIOS.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.title,
    complaint: s.complaint || "Keluhan tidak tersedia.",
    background: s.background || "Latar tidak tersedia.",
    tools: worldToTools(s.world),
    timeLimit: worldToTimePressure(s.world),
    difficulty: worldToDifficulty(s.world),
  })),
];

let currentScenario = SCENARIOS[0];

function domainFromScenarioId(id) {
  const prefix = String(id || "").split("_")[0];
  switch (prefix) {
    case "battery":
      return "Battery";
    case "display":
      return "Display";
    case "logic":
      return "Logic";
    case "memory":
      return "Memory";
    case "mechanical":
      return "Mechanical";
    case "power":
      return "Power";
    case "rf":
      return "RF";
    case "security":
      return "Security";
    case "storage":
      return "Storage";
    case "swhw":
      return "SW-HW";
    case "thermal":
      return "Thermal";
    case "water":
      return "Water";
    default:
      return "Other";
  }
}

export function getCurrentScenario() {
  return currentScenario;
}

export function setScenario(scenarioId) {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) return false;

  currentScenario = scenario;
  State.setScenario(scenario);

  loadScenario(scenarioId)
    .then((result) => {
      if (!result?.ok) {
        console.warn("Scenario load returned non-ok:", result);
        return;
      }

      faultSimulator.initializeForScenario(scenarioId);
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
  return SCENARIOS;
}

export function getScenariosByDifficulty(difficulty) {
  return SCENARIOS.filter((s) => s.difficulty === difficulty);
}

export function initScenarioSelector() {
  const select = document.getElementById("scenarioSelect");
  if (!select) {
    console.warn("Scenario selector not found");
    return;
  }

  select.innerHTML = "";

  const freeOpt = document.createElement("option");
  freeOpt.value = defaultScenario.id;
  freeOpt.textContent = defaultScenario.title;
  select.appendChild(freeOpt);

  const grouped = new Map();
  for (const scenario of SCENARIOS.filter((s) => s.id !== "default")) {
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

  select.value = currentScenario.id;
  select.addEventListener("change", (e) => {
    setScenario(e.target.value);
    updateScenarioDisplay();
  });
}

export function updateScenarioDisplay() {
  const label = document.getElementById("boardProfileLabel");
  if (label && currentScenario) {
    const difficultyColors = {
      easy: "#28a745",
      medium: "#ffc107",
      hard: "#fd7e14",
      expert: "#dc3545",
    };
    const color = difficultyColors[currentScenario.difficulty] || "#6c757d";
    label.innerHTML = `<span style="color: ${color}">${currentScenario.title}</span>`;
  }

  const scenarioInfo = document.getElementById("scenarioInfo");
  if (!scenarioInfo || !currentScenario) return;

  let html = `
    <div class="scenario-detail"><strong>Keluhan:</strong> ${currentScenario.complaint}</div>
    <div class="scenario-detail"><strong>Latar:</strong> ${currentScenario.background}</div>
    <div class="scenario-detail"><strong>Tools:</strong> ${currentScenario.tools}</div>
    <div class="scenario-detail"><strong>Waktu:</strong> ${currentScenario.timeLimit}</div>
  `;

  if (currentScenario.hints && currentScenario.hints.length > 0) {
    html += `<div class="scenario-hints"><strong>Catatan:</strong><ul>`;
    currentScenario.hints.forEach((hint) => {
      html += `<li>${hint}</li>`;
    });
    html += `</ul></div>`;
  }

  scenarioInfo.innerHTML = html;
}
