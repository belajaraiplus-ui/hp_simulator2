import {
  getBoardList,
  loadBoard as loadBoardData,
  loadComponents,
  loadRailsFile,
  loadTopology,
  loadThermal,
  getTileUrl,
  clearCache,
} from "../../assets/loader.js";
import { buildBoardRuntime } from "./spatial_index.js";

function buildBundle({ boardData, components, railFile, topology, thermal }) {
  const rails = Array.isArray(railFile?.rails) ? railFile.rails : [];
  const board = { ...boardData, components, rails, topology, thermal, railFile };
  const runtime = buildBoardRuntime({
    board: boardData,
    rails,
    components,
    topology,
    thermal,
    railFile,
  });
  return {
    board,
    boardData,
    components,
    rails,
    railFile,
    runtime,
    thermal,
    topology,
  };
}

export async function loadBoardRuntimeBundle(boardId) {
  const boardData = await loadBoardData(boardId);
  const [components, railFile, topology, thermal] = await Promise.all([
    loadComponents(boardId),
    loadRailsFile(boardId),
    loadTopology(boardId),
    loadThermal(boardId),
  ]);
  return buildBundle({ boardData, components, railFile, topology, thermal });
}

export async function refreshBoardRuntimeBundle(boardId, { boardData, topology, thermal }) {
  const [components, railFile] = await Promise.all([
    loadComponents(boardId),
    loadRailsFile(boardId),
  ]);
  return buildBundle({ boardData, components, railFile, topology, thermal });
}

export function createTileUrlResolver(boardData) {
  return (level, x, y) => getTileUrl(boardData, level, x, y);
}

export {
  clearCache,
  getBoardList,
};
