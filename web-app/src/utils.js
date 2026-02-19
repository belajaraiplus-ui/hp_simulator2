const COLOR_CACHE = {};

export function clamp01(v) {
  const n = toNumber(v);
  if (n == null) return 0;
  return Math.max(0, Math.min(1, n));
}

export function toNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function trim(arr, maxPoints) {
  while (arr.length > maxPoints) arr.shift();
}

export function lastValue(arr) {
  return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null;
}

export function formatNumber(value, digits = 3) {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(digits);
}

export function debounce(fn, ms = 100) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function hslForIndex(i, total) {
  const key = `${i}:${total}`;
  if (COLOR_CACHE[key]) return COLOR_CACHE[key];

  const hue = Math.round((i * (360 / Math.max(1, total))) % 360);
  const col = `hsl(${hue}deg 70% 55%)`;
  COLOR_CACHE[key] = col;
  return col;
}