import { BOARD_LAYOUT } from "../config.js";
import { selectedBoardComponent, setSelectedBoardComponent } from "../state.js";

export function componentLayoutFor(index, componentId) {
  const direct = BOARD_LAYOUT[componentId];
  if (direct) return direct;

  const col = index % 4;
  const row = Math.floor(index / 4);
  return {
    x: 12 + col * 21,
    y: 18 + row * 18,
    region: "Aux",
  };
}

export function componentCatalogFallbackFromUi(multimeterComponentEl) {
  if (!multimeterComponentEl) return [];
  const list = [];
  for (const opt of multimeterComponentEl.options) {
    const id = (opt.value || "").toLowerCase();
    if (!id) continue;
    list.push({
      id,
      label: opt.textContent || id,
      rail: "Unknown",
    });
  }
  return list;
}

export function renderMotherboardMap(snapshot, elements) {
  const { motherboardMapEl, boardProfileLabelEl, multimeterComponentEl, multimeterTargetTypeEl } = elements;
  if (!motherboardMapEl) return;
  
  const profile = snapshot && snapshot.board_profile ? snapshot.board_profile : null;
  const snapshotCatalog = snapshot && Array.isArray(snapshot.component_catalog)
    ? snapshot.component_catalog
    : [];
  const catalog = snapshotCatalog.length ? snapshotCatalog : componentCatalogFallbackFromUi(multimeterComponentEl);

  if (boardProfileLabelEl) {
    boardProfileLabelEl.textContent = profile
      ? `Board: ${profile.display_name}`
      : "Board: Generic Service Board";
  }

  motherboardMapEl.innerHTML = "";
  if (!catalog.length) {
    const empty = document.createElement("div");
    empty.className = "small";
    empty.style.padding = "10px";
    empty.textContent = "No component catalog available.";
    motherboardMapEl.appendChild(empty);
    return;
  }

  const seenRegions = new Set();
  catalog.forEach((item, index) => {
    const layout = componentLayoutFor(index, item.id);
    if (layout.region && !seenRegions.has(layout.region)) {
      seenRegions.add(layout.region);
      const regionEl = document.createElement("div");
      regionEl.className = "board-region";
      regionEl.textContent = layout.region;
      regionEl.style.left = `${Math.max(2, layout.x - 12)}%`;
      regionEl.style.top = `${Math.max(2, layout.y - 10)}%`;
      motherboardMapEl.appendChild(regionEl);
    }

    const node = document.createElement("button");
    node.type = "button";
    node.className = "board-node";

    const idLower = item.id.toLowerCase();
    if (idLower.startsWith("c_")) node.classList.add("comp-c");
    else if (idLower.startsWith("r_")) node.classList.add("comp-r");
    else if (idLower.startsWith("tp_")) node.classList.add("comp-tp");
    else if (idLower.startsWith("j_") || idLower.startsWith("l_")) node.classList.add("comp-j");
    else node.classList.add("comp-j");

    if (selectedBoardComponent === item.id) {
      node.classList.add("active");
    }
    node.style.left = `${layout.x}%`;
    node.style.top = `${layout.y}%`;
    
    node.setAttribute("data-label", item.label || item.id);
    if (!node.classList.contains("comp-j")) node.textContent = "";
    else node.textContent = (item.label || item.id).substring(0,1);

    node.addEventListener("click", () => {
      setSelectedBoardComponent(item.id);
      if (multimeterTargetTypeEl) {
        multimeterTargetTypeEl.value = "component";
        multimeterTargetTypeEl.dispatchEvent(new Event("change"));
      }
      if (multimeterComponentEl) {
        multimeterComponentEl.value = item.id;
      }
      // Re-render to update active class
      renderMotherboardMap(snapshot, elements);
    });
    motherboardMapEl.appendChild(node);
  });
}