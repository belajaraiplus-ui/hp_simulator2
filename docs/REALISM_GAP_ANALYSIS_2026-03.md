# Analisis Mendalam Fondasi Simulator Reparasi HP (Baseline 2026-03)

Dokumen ini menyajikan audit teknis + produk untuk menyiapkan simulator menuju target **“identik dengan dunia nyata”** secara bertahap, terukur, dan tervalidasi.

## 1) Ringkasan Eksekutif

Status saat ini: fondasi simulasi sudah kuat (engine Rust/WASM, alur measurement, visualisasi board, scenario tooling), tetapi masih ada gap struktur data, konsistensi kontrak, dan validasi lintas lapisan yang menghambat realisme tingkat produksi.

**Kesimpulan utama:**
1. Sistem sudah cukup untuk prototyping dan latihan eksplorasi diagnosis.
2. Sistem belum cukup untuk klaim “identik dunia nyata” karena belum ada:
   - kalibrasi terhadap data lapangan (arus/tegangan/thermal aktual),
   - konsistensi schema scenario end-to-end,
   - quality gate otomatis lintas engine + frontend + konten.

## 2) Kondisi Aktual yang Sudah Kuat

- Arsitektur memisahkan `engine`, `pcb-registry`, dan `web-app` dengan batas tanggung jawab yang jelas. Ini bagus untuk scale dan maintainability.
- Engine sudah memiliki modul inti penting: state, power graph, thermal/electrical physics, measurement, session, scenario, postmortem.
- Frontend sudah mengintegrasikan fitur besar: selector scenario, timeline, export report, save/load session, oscilloscope panel, AI panel.
- Tooling validasi board dan scenario sudah tersedia dan dapat dijalankan via CLI.

## 3) Temuan Gap Kritis (Harus Diselesaikan Dulu)

### 3.1 Ketidaksinkronan kontrak scenario (Engine DSL vs Konten)
- Parser DSL engine menolak unknown fields (`#[serde(deny_unknown_fields)]`) dan mengharapkan schema minimal (`id`, `title`, `world_profile`, `customer_complaint`, `background_story`, `constraints`, `notes`).
- Banyak file scenario memakai struktur berbeda (`domain`, `initial_conditions`, `symptoms`, `author_notes`), sehingga gagal tervalidasi oleh CLI.
- Ini menyebabkan scenario repository tidak menjadi source of truth yang dapat dipercaya untuk pipeline validasi.

**Dampak:** kualitas simulasi naratif tidak terjaga, CI scenario tidak representatif, reproducibility rendah.

### 3.2 Duplikasi sumber scenario (hardcoded UI vs file scenario)
- `web-app/src/ui/scenario_selector.js` memuat daftar scenario hardcoded besar.
- Di sisi lain tersedia folder `scenarios/*.json`, namun schema-nya tidak konsisten dengan parser DSL.

**Dampak:** mudah terjadi drift: UI menampilkan scenario yang tidak tervalidasi/berbeda dari data resmi.

### 3.3 Ketidaksinkronan world profile naming antara validator dan runtime
- Validator scenario CLI hanya menerima sebagian world (`IDEAL_BENCH`, `HOT_HUMID_WORKSHOP`, `PREVIOUSLY_REPAIRED_DEVICE`, `RF_UNSTABLE_ENVIRONMENT`).
- Runtime world preset sudah mendukung world tambahan seperti `STABLE_LAB`, `NOISY_POWER_ENV`, `POST_WATER_EXPOSURE`.

**Dampak:** konten valid di runtime bisa dianggap invalid oleh validator (false negative).

### 3.4 Kesiapan data board belum konsisten terhadap realisme jalur daya
- Validasi board menunjukkan warning orphan rail pada `samsung_galaxy_a55_5g` (mis. `VCHG`, `VSYS`, `VPA`, `VCORE`, `VDISP`, `VIO`).
- Manifest board aktif baru memuat 2 board, padahal repository punya lebih banyak direktori board.

**Dampak:** simulasi topologi daya berpotensi tidak mencerminkan rantai suplai nyata secara menyeluruh.

### 3.5 Kualitas engineering gates masih lemah
- Root workspace belum mengikuti nama standar `Cargo.toml` (masih `cargo.toml`) sehingga perintah standar `cargo test --workspace` gagal.
- `engine` test ada namun masih minim untuk skala sistem; `pcb-registry` belum memiliki unit test.
- Banyak warning dead code pada `engine` dan `pcb-registry`.

**Dampak:** regresi sulit dideteksi dini, evolusi fitur berisiko memecah konsistensi.

## 4) Gap Fitur Menuju “Identik Dunia Nyata”

### 4.1 Yang wajib ditambah (Level Sistem)
1. **Data assimilation loop**: ingest dataset pengukuran real (arus boot curve, charging profile, thermal map) lalu kalibrasi parameter simulator.
2. **Uncertainty model terukur**: noise harus diparameterkan dari distribusi empiris, bukan sekadar konstanta.
3. **Aging + intermittent model**: kerusakan intermittent berbasis state history (vibrasi, thermal cycle, humidity cycle).
4. **Tool interaction realism**: impedansi alat ukur, contact resistance probe, beban injeksi, kabel/drop voltage.
5. **Board-specific fault library**: failure mode per board family (PMIC lane, RF front-end, display path, NAND aging).

### 4.2 Yang wajib ditambah (Level UX latihan teknisi)
1. **Evidence chain**: setiap hipotesis user harus ditautkan ke bukti measurement timeline.
2. **Decision consequence engine**: aksi salah menambah kerusakan sekunder secara kausal.
3. **Session replay deterministik + seed**: untuk audit dan pembelajaran lintas teknisi.
4. **Postmortem yang menjelaskan tradeoff**, bukan “jawaban benar”.

## 5) Rencana Implementasi Bertahap (Roadmap Eksekusi)

### Phase 0 — Stabilkan fondasi kontrak (2 minggu)
- Satu schema scenario resmi (versioned) dipakai oleh: `scenarios/`, scenario CLI, dan UI selector.
- Hapus hardcoded scenario list di UI; ganti menjadi loader dari source data tunggal.
- Samakan daftar world profile di validator dengan world preset runtime.

**Definition of Done:** seluruh file `scenarios/*.json` lolos validasi CLI tanpa pengecualian.

### Phase 1 — Quality gate engineering (2–3 minggu)
- Normalisasi root workspace (`Cargo.toml`) agar standard tooling berjalan.
- Tambah CI matrix: engine tests, scenario validation all files, board validation, frontend build, basic smoke test.
- Target warning budget: warning dead code turun signifikan (atau diisolasi via feature flag/allow yang terkontrol).

**Definition of Done:** pipeline CI hijau konsisten; gagal cepat saat kontrak rusak.

### Phase 2 — Kalibrasi realisme fisik (4–6 minggu)
- Tambah benchmark dataset nyata untuk minimal 3 use case: no power, fake charging, thermal runaway.
- Implement parameter fitting sederhana (least-squares / heuristic search) untuk noise, leakage, thermal dissipation.
- Buat metrik error kuantitatif antara simulasi vs data nyata.

**Definition of Done:** error simulasi terhadap baseline nyata berada di ambang yang disepakati (mis. MAPE/MAE).

### Phase 3 — Realism gameplay & pedagogy (4 minggu)
- Konsekuensi aksi berbasis risk model diperkuat.
- Outcome/postmortem menampilkan reasoning quality (kelengkapan bukti, urutan pengukuran, risiko yang diambil).
- Replay + audit trail siap dipakai untuk review trainer.

**Definition of Done:** sesi dapat diaudit dan direview seperti kasus bengkel nyata, tanpa memberi “jawaban final”.

## 6) KPI Validasi agar Hasil “Valid sebagai Pondasi”

1. **Contract Integrity KPI**
   - 100% scenario lolos schema validator.
   - 0 hardcoded scenario canonical di UI.
2. **Simulation Fidelity KPI**
   - Error tegangan/arus/thermal terhadap data nyata turun per release.
3. **Causal Explainability KPI**
   - Setiap perubahan distress/outcome dapat ditelusuri ke event measurement/tool/fault progression.
4. **Training Usefulness KPI**
   - Reviewer manusia menilai sesi replay “masuk akal teknisi” (rubrik internal).

## 7) Prioritas Backlog (Urutan Eksekusi Disarankan)

1. Sinkronisasi schema scenario + migrasi seluruh file scenario.
2. Unifikasi source scenario di UI dari data file, bukan hardcoded.
3. Sinkronisasi world profile validator vs runtime.
4. Perbaikan topologi rail orphan board A55.
5. Penguatan CI + test coverage + pengurangan dead code.
6. Baru masuk fase kalibrasi data nyata.

## 8) Risiko Jika Langsung “Tambah Fitur” Tanpa Fondasi

- Fitur bertambah tetapi kontrak data tetap pecah (technical illusion of progress).
- Hasil simulasi terlihat meyakinkan di UI namun tidak falsifiable terhadap data nyata.
- Sulit membedakan bug fisika, bug konten, dan bug presentasi.

## 9) Keputusan Arsitektural yang Direkomendasikan Sekarang

1. **Tetapkan scenario schema v2** + migrator otomatis.
2. **Tetapkan realism calibration harness** sebagai komponen resmi repo.
3. **Pisahkan strict mode CI** (wajib hijau) vs exploratory mode (eksperimen).
4. **Terapkan governance data**: setiap board/scenario wajib punya status kualitas (draft/validated/calibrated).

---

Dengan urutan ini, langkah berikutnya akan dibangun di atas fondasi yang terukur dan dapat diuji, sehingga target akhir “simulator reparasi HP yang identik dengan dunia nyata” menjadi realistis untuk dicapai secara engineering.

## 10) Phase 1 Closure Notes (Update)

### A55 orphan rail realism fix
- Root cause: cabang `VCHG -> VSYS -> (VPA/VCORE/VDISP/VIO)` tidak terhubung ke root validator (`VBAT`, `VBUS_5V`, `VPH_PWR`) karena `VCHG` tidak mendeklarasikan parent rail.
- Perbaikan data:
  - `assets/boards/samsung_galaxy_a55_5g/rails.json`: `VCHG.depends_on = ["VBUS_5V"]`.
  - `assets/boards/samsung_galaxy_a55_5g/topology.json`: tambah edge `VBUS_5V -> VCHG` (`kind: "charger"`).
- Hardening validator:
  - orphan rail sekarang dianggap **error** (bukan warning) pada `tools/validate-board.mjs`.
  - pengecualian by-design didukung secara formal lewat `rails.json.validation_exceptions.orphan_rails`.

### Warning budget / dead code isolation
- Untuk Phase 1, dead code model legacy di `pcb-registry/src/model.rs` diisolasi granular dengan `#[allow(dead_code)]` per-item, bukan allow global crate.
- Modul legacy yang belum diaktifkan penuh di `engine` diisolasi per-modul via `#![allow(dead_code)]` (bukan allow global crate), sehingga warning tidak bocor ke build default dan ruang refactor tetap jelas.
- Ditambah guardrail pada CLI scenario (`tools/scenario_cli`) dengan `#![deny(warnings)]` agar regresi warning di crate ini fail-fast.

### CI basic smoke test
- Workflow `Quality Gate` sekarang menambah step smoke test API untuk `pcb-registry` (`/api/boards` dan `/api/scenarios`) agar kontrak runtime dasar tervalidasi, tidak hanya unit test.

### Verifikasi lokal (reproducible)
```bash
cargo test --workspace
cargo run --quiet --manifest-path tools/scenario_cli/Cargo.toml -- validate-all scenarios
node tools/tests/validate-board-orphan.test.mjs
node tools/validate-board.mjs
npm -C web-app run build
```

## 11) Roadmap Detail Phase 2 — Kalibrasi Realisme Fisik (4–6 Minggu)

Tujuan Phase 2 adalah mengubah simulator dari "masuk akal" menjadi "terukur" terhadap baseline nyata.
Fokus utama: dataset benchmark nyata, fitting parameter, dan metrik error kuantitatif.

### 11.1 Scope Deliverable Phase 2

1. **Benchmark dataset nyata (minimal 3 use case):**
   - no power,
   - fake charging,
   - thermal runaway.
2. **Calibration harness** yang bisa menjalankan simulasi batch terhadap dataset baseline.
3. **Parameter fitting sederhana** (least-squares + heuristic search).
4. **Laporan metrik error** per use case + agregat release (MAPE/MAE + metrik termal).

### 11.2 Struktur Kerja dan Artefak yang Harus Dibuat

#### A. Dataset & metadata
- `datasets/phase2/no_power/*.json`
- `datasets/phase2/fake_charging/*.json`
- `datasets/phase2/thermal_runaway/*.json`
- `datasets/phase2/schema/measurement_trace.schema.json`
- `datasets/phase2/README.md`

#### B. Tooling kalibrasi
- `tools/calibration_cli/` (crate/tool terpisah)
  - `ingest` (cek schema + normalisasi unit)
  - `simulate` (jalankan model dengan parameter tertentu)
  - `fit` (least-squares / heuristic search)
  - `report` (keluarkan MAE/MAPE + confidence summary)

#### C. Output evaluasi
- `reports/calibration/<date>/summary.json`
- `reports/calibration/<date>/summary.md`
- `reports/calibration/<date>/plots/*.csv` (opsional untuk visualisasi eksternal)

### 11.3 Spesifikasi Minimum Dataset Benchmark

Untuk tiap trace benchmark, minimal berisi:
- metadata perangkat: `board_id`, `ambient_temp_c`, `humidity`, `battery_soc`, `charger_type`;
- konfigurasi skenario: `use_case`, `world_profile`, `initial_fault_assumption` (opsional);
- seri waktu pengukuran:
  - `timestamp_ms`,
  - `rail_voltage_v` (minimal VBAT, VBUS/VCHG, VSYS),
  - `input_current_a`,
  - `surface_temp_c` (untuk thermal case);
- quality flag:
  - `instrument_grade`,
  - `missing_data_policy`,
  - `outlier_policy`.

**Target kuantitas minimum (Phase 2):**
- per use case: >= 10 trace valid,
- total: >= 30 trace valid,
- tiap trace durasi cukup untuk karakteristik kasus:
  - no power: 5–20 detik,
  - fake charging: 2–10 menit,
  - thermal runaway: sampai fase kenaikan temperatur stabil/plateau.

### 11.4 Parameter Model yang Dikunci untuk Fitting Awal

Parameter yang dikalibrasi dulu (v1):
1. **Noise model**
   - offset measurement,
   - jitter amplitude,
   - bias tergantung arus.
2. **Leakage model**
   - equivalent leakage resistance per domain,
   - suhu vs leakage coupling (koefisien linear awal).
3. **Thermal dissipation model**
   - thermal mass efektif,
   - heat dissipation factor,
   - thermal coupling antar zona utama.

Parameter yang **ditahan tetap** di Phase 2 (belum di-fit):
- seluruh fault progression kompleks,
- efek mekanik intermittent multi-event,
- detail tool-loading nonlinier tingkat lanjut.

### 11.5 Rencana Mingguan (4–6 Minggu)

#### Minggu 1 — Data foundation & schema freeze
- Finalisasi schema dataset benchmark + validator schema.
- Buat pipeline ingest awal (parse + unit normalization + integrity checks).
- Import trace nyata awal untuk 3 use case (minimal 3 trace/use case).

**Exit criteria minggu 1:**
- semua trace lolos schema validator,
- ada laporan data quality awal (missing/outlier coverage).

#### Minggu 2 — Calibration harness MVP
- Implement `simulate` + `report` command untuk batch run.
- Definisikan baseline metric computation (MAE/MAPE voltage-current).
- Hubungkan harness ke parameter config tunggal (`calibration_config.json`).

**Exit criteria minggu 2:**
- bisa membandingkan 1 set parameter vs semua trace,
- report JSON + markdown otomatis terbentuk.

#### Minggu 3 — Fitting loop v1 (least-squares)
- Implement objective function multi-sinyal (V/I/T).
- Jalankan least-squares untuk no power + fake charging.
- Evaluasi sensitivitas parameter (parameter importance sederhana).

**Exit criteria minggu 3:**
- parameter set v1 menghasilkan error lebih baik dari baseline default.

#### Minggu 4 — Heuristic search + thermal tuning
- Tambah heuristic search (grid/random/local search) untuk escape local minima.
- Fokus tuning thermal case (thermal runaway).
- Tambah guard agar parameter tetap dalam boundary fisik realistis.

**Exit criteria minggu 4:**
- 3 use case punya hasil fit yang stabil lintas rerun (seed tetap).

#### Minggu 5 (opsional, jika 5–6 minggu) — Robustness & cross-validation
- Split train/validation per use case.
- Cek overfitting parameter pada trace tertentu.
- Tambah confidence interval sederhana untuk metrik utama.

#### Minggu 6 (opsional) — Packaging for Phase 3
- Bekukan parameter profile `calibrated_v1`.
- Integrasikan report ringkas ke dokumentasi release.
- Siapkan checklist handoff ke tim gameplay/pedagogy.

### 11.6 Metrik Error & Ambang DoD Phase 2

#### Metrik wajib
1. **Voltage MAE** per rail utama (VBAT, VBUS/VCHG, VSYS).
2. **Current MAPE** untuk kurva input current.
3. **Thermal MAE** untuk temperatur permukaan/zona.
4. **Composite score** berbobot lintas use case.

#### Ambang awal (dapat disepakati ulang bersama tim)
- no power:
  - Voltage MAE <= 0.15 V,
  - Current MAE <= 0.08 A.
- fake charging:
  - Current MAPE <= 15%,
  - trend error SOC proxy <= 20%.
- thermal runaway:
  - Thermal MAE <= 3.0 °C,
  - error waktu mencapai threshold panas <= 20%.

**DoD Phase 2 dianggap tercapai jika:**
- semua use case memenuhi ambang minimum,
- hasil validasi tidak regress pada dataset validation split,
- report kalibrasi tersimpan sebagai artefak release.

### 11.7 Risk Register (Khusus Phase 2)

1. **Kualitas data lapangan tidak seragam**
   - mitigasi: quality flag + filtering policy per trace.
2. **Overfitting ke satu board/use case**
   - mitigasi: train/validation split + cap parameter drift.
3. **Runtime kalibrasi terlalu lama**
   - mitigasi: dua mode (`quick-fit` dan `full-fit`).
4. **Model terlalu sederhana untuk menangkap dinamika nyata**
   - mitigasi: catat residual pattern untuk backlog Phase 2.5/3.

### 11.8 Command Verifikasi Phase 2 (Target)

```bash
# 1) validasi dataset
node tools/validate-dataset.mjs datasets/phase2

# 2) evaluasi baseline parameter saat ini
cargo run --manifest-path tools/calibration_cli/Cargo.toml -- simulate --dataset datasets/phase2 --config calibration/default.json

# 3) fitting
cargo run --manifest-path tools/calibration_cli/Cargo.toml -- fit --dataset datasets/phase2 --config calibration/default.json --out calibration/calibrated_v1.json

# 4) report
cargo run --manifest-path tools/calibration_cli/Cargo.toml -- report --dataset datasets/phase2 --config calibration/calibrated_v1.json --out reports/calibration/latest
```

### 11.9 Handoff ke Phase 3

Output Phase 2 yang wajib dibawa ke Phase 3:
- `calibrated_v1.json` (parameter profile resmi),
- `summary.json` metrik error lintas use case,
- daftar residual gap fisika yang belum tertutup,
- rekomendasi prioritas dampak gameplay (mis. konsekuensi diagnosis yang paling sensitif terhadap error model).
