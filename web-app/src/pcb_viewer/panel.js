// web-app/src/pcb_viewer/panel.js
import { createDeepZoomViewer } from "./viewer/deepzoom.js";

let viewerInstance = null;
const API_BASE = "http://127.0.0.1:8080/api"; 

export function initPcbViewerPanel({ mountSelector, onBoardReady }) {
    const mountPoint = document.querySelector(mountSelector);
    if (!mountPoint) return;

    // Bersihkan kontainer dan buat struktur UI Load Board
    mountPoint.innerHTML = `
        <div id="pcb-viewer-ui" style="position: absolute; top: 15px; left: 15px; z-index: 1000; background: rgba(30,30,30,0.9); padding: 10px; border-radius: 6px; display: flex; gap: 10px; border: 1px solid #444;">
            <select id="board-select" style="background: #333; color: white; border: 1px solid #555; padding: 5px;"></select>
            <button id="btn-load-pcb" style="background: #007acc; color: white; border: none; padding: 5px 15px; cursor: pointer; border-radius: 4px;">LOAD</button>
        </div>
        <div id="pcb-canvas-target" style="width: 100%; height: 100%;"></div>
    `;

    const select = mountPoint.querySelector("#board-select");
    const loadBtn = mountPoint.querySelector("#btn-load-pcb");

    // Fetch daftar board dari Backend Rust
    fetch(`${API_BASE}/boards`).then(r => r.json()).then(boards => {
        select.innerHTML = boards.map(b => `<option value="${b.id}">${b.name || b.id}</option>`).join("");
    });

    loadBtn.onclick = async () => {
        const boardId = select.value;
        const res = await fetch(`${API_BASE}/boards/${boardId}/board`);
        const boardData = await res.json();

        if (viewerInstance) viewerInstance.destroy();
        
        viewerInstance = await createDeepZoomViewer({ 
            el: mountPoint.querySelector("#pcb-canvas-target"), 
            board: boardData 
        });

        // Ambil komponen untuk sinkronisasi main.js
        const compRes = await fetch(`${API_BASE}/boards/${boardId}/components`);
        const components = await compRes.json();
        if (onBoardReady) onBoardReady({ board: boardData, components });
    };
}