// =======================
// IMPORTS
// =======================
import init, { init as wasmInit, dispatch } from "../engine/pkg/engine.js";

// =======================
// CONSTANTS & STATE
// =======================
const history = {
  time: [],
  rails: {},
  thermals: {}
};

const MAX_POINTS = 120;

let lastSnapshot = null;
let running = false;
let loopId = null;

let probe = {
  target: "VBAT"
};

const output = document.getElementById("output");

// =======================
// LOGGING
// =======================
function log(msg) {
  output.textContent += msg + "\n";
  output.scrollTop = output.scrollHeight;
}

// =======================
// INIT
// =======================
async function start() {
  await init();
  wasmInit(0.01);
  log("Engine initialized");
  updateSnapshot();
}

// =======================
// BUTTONS
// =======================
document.getElementById("stepBtn").onclick = () => {
  dispatch(JSON.stringify({ kind: "step" }));
  updateSnapshot();
};

document.getElementById("snapshotBtn").onclick = updateSnapshot;
document.getElementById("btn-run").onclick = startLoop;
document.getElementById("btn-pause").onclick = stopLoop;

// =======================
// LOOP
// =======================
function startLoop() {
  if (running) return;
  running = true;
  log("[RUN]");

  loopId = setInterval(() => {
    dispatch(JSON.stringify({ kind: "step" }));
    updateSnapshot();
  }, 500);
}

function stopLoop() {
  running = false;
  clearInterval(loopId);
  loopId = null;
  log("[PAUSE]");
}

// =======================
// SNAPSHOT PIPELINE
// =======================
function updateSnapshot() {
  const res = dispatch(JSON.stringify({ kind: "snapshot" }));
  const data = JSON.parse(res);

  if (!data.snapshot) {
    log("⚠ Snapshot missing");
    return;
  }

  lastSnapshot = data.snapshot;
  pushHistory(lastSnapshot);
  renderState();
}

// =======================
// HISTORY
// =======================
function pushHistory(snapshot) {
  history.time.push(snapshot.time);
  if (history.time.length > MAX_POINTS) history.time.shift();

  snapshot.rails.forEach(r => {
    history.rails[r.name] ??= [];
    history.rails[r.name].push(r.voltage);
    if (history.rails[r.name].length > MAX_POINTS)
      history.rails[r.name].shift();
  });

  snapshot.thermals.forEach(t => {
    history.thermals[t.zone] ??= [];
    history.thermals[t.zone].push(t.temperature);
    if (history.thermals[t.zone].length > MAX_POINTS)
      history.thermals[t.zone].shift();
  });
}

// =======================
// RENDER (TEXT + VISUAL)
// =======================
function renderState() {
  if (!lastSnapshot) return;

  // TIME
  document.getElementById("time").textContent =
    lastSnapshot.time.toFixed(2);

  // RAILS
  const railsEl = document.getElementById("rails");
  railsEl.innerHTML = "";
  lastSnapshot.rails.forEach(r => {
    const li = document.createElement("li");
    li.textContent = `${r.name}: ${r.voltage.toFixed(2)} V`;
    railsEl.appendChild(li);
  });

  // THERMALS
  const thermalsEl = document.getElementById("thermals");
  thermalsEl.innerHTML = "";
  lastSnapshot.thermals.forEach(t => {
    const li = document.createElement("li");
    li.textContent = `${t.zone}: ${t.temperature.toFixed(5)} °C`;
    thermalsEl.appendChild(li);
  });

  // FAULTS
  const faultsEl = document.getElementById("faults");
  faultsEl.innerHTML = "";
  if (lastSnapshot.faults.length === 0) {
    faultsEl.innerHTML = "<li>None</li>";
  } else {
    lastSnapshot.faults.forEach(f => {
      const li = document.createElement("li");
      li.textContent = f;
      li.style.color = "red";
      faultsEl.appendChild(li);
    });
  }

  // VISUAL ALERT
  document.body.style.border =
    lastSnapshot.faults.length > 0
      ? "5px solid red"
      : "5px solid transparent";

  // GRAPHS
  drawVoltageGraph();
  drawThermalGraph();
}

// =======================
// GRAPHS
// =======================
function drawVoltageGraph() {
  const canvas = document.getElementById("voltageCanvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  Object.entries(history.rails).forEach(([_, values], idx) => {
    ctx.strokeStyle = ["#0f0", "#0ff", "#ff0"][idx % 3];
    ctx.beginPath();

    values.forEach((v, i) => {
      const x = (i / MAX_POINTS) * canvas.width;
      const y = canvas.height - (v / 5) * canvas.height;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });

    ctx.stroke();
  });
}

function drawThermalGraph() {
  const canvas = document.getElementById("thermalCanvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  Object.entries(history.thermals).forEach(([_, values], idx) => {
    ctx.strokeStyle = ["#f00", "#fa0", "#f0f"][idx % 3];
    ctx.beginPath();

    values.forEach((t, i) => {
      const x = (i / MAX_POINTS) * canvas.width;
      const y = canvas.height - (t / 120) * canvas.height;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });

    ctx.stroke();
  });
}

// =======================
// PROBE (FASE 8.4)
// =======================
document.getElementById("probeTarget").onchange = e => {
  probe.target = e.target.value;
};

document.getElementById("probeBtn").onclick = () => {
  const res = dispatch(JSON.stringify({
    kind: "measure",
    tool: "voltage",
    target: probe.target
  }));

  log("[MEASURE] " + res);
  updateSnapshot();
};

// =======================
// START
// =======================
start();
