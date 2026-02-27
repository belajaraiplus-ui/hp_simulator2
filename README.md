# HP Simulator

Simulator berbasis web untuk melatih pengambilan keputusan teknis pada diagnosis perangkat HP/laptop, dengan engine simulasi kausal (bukan panduan reparasi instan).

## Status Project Saat Ini

- Workspace Rust berisi 2 crate utama: `engine` dan `pcb-registry`
- Frontend aktif ada di `web-app` (Vite)
- Data board ada di `assets/boards` (manifest + metadata board)
- Skenario ada di folder `scenarios`
- Tool validasi tersedia untuk board metadata dan scenario DSL

## Struktur Utama

- `engine/` -> core simulation engine (Rust + wasm-bindgen)
- `pcb-registry/` -> HTTP API lokal untuk data board (`127.0.0.1:8080`)
- `web-app/` -> UI simulator (Vite, proxy `/api` ke `pcb-registry`)
- `assets/boards/` -> data board, komponen, rails, topology, tiles
- `scenarios/` -> file scenario JSON
- `tools/validate-board.mjs` -> validator metadata board
- `tools/scenario_cli/` -> CLI validasi/inspeksi scenario DSL
- `docs/` -> arsitektur, kontrak API, aturan authoring

## Prasyarat

- Rust toolchain
- Node.js + npm

## Menjalankan Project (Local Development)

1. Jalankan backend registry board:

```bash
cargo run -p pcb-registry
```

2. Jalankan frontend:

```bash
npm -C web-app install
npm -C web-app run dev
```

3. Buka aplikasi dari URL Vite (default `http://127.0.0.1:5173` atau sesuai output terminal).

Catatan:
- `web-app/vite.config.js` sudah mem-proxy `/api` ke `http://127.0.0.1:8080`
- Jika lokasi data board non-default, set env var `PCB_DATA_DIR` sebelum menjalankan `pcb-registry`

## Validasi Data

Validasi metadata board:

```bash
node tools/validate-board.mjs
```

Validasi scenario DSL:

```bash
cargo run --manifest-path tools/scenario_cli/Cargo.toml -- validate scenarios/display_ghost_touch_emi.json
```

Inspect scenario DSL:

```bash
cargo run --manifest-path tools/scenario_cli/Cargo.toml -- inspect scenarios/display_ghost_touch_emi.json
```

## API Lokal (pcb-registry)

Base URL: `http://127.0.0.1:8080`

Endpoint utama:
- `GET /api/boards`
- `GET /api/boards/:id/board`
- `GET /api/boards/:id/components`
- `GET /api/boards/:id/rails`
- `GET /api/boards/:id/topology`
- `GET /api/boards/:id/thermal`
- `GET /api/boards/:id/tiles/:level/:tile`

## Dokumentasi

- `docs/README.md`
- `docs/architecture.md`
- `docs/API_CONTRACT.md`
- `docs/authoring_rules.md`
- `docs/roadmap_v1.md`
