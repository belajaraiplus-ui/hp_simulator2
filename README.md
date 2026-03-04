# HP Simulator

Simulator diagnosis perangkat berbasis web dengan engine kausal. Fokus repo saat ini adalah simulasi power rail, fault injection, dan workflow pengukuran tool (multimeter, probe PCB, PSU).

## Kondisi Repo Saat Ini

- Workspace Rust: `engine` dan `pcb-registry`
- Frontend aktif: `web-app` (Vite)
- Data board: `assets/boards`
- Scenario: `scenarios`
- Validasi metadata dan scenario tersedia di folder `tools`

## Struktur Utama

- `engine/` -> core simulation engine (Rust + wasm-bindgen)
- `pcb-registry/` -> API lokal board data (`127.0.0.1:8080`)
- `web-app/` -> UI simulator (Vite)
- `assets/boards/` -> manifest + metadata board (board/components/rails/topology/thermal/tiles)
- `scenarios/` -> scenario JSON
- `tools/validate-board.mjs` -> validasi metadata board
- `tools/scenario_cli/` -> CLI validasi/inspect scenario
- `docs/` -> dokumentasi arsitektur dan kontrak

## Menjalankan Local Development

Prasyarat:
- Rust toolchain
- Node.js + npm

1. Jalankan backend:

```bash
cargo run -p pcb-registry
```

2. Jalankan frontend:

```bash
npm -C web-app install
npm -C web-app run dev
```

3. Buka URL dari Vite (default `http://127.0.0.1:5173`).

Catatan:
- `web-app/vite.config.js` mem-proxy `/api` ke `http://127.0.0.1:8080`
- Jika data board bukan lokasi default, set env `PCB_DATA_DIR` sebelum menjalankan `pcb-registry`

## Runtime Power (Step 9E-9H)

Fitur runtime power yang aktif di frontend:

- Runtime multimeter `voltage`, `resistance`, `continuity` (rail)
- Runtime disimpan per-board (switch board tidak menghapus fault board lain)
- State power disimpan ke `localStorage` per-board dengan key:
  - `hpSim.power.<board_id>`
- Query URL didukung (otomatis di-apply setelah board aktif load):
  - `?mode=SLEEP`
  - `?fault=VBUS_5V:short,VBAT:open`

Persisted payload:

```json
{
  "system_mode": "S0",
  "faults": {
    "VBAT": { "type": "open" }
  }
}
```

## Debug Runtime (Browser Console)

Global helper tersedia:

```js
window.hpSim.injectFault("VBAT", { type: "short" });
window.hpSim.clearFault("VBAT");
window.hpSim.setSystemMode("SLEEP");
window.hpSim.dumpPower();
```

`dumpPower()` menampilkan runtime termasuk `reason.upstream_status` saat rail drop karena upstream.

## Validasi

Validasi board:

```bash
node tools/validate-board.mjs
```

Validasi scenario:

```bash
cargo run --manifest-path tools/scenario_cli/Cargo.toml -- validate scenarios/display_ghost_touch_emi.json
```

Inspect scenario:

```bash
cargo run --manifest-path tools/scenario_cli/Cargo.toml -- inspect scenarios/display_ghost_touch_emi.json
```

Build frontend:

```bash
npm -C web-app run build
```

## API Lokal pcb-registry

Base URL: `http://127.0.0.1:8080`

- `GET /api/boards`
- `GET /api/boards/:id/board`
- `GET /api/boards/:id/components`
- `GET /api/boards/:id/rails`
- `GET /api/boards/:id/topology`
- `GET /api/boards/:id/thermal`
- `GET /api/boards/:id/tiles/:level/:tile`

## Referensi Dokumen

- `docs/README.md`
- `docs/architecture.md`
- `docs/API_CONTRACT.md`
- `docs/authoring_rules.md`
- `docs/roadmap_v1.md`
- `docs/REALISM_GAP_ANALYSIS_2026-03.md`
