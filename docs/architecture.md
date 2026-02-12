# Architecture Overview
## HP Repair Simulation Engine

Dokumen ini menjelaskan **arsitektur teknis final** dari HP Repair Simulation Engine.
Ini adalah **kontrak desain**, bukan panduan implementasi bebas.

Jika implementasi baru melanggar dokumen ini → **desain dianggap rusak**.

---

## 1. TUJUAN ARSITEKTUR

Engine ini dirancang untuk:

- mensimulasikan **sistem elektronika nyata** (listrik, panas, degradasi)
- melatih **cara berpikir teknisi**, bukan hafalan solusi
- menjaga **ketidakpastian, risiko, dan konsekuensi**
- mencegah shortcut desain, baik dari UI maupun developer

Engine ini **BUKAN**:
- puzzle game
- simulator penggantian komponen
- sistem “benar / salah”
- alat diagnosis otomatis

---

## 2. PRINSIP ARSITEKTURAL (MUTLAK)

### 2.1 Single Source of Truth
- Seluruh kondisi perangkat disimpan di **`PhoneState`**
- Tidak ada status paralel
- Tidak ada cache kebenaran di UI

### 2.2 Time-Step Based Simulation
- Semua perubahan terjadi melalui Δt
- Tidak ada perubahan instan
- Tidak ada `set_value` tanpa proses fisika

### 2.3 No Direct Observation
- Kondisi internal **tidak pernah** dibaca langsung
- Semua observasi **harus melalui Measurement Engine**
- Pengukuran selalu memodifikasi sistem

### 2.4 Separation of Concerns
- Engine tidak tahu UI
- UI tidak tahu kondisi internal
- Konten (scenario) tidak tahu mekanik

---

## 3. STRUKTUR MODUL UTAMA

### 3.1 `state/`
**Satu-satunya sumber kebenaran**

Berisi:
- kondisi listrik
- kondisi thermal
- degradasi material
- stress history
- measurement history
- fault aktif & laten

Tidak boleh:
- flag boolean seperti `is_broken`
- ringkasan “health”

---

### 3.2 `physics/`
**Simulasi fisika berbasis waktu**

- electrical
- thermal
- regulator behavior

Semua efek:
- non-ideal
- memiliki delay
- memiliki noise

---

### 3.3 `fault/`
**Fault sebagai perilaku, bukan status**

- fault berkembang seiring waktu
- fault dipengaruhi panas, arus, stress
- fault dapat memicu fault lain

Tidak ada:
- fault tunggal deterministik
- mapping fault → solusi

---

### 3.4 `measurement/`
**Satu-satunya pintu observasi**

Setiap measurement:
- menyuntik energi
- menambah beban
- menambah noise
- meninggalkan jejak stres

Repeated measurement:
- tidak netral
- tidak gratis
- berisiko

---

### 3.5 `analysis/`
**Alat bantu berpikir (opsional)**

- mengolah data pengukuran
- menghasilkan hipotesis jamak
- confidence bisa tinggi tapi salah

Analysis Engine:
- tidak tahu ground truth
- tidak memberi solusi
- bisa dimatikan

---

### 3.6 `world/`
**Konteks dunia & lingkungan**

World Profile menentukan:
- ambient temperature
- humidity
- noise baseline
- ground integrity
- stress amplification

World Profile:
- tidak memicu fault
- tidak mengubah outcome
- tidak mengandung logika

---

### 3.7 `scenario/` & `scenario_dsl/`
**Konteks naratif**

Scenario:
- hanya cerita & batasan
- memilih world profile
- tidak menyentuh fisika

DSL:
- data-only (JSON)
- divalidasi keras
- dilindungi CI

---

### 3.8 `session/`
**Lifecycle sesi (boundary keras)**

- `start.rs` → bootstrap + world lock
- `termination.rs` → kapan sesi berakhir
- `end.rs` → outcome & narrative

Tidak ada modul lain yang boleh:
- mengakhiri sesi
- menentukan outcome

---

### 3.9 `outcome/`
**Refleksi pasca-sesi**

Outcome:
- bukan skor
- bukan penilaian benar/salah
- bahasa refleksi keputusan

Narrative:
- menjelaskan pola keputusan
- tidak memberi hint
- tidak menyarankan tindakan

---

### 3.10 `api/`
**Kontrak Engine ↔ UI**

- hanya expose snapshot
- snapshot berbasis last-seen measurement
- tidak pernah expose ground truth

---

## 4. ALUR DATA RESMI
Player Action
→ PhoneState
→ Simulation Engine (Δt)
→ Fault Engine
→ PhoneState (baru)
→ Measurement Engine
→ Snapshot (UI)


Tidak ada jalur pintas.
Tidak ada update instan.

---

## 5. CONTENT VS ENGINE

- Engine = hukum fisika
- World Profile = kondisi dunia
- Scenario = cerita
- Outcome = refleksi

Konten **tidak boleh**:
- mengubah hukum
- memaksa hasil
- menjanjikan perbaikan

---

## 6. TOOLING & CI

- Scenario DSL divalidasi via CLI
- CI menolak scenario yang melanggar filosofi
- Tidak ada override manual

Tooling:
- tidak tahu engine logic
- tidak tahu fault
- tidak tahu outcome

---

## 7. HAL YANG SENGAJA TIDAK ADA

- tidak ada “win condition”
- tidak ada score
- tidak ada optimal path
- tidak ada perfect play

Ini **bukan bug**.
Ini **inti desain**.

---

## 8. KALIMAT PEGANGAN ARSITEKTUR

> **Engine ini tidak bertanya: “apa yang rusak?”  
> Engine ini bertanya: “apakah keputusanmu masuk akal,
> berdasarkan data yang tidak lengkap,
> alat yang tidak netral,
> dan dunia yang tidak kooperatif?”**

---

## 9. PENUTUP

Jika suatu perubahan membuat:
- sistem selalu bisa diselesaikan
- pengukuran selalu aman
- analisa selalu benar
- pemain selalu puas

→ **perubahan tersebut bertentangan dengan arsitektur ini.**

Lebih baik sistem terasa kejam
daripada berbohong demi kenyamanan.
