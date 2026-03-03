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
