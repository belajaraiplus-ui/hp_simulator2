// web-app/src/pcb_viewer/panel.js
const API_BASE = "http://127.0.0.1:8080";

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style") Object.assign(n.style, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, String(v));
  }
  for (const c of children) n.append(c);
  return n;
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return await r.json();
}

export function initPcbViewerPanel({ mountSelector = "body" } = {}) {
  const mount = document.querySelector(mountSelector);
  if (!mount) {
    console.warn("[PCB Viewer] mount not found:", mountSelector);
    return;
  }

  // Panel container (styling dibuat inline agar tidak tergantung CSS existing)
  const panel = el("section", {
    id: "pcb-viewer-panel",
    style: {
      marginTop: "16px",
      padding: "12px",
      border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: "12px",
      background: "rgba(0,0,0,0.15)"
    }
  });

  const title = el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, [
    el("h3", { style: { margin: "0" } }, [document.createTextNode("PCB Viewer")]),
    el("span", { style: { opacity: "0.7", fontSize: "12px" } }, [
      document.createTextNode("Step 1: data + komponen (zoom menyusul)")
    ]),
  ]);

  const status = el("div", { style: { marginTop: "6px", fontSize: "12px", opacity: "0.85" } }, [
    document.createTextNode("Status: idle")
  ]);

  const btnLoad = el("button", {
    style: {
      marginTop: "10px",
      padding: "6px 10px",
      borderRadius: "10px",
      cursor: "pointer",
    }
  }, [document.createTextNode("Load Boards")]);

  const select = el("select", {
    style: { marginLeft: "10px", padding: "6px 10px", borderRadius: "10px" }
  });

  const out = el("pre", {
    style: {
      marginTop: "10px",
      maxHeight: "280px",
      overflow: "auto",
      padding: "10px",
      borderRadius: "10px",
      background: "rgba(0,0,0,0.25)",
      border: "1px solid rgba(255,255,255,0.10)",
      fontSize: "12px"
    }
  }, [document.createTextNode("Klik Load Boards…")]);

  async function loadBoards() {
    status.textContent = "Status: loading boards…";
    try {
      const boards = await fetchJson(`${API_BASE}/api/boards`);
      select.innerHTML = "";
      for (const b of boards) {
        const opt = document.createElement("option");
        opt.value = b.board_id;
        opt.textContent = `${b.display_name} (${b.board_id})`;
        select.append(opt);
      }
      out.textContent = JSON.stringify(boards, null, 2);
      status.textContent = `Status: ${boards.length} board loaded`;
      if (boards.length > 0) {
        await loadComponents(select.value);
      }
    } catch (e) {
      status.textContent = "Status: error";
      out.textContent = String(e);
    }
  }

  async function loadComponents(boardId) {
    status.textContent = `Status: loading components for ${boardId}…`;
    try {
      const comps = await fetchJson(`${API_BASE}/api/boards/${boardId}/components`);
      out.textContent = JSON.stringify(comps, null, 2);
      status.textContent = `Status: ${comps.length} components loaded (${boardId})`;
    } catch (e) {
      status.textContent = "Status: error";
      out.textContent = String(e);
    }
  }

  btnLoad.addEventListener("click", loadBoards);
  select.addEventListener("change", () => loadComponents(select.value));

  panel.append(title, status, el("div", {}, [btnLoad, select]), out);
  mount.append(panel);
}
