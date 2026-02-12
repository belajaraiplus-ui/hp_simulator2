# Roadmap v1.0 — Negative Roadmap
## HP Repair Simulation

Dokumen ini menjelaskan **fitur, mekanik, dan arah desain**
yang **SECARA SENGAJA TIDAK AKAN DIBUAT** pada versi 1.0.

Jika suatu usulan termasuk daftar di bawah,
maka usulan tersebut **ditolak secara prinsip**, bukan karena keterbatasan waktu.

---

## 1. YANG TIDAK AKAN DIBUAT

### 1.1 Sistem Skor & Penilaian Angka
Simulator ini **tidak akan memiliki**:
- skor numerik
- ranking pemain
- grade A/B/C
- “nilai kelulusan”

**Alasan**:  
Skor mengubah cara berpikir teknisi dari *bertanggung jawab* menjadi *optimalisasi poin*.

---

### 1.2 “Jawaban Benar” atau Solusi Resmi
Simulator ini **tidak akan memberikan**:
- diagnosis final
- daftar komponen rusak
- solusi optimal
- path terbaik

**Alasan**:  
Dunia nyata tidak menyediakan jawaban tunggal yang dapat diverifikasi saat bekerja.

---

### 1.3 Hint Otomatis & Tutorial Interaktif
Tidak akan ada:
- hint kontekstual
- panah penunjuk langkah
- pesan “coba ukur di sini”

**Alasan**:  
Hint menghapus kebutuhan berpikir dan menghilangkan risiko keputusan.

---

### 1.4 Mode “Selalu Bisa Diperbaiki”
Simulator ini **tidak menjamin**:
- semua scenario bisa diselesaikan
- semua perangkat bisa diselamatkan
- semua sesi berakhir positif

**Alasan**:  
Tidak semua perangkat layak diperbaiki, dan itu adalah keputusan teknis.

---

### 1.5 Shortcut Diagnostik Berbasis Pola
Tidak akan ada:
- mapping arus → fault
- mapping gejala → solusi
- tabel referensi “normal vs rusak”

**Alasan**:  
Pola hafalan bekerja di soal ujian, bukan di meja servis.

---

### 1.6 UI yang Menyederhanakan Realitas
Tidak akan ada:
- indikator hijau / merah
- ikon “aman / bahaya”
- animasi kepastian

**Alasan**:  
Kenyamanan visual sering kali menipu dalam konteks teknis.

---

### 1.7 Debug Mode untuk Pemain
Tidak akan ada:
- inspect internal state
- peek fault list
- lihat ground truth saat bermain

**Alasan**:  
Ground truth hanya bermakna setelah semuanya selesai.

---

### 1.8 Randomness yang Tidak Dapat Dijelaskan
Simulator **tidak akan**:
- mematikan sistem secara acak tanpa sebab
- memberikan hasil berbeda tanpa perubahan kondisi
- menyembunyikan RNG tanpa jejak kausal

**Alasan**:  
Ketidakpastian harus muncul dari sistem, bukan dari dadu.

---

### 1.9 Monetisasi yang Mempengaruhi Simulasi
Jika simulator berbayar:
- pembayaran **tidak akan**:
  - mengurangi risiko
  - membuka hint
  - meningkatkan peluang berhasil

**Alasan**:  
Uang membuka akses waktu, bukan mempermudah keputusan.

---

### 1.10 Gamifikasi Sosial
Tidak akan ada:
- leaderboard
- achievement
- badge
- share “hasil terbaik”

**Alasan**:  
Teknisi bekerja dengan tanggung jawab, bukan pamer hasil.

---

## 2. HAL YANG BOLEH BERKEMBANG (TAPI BUKAN DI v1.0)

- penambahan scenario baru
- penambahan world profile baru
- peningkatan kedalaman fisika
- tooling authoring yang lebih baik

Semua ini:
- **tidak mengubah filosofi**
- **tidak menyederhanakan risiko**

---

## 3. KRITERIA PENOLAKAN USULAN

Setiap usulan fitur akan ditolak jika:

- mengurangi ketidakpastian
- mempercepat “jawaban benar”
- menghilangkan konsekuensi kesalahan
- membuat pemain “merasa pintar” tanpa berpikir

Jika sebuah fitur membuat simulator:
> “lebih menyenangkan tapi kurang jujur”

→ **fitur tersebut ditolak.**

---

## 4. KALIMAT PEGANGAN ROADMAP

> **Simulator ini tidak berkembang dengan menambahkan kenyamanan,  
> tetapi dengan mempertahankan kejujuran.**

---

## 5. PENUTUP

Roadmap ini bukan anti-kemajuan.

Ini adalah **perlindungan terhadap penyimpangan arah**.

Jika di masa depan simulator ini terasa:
- keras
- tidak ramah
- tidak memuaskan

dan **tetap dipertahankan**,

maka roadmap ini **berhasil menjalankan fungsinya**.
