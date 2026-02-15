import { MAX_POINTS } from "../config.js";
import { voltageSmoothed, thermalSmoothed, distressHistory, railVisibility } from "../state.js";
import { hslForIndex } from "../utils.js";

export function createOffscreenCanvas(el) {
  if (!el) return null;
  const off = document.createElement("canvas");
  off.style.display = "none";
  document.body.appendChild(off);
  return off;
}

export function resizeCanvasToDisplaySize(canvas) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  const targetWidth = Math.round(cssWidth * dpr);
  const targetHeight = Math.round(cssHeight * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

export function syncOffscreen(off, visible) {
  if (!off || !visible) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = visible.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width));
  const cssH = Math.max(1, Math.round(rect.height));
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (off.width !== w || off.height !== h) {
    off.width = w;
    off.height = h;
    const ctx = off.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

export function drawVoltageChart(canvas, offscreen) {
  if (!canvas || !offscreen) return;
  syncOffscreen(offscreen, canvas);
  const ctx = offscreen.getContext("2d");
  if (!ctx) return;

  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width, cssH = rect.height;
  ctx.clearRect(0, 0, cssW, cssH);
  drawGridOnCtx(ctx, cssW, cssH);

  const names = Object.keys(voltageSmoothed).filter(n => railVisibility[n] !== false);
  const max = Math.max(5, getMaxFilteredSmoothed(voltageSmoothed, names), 0.0001);

  names.forEach((name, idx) => {
    const color = hslForIndex(idx, Math.max(6, names.length));
    drawSeriesOnCtx(ctx, voltageSmoothed[name], max, color, cssW, cssH);
  });

  const vctx = canvas.getContext("2d");
  if (vctx && offscreen) {
    vctx.clearRect(0, 0, canvas.width, canvas.height);
    vctx.drawImage(offscreen, 0, 0);
  }
}

export function drawThermalChart(canvas, offscreen) {
  if (!canvas || !offscreen) return;
  syncOffscreen(offscreen, canvas);
  const ctx = offscreen.getContext("2d");
  if (!ctx) return;

  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width, cssH = rect.height;
  ctx.clearRect(0, 0, cssW, cssH);
  drawGridOnCtx(ctx, cssW, cssH);

  const names = Object.keys(thermalSmoothed);
  const max = Math.max(120, getMaxFilteredSmoothed(thermalSmoothed, names), 0.0001);

  names.forEach((name, idx) => {
    const color = hslForIndex(idx, Math.max(6, names.length));
    drawSeriesOnCtx(ctx, thermalSmoothed[name], max, color, cssW, cssH);
  });

  const vctx = canvas.getContext("2d");
  if (vctx && offscreen) {
    vctx.clearRect(0, 0, canvas.width, canvas.height);
    vctx.drawImage(offscreen, 0, 0);
  }
}

export function drawDistressChart(canvas, offscreen) {
  if (!canvas || !offscreen) return;
  syncOffscreen(offscreen, canvas);
  const ctx = offscreen.getContext("2d");
  if (!ctx) return;

  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width, cssH = rect.height;
  ctx.clearRect(0, 0, cssW, cssH);
  drawGridOnCtx(ctx, cssW, cssH);

  drawSeriesOnCtx(ctx, distressHistory, 1, "#ff4c4c", cssW, cssH);

  const vctx = canvas.getContext("2d");
  if (vctx && offscreen) {
    vctx.clearRect(0, 0, canvas.width, canvas.height);
    vctx.drawImage(offscreen, 0, 0);
  }
}

function drawGridOnCtx(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 1;
  const spacing = Math.max(12, Math.round(Math.min(width, height) / 12));
  for (let x = 0; x <= width; x += spacing) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, height); ctx.stroke();
  }
  for (let y = 0; y <= height; y += spacing) {
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); ctx.stroke();
  }
  ctx.restore();
}

function drawSeriesOnCtx(ctx, series, max, color, width, height) {
  if (!series || series.length === 0) return;
  const values = series;
  const len = Math.min(values.length, MAX_POINTS);
  const step = Math.max(1, values.length > MAX_POINTS ? (values.length / MAX_POINTS) : 1);

  ctx.save();
  ctx.beginPath();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  let started = false;

  for (let i = 0, drawn = 0; i < values.length && drawn < MAX_POINTS; i += step, drawn++) {
    const v = values[Math.floor(i)];
    if (v == null) { started = false; continue; }
    const x = (drawn / (MAX_POINTS - 1)) * width;
    const y = height - (v / max) * (height - 8);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }

  ctx.stroke();
  ctx.restore();
}

function getMaxFilteredSmoothed(map, allowedKeys) {
  let m = 0;
  allowedKeys.forEach(k => {
    (map[k] || []).forEach(v => { if (v != null && v > m) m = v; });
  });
  return m;
}