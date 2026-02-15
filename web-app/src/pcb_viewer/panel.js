// Sesuaikan path ini jika deepzoom.js ada di folder yang sama
import { createDeepZoomViewer } from "./viewer/deepzoom.js";

let viewerInstance = null;
const API_BASE = "http://127.0.0.1:8080/api";

/**
 * Fungsi inisialisasi utama yang dipanggil oleh main.js
 */
export function initPcbViewerPanel({ mountSelector }) {
    // 1. Pastikan elemen container untuk viewer tersedia
    let el = document.getElementById("pcb-viewer");
    if (!el) {
        el = document.createElement("div");
        el.id = "pcb-viewer";
        // Style dasar agar viewer terlihat
        el.style.width = "100%";
        el.style.height = "100%";
        el.style.position = "relative";
        el.style.backgroundColor = "#1e1e1e";
        
        const mountPoint = document.querySelector(mountSelector) || document.body;
        mountPoint.appendChild(el);
    }

    // Tambahkan kontrol UI untuk memilih board
    initBoardSelector(el);

    console.log("PCB Viewer Panel initialized.");
}

async function initBoardSelector(container) {
    // Mencegah duplikasi kontrol jika init dipanggil ulang
    if (container.querySelector("#pcb-viewer-controls")) return;

    const controls = document.createElement("div");
    controls.id = "pcb-viewer-controls";
    controls.style.position = "absolute";
    controls.style.top = "10px";
    controls.style.left = "10px";
    controls.style.zIndex = "1000";
    controls.style.display = "flex";
    controls.style.gap = "8px";
    container.appendChild(controls);

    try {
        // Fetch daftar board dari API
        const res = await fetch(`${API_BASE}/boards`);
        if (!res.ok) throw new Error("Gagal mengambil daftar board");
        
        const data = await res.json();
        // Handle format array atau object Manifest
        const boards = Array.isArray(data) ? data : (data.boards || []);

        if (boards.length === 0) {
            controls.innerHTML = "<span style='color:white; background:rgba(0,0,0,0.5); padding:4px;'>No boards found</span>";
            return;
        }

        const select = document.createElement("select");
        select.style.padding = "4px";
        
        boards.forEach(b => {
            const opt = document.createElement("option");
            opt.value = b.id;
            opt.textContent = b.name || b.id;
            select.appendChild(opt);
        });

        const loadBtn = document.createElement("button");
        loadBtn.textContent = "Load";
        loadBtn.style.cursor = "pointer";
        loadBtn.onclick = () => loadBoard(select.value);

        controls.appendChild(select);
        controls.appendChild(loadBtn);

        // Auto-load board pertama
        if (boards.length > 0) {
            loadBoard(boards[0].id);
        }

    } catch (e) {
        console.error("Board selector init failed:", e);
        controls.innerHTML = "<span style='color:red; background:rgba(0,0,0,0.5); padding:4px;'>API Error</span>";
    }
}

export async function loadBoard(boardId) {
    try {
        // 1. Ambil data board.json
        const response = await fetch(`${API_BASE}/boards/${boardId}/board`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const board = await response.json();

        // 2. Bersihkan viewer lama jika ada
        if (viewerInstance) {
            if (typeof viewerInstance.destroy === 'function') viewerInstance.destroy();
            viewerInstance = null;
        }

        // 3. Inisialisasi Deep Zoom Viewer
        const el = document.getElementById("pcb-viewer");
        if (el) {
            viewerInstance = await createDeepZoomViewer({ el, board });
            console.log("Viewer berhasil dimuat untuk:", board.name);
        }

        // 4. (Opsional) Ambil data komponen untuk daftar di samping
        const compResponse = await fetch(`${API_BASE}/boards/${boardId}/components`);
        if (compResponse.ok) {
            const components = await compResponse.json();
            renderComponentsList(components);
        }
    } catch (error) {
        console.error("Gagal memuat board:", error);
    }
}

function renderComponentsList(components) {
    console.log(`Loaded ${components.length} components.`);
    // TODO: Implementasi render ke sidebar UI
}