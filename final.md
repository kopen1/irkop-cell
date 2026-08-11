# IRKOP CELL — FINAL INTEGRATION COMMAND

Semua pekerjaan Team 1, Team 2, dan Team 3 telah selesai.

Tugas kamu sekarang adalah mengintegrasikan seluruh hasil project menjadi SATU project Irkop Cell yang siap masuk tahap final testing dan go-live.

## SUMBER KEBENARAN

Gunakan:

* PRD_Revisi_6.2_Final.md
* schema_d1_revisi6.2.sql
* TEAM_DIVISION_IRKOP_CELL.md
* 00_GLOBAL_PROJECT_RULES.md
* seluruh hasil implementasi Team 1
* seluruh hasil implementasi Team 2
* seluruh hasil implementasi Team 3

PRD dan schema final tetap menjadi sumber kebenaran requirement dan database.

## TUJUAN

Gabungkan:

TEAM 1
→ Backend, database, API, financial engine

TEAM 2
→ Frontend, UI/UX, responsive, CRUD

TEAM 3
→ QA, integration, NotifHook, security, tests

menjadi satu aplikasi Irkop Cell yang terintegrasi.

## ATURAN

Jangan menghapus fitur yang sudah selesai tanpa alasan.

Jangan mengganti business rule hanya agar integration lebih mudah.

Jangan membuat schema baru jika schema final sudah tersedia.

Jangan mengarang API.

Jika terdapat konflik antara implementasi team:

1. Identifikasi konflik.
2. Bandingkan dengan PRD.
3. Bandingkan dengan schema.
4. Tentukan implementasi yang sesuai sumber kebenaran.
5. Catat perubahan yang dilakukan.

Jika konflik tidak dapat diselesaikan berdasarkan dokumen:

STATUS: BLOCKED

Jangan memilih berdasarkan asumsi.

## URUTAN INTEGRASI

### STEP 1 — PROJECT AUDIT

Periksa seluruh hasil Team 1, 2, dan 3.

Identifikasi:

* file
* folder
* dependency
* API
* database
* migration
* environment variable
* configuration
* test
* integration
* duplicate files
* conflicting implementation

### STEP 2 — BACKEND BASELINE

Jadikan implementasi backend Team 1 sebagai baseline.

Pastikan:

* database
* migration
* API
* authentication
* authorization
* financial engine

terintegrasi dengan benar.

### STEP 3 — FRONTEND INTEGRATION

Hubungkan frontend Team 2 ke API final Team 1.

Periksa:

* endpoint
* request
* response
* validation
* authentication
* permission
* error handling
* loading state
* empty state

Hapus penggunaan mock API jika mock tersebut bukan bagian production.

### STEP 4 — TEAM 3 INTEGRATION

Masukkan:

* test
* NotifHook
* integration
* security fixes
* regression tests

Pastikan tidak ada test penting yang hilang.

### STEP 5 — FINANCIAL INTEGRITY

Uji minimal:

1. transaksi tunai
2. transaksi transfer
3. pengeluaran tunai
4. pengeluaran transfer
5. Opening
6. Closing
7. reversal/koreksi
8. duplicate request
9. laporan
10. audit trail

Pastikan tidak ada double mutation atau double deduction.

### STEP 6 — RESPONSIVE CHECK

Pastikan aplikasi berjalan pada:

* desktop
* tablet
* Android/mobile portrait
* mobile landscape

Periksa:

* navbar
* sidebar
* navigation mobile
* dashboard
* transaksi
* pengeluaran
* laporan
* form
* tabel
* modal
* pengaturan

### STEP 7 — FINAL REGRESSION

Jalankan seluruh test yang tersedia.

Jangan menyatakan test PASS jika belum benar-benar dijalankan.

### STEP 8 — FINAL REPORT

Berikan laporan:

PROJECT STATUS: <status>

TEAM 1: <hasil integrasi>

TEAM 2: <hasil integrasi>

TEAM 3: <hasil integrasi>

DATABASE: <status>

API: <status>

FRONTEND: <status>

FINANCIAL INTEGRITY:
<PASS/FAIL>

SECURITY:
<PASS/FAIL>

RESPONSIVE:
<PASS/FAIL>

REGRESSION:
<PASS/FAIL>

CONFLICTS FOUND: <list>

CONFLICTS RESOLVED: <list>

REMAINING ISSUES: <list>

GO-LIVE STATUS:
<READY / NOT READY>

## PENTING

Jangan hanya mengatakan "semua sudah tergabung".

Buktikan dengan audit dan test.

Jika masih ada masalah:

NOT READY FOR GO LIVE

Jika seluruh acceptance criteria benar-benar lulus:

READY FOR GO LIVE
