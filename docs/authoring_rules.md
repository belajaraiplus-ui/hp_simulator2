# Scenario Authoring Rules
## HP Repair Simulation Engine

Dokumen ini adalah **aturan mutlak** bagi siapa pun yang menulis Scenario DSL.
Ini **bukan panduan kreatif**, tapi **kontrak teknis & filosofis**.

Jika melanggar → scenario **DITOLAK** oleh validator & CI.

---

## 1. TUJUAN SCENARIO (DIKUNCI)

Scenario **BUKAN**:
- puzzle
- soal diagnosa
- daftar fault
- simulasi “bisa diselesaikan”

Scenario **ADALAH**:
> **konteks dunia nyata yang memaksa teknisi berpikir,
> mengambil risiko,
> dan menerima konsekuensi dari data yang tidak lengkap.**

---

## 2. APA YANG BOLEH ADA DI SCENARIO

Scenario DSL **HANYA BOLEH** berisi:

- keluhan pelanggan (*customer_complaint*)
- cerita latar singkat (*background_story*)
- pilihan **World Profile** (by name)
- batasan naratif:
  - alat yang tersedia
  - tekanan waktu
- catatan non-teknis (*notes*)

Semua isi harus:
- bersifat **deskriptif**
- bisa salah tafsir
- tidak menjanjikan solusi

---

## 3. APA YANG DILARANG KERAS

Scenario **DILARANG MENYEBUT**:

### 🔧 Komponen & Fault Teknis
Contoh kata terlarang:
- IC, PA, PMIC, baseband, CPU, RAM
- short, konslet, jalur putus
- rusak, mati total (sebagai diagnosis)

### 🛠️ Solusi atau Tindakan
- “harus diganti”
- “solusinya adalah”
- “ukur di titik X”
- “coba injeksi”

### 🎯 Outcome atau Hint
- “biasanya ini penyebabnya”
- “kemungkinan besar”
- “sering terjadi karena…”

📌 **Scenario tidak boleh mengarahkan pemain.**

---

## 4. ATURAN WORLD PROFILE

- Scenario **hanya boleh memilih** world_profile yang tersedia
- Scenario **tidak boleh**:
  - mengubah parameter dunia
  - menyesuaikan dunia demi cerita
- World Profile **bukan alat balancing**

> Dunia bersifat objektif.  
> Scenario hanya hidup di dalamnya.

---

## 5. PANJANG & GAYA TEKS

### Customer Complaint
- pendek
- seperti ucapan pelanggan
- boleh emosional atau ambigu

### Background Story
- 1–2 paragraf pendek
- berbasis riwayat penggunaan / lingkungan
- **bukan analisa teknisi**

### Notes
- opsional
- berisi peringatan konseptual
- **tidak teknis**

---

## 6. FILOSOFI YANG HARUS DIJAGA

Penulis scenario **WAJIB MENERIMA** bahwa:

- tidak semua sesi bisa diselesaikan
- berhenti adalah keputusan teknis sah
- pengukuran bisa memperburuk kondisi
- kegagalan bukan bug
- kebingungan adalah bagian dari simulasi

Jika Anda merasa:
> “Scenario ini harus bisa diperbaiki”

→ **Scenario ini salah.**

---

## 7. VALIDASI & CI

Setiap scenario akan:

1. Divalidasi secara struktural (JSON + schema)
2. Diperiksa istilah terlarang
3. DITOLAK jika melanggar filosofi

Tidak ada pengecualian.
Tidak ada override manual.

---

## 8. KALIMAT PEGANGAN (WAJIB DIINGAT)

> **Scenario tidak mengajarkan apa yang harus diganti.  
> Scenario menguji apakah keputusan teknisi masuk akal
> di dunia yang tidak kooperatif.**

---

## 9. JIKA RAGU

Jika Anda ragu menulis sesuatu:

- **hapus**
- atau buat lebih ambigu
- atau pindahkan ke dokumentasi, bukan scenario

Lebih baik scenario **kurang informatif**
daripada **menipu pemain dengan kepastian palsu**.

---

## 10. PENUTUP

Scenario yang baik:
- terasa tidak nyaman
- tidak memberi jawaban
- membuat pemain bertanya pada dirinya sendiri

Jika setelah bermain seseorang berkata:
> “Saya tidak yakin apa yang salah,
> tapi saya tahu kapan saya seharusnya berhenti”

→ **Scenario Anda berhasil.**
