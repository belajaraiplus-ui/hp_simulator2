// web-app/src/assets/loader.js

let boardManifest = null;
let boardCache = new Map();
let componentsCache = new Map();
let railsCache = new Map();
let topologyCache = new Map();
let thermalCache = new Map();

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return res.json();
}

async function loadManifest() {
  if (!boardManifest) {
    boardManifest = await fetchJson('/api/boards');
  }
  return boardManifest;
}

export async function getBoardManifest() {
  return loadManifest();
}

export async function getBoardList() {
  const manifest = await loadManifest();
  return manifest.boards || [];
}

export async function loadBoard(boardId) {
  if (boardCache.has(boardId)) {
    return boardCache.get(boardId);
  }

  try {
    const board = await fetchJson(`/api/boards/${boardId}/board`);
    boardCache.set(boardId, board);
    return board;
  } catch (e) {
    console.error(`Failed to load board ${boardId}:`, e);
    throw e;
  }
}

export async function loadComponents(boardId) {
  if (componentsCache.has(boardId)) {
    return componentsCache.get(boardId);
  }

  try {
    const board = await loadBoard(boardId);
    const url = board.components_url;
    if (!url) {
      return [];
    }
    const data = await fetchJson(url);
    const result = data.components || [];
    componentsCache.set(boardId, result);
    return result;
  } catch (e) {
    console.warn(`Failed to load components for ${boardId}:`, e);
    return [];
  }
}

export async function loadRails(boardId) {
  if (railsCache.has(boardId)) {
    return railsCache.get(boardId);
  }

  try {
    const board = await loadBoard(boardId);
    const url = board.rails_url;
    if (!url) {
      return [];
    }
    const data = await fetchJson(url);
    const result = data.rails || [];
    railsCache.set(boardId, result);
    return result;
  } catch (e) {
    console.warn(`Failed to load rails for ${boardId}:`, e);
    return [];
  }
}

export async function loadTopology(boardId) {
  if (topologyCache.has(boardId)) {
    return topologyCache.get(boardId);
  }

  try {
    const board = await loadBoard(boardId);
    const url = board.topology_url;
    if (!url) {
      return null;
    }
    const data = await fetchJson(url);
    topologyCache.set(boardId, data);
    return data;
  } catch (e) {
    console.warn(`Failed to load topology for ${boardId}:`, e);
    return null;
  }
}

export async function loadThermal(boardId) {
  if (thermalCache.has(boardId)) {
    return thermalCache.get(boardId);
  }

  try {
    const board = await loadBoard(boardId);
    const url = board.thermal_url;
    if (!url) {
      return null;
    }
    const data = await fetchJson(url);
    thermalCache.set(boardId, data);
    return data;
  } catch (e) {
    console.warn(`Failed to load thermal for ${boardId}:`, e);
    return null;
  }
}

export function getTileUrl(boardId, level, x, y) {
  return `/api/boards/${boardId}/tiles/${level}/${x}_${y}.jpg`;
}

export function clearCache(boardId) {
  if (boardId) {
    boardCache.delete(boardId);
    componentsCache.delete(boardId);
    railsCache.delete(boardId);
    topologyCache.delete(boardId);
    thermalCache.delete(boardId);
  } else {
    boardCache.clear();
    componentsCache.clear();
    railsCache.clear();
    topologyCache.clear();
    thermalCache.clear();
  }
}
