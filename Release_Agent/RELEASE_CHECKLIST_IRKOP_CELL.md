# RELEASE CHECKLIST — IRKOP CELL

**Document:** `RELEASE_CHECKLIST_IRKOP_CELL.md`  
**Project:** Irkop Cell  
**Release Stage:** Final Release / Go-Live  
**Status Baseline:** Development DONE, Final QA PASS, 55/55 tests PASS  
**Timezone:** Asia/Jakarta

---

## 1. Release Objective

Dokumen ini digunakan untuk tahap **release dan go-live** setelah pekerjaan Team 1, Team 2, dan Team 3 selesai.

Tahap release **bukan fase development ulang**.

Tujuan:
1. Memastikan project final siap production.
2. Apply database migration ke D1 production.
3. Deploy backend ke Cloudflare Workers.
4. Deploy frontend ke Cloudflare Pages.
5. Melakukan live smoke test.
6. Melakukan live responsive test.
7. Memastikan konfigurasi production aman.
8. Menentukan `GO LIVE` atau `BLOCKED`.

---

## 2. Current Baseline

| Area | Status |
|---|---|
| Backend | PASS |
| Database | PASS |
| API | PASS |
| Frontend | PASS |
| Financial Integrity | PASS |
| Security | PASS |
| Integration | PASS |
| Regression | PASS |
| Backend Tests | 34/34 |
| Frontend Tests | 21/21 |
| Total Tests | 55/55 |
| Critical Bug | NO |
| Final QA | PASS |

### Konflik sebelumnya

Semua konflik berikut sudah diperbaiki:

1. `AppShell` menelan `<Outlet/>`.
2. `monthRange` dan response CSV diperbaiki.
3. Interpretasi transaksi manual diperbaiki menjadi backdate sesuai PRD §5.4.

**Remaining conflicts: 0.**

---

## 3. Release Gate

- [ ] Source final sudah ditentukan.
- [ ] PRD final tersedia.
- [ ] Schema final tersedia.
- [ ] Backend 34/34 PASS.
- [ ] Frontend 21/21 PASS.
- [ ] Production build PASS.
- [ ] D1 production siap.
- [ ] Migration siap.
- [ ] Cloudflare Workers siap.
- [ ] Cloudflare Pages siap.
- [ ] Production secrets siap.
- [ ] `VITE_API_BASE` production benar.
- [ ] Live smoke test PASS.
- [ ] Live responsive test PASS.
- [ ] Financial smoke test PASS.
- [ ] Security smoke test PASS.
- [ ] Rollback plan tersedia.

Jika gate kritis gagal:

`RELEASE STATUS = BLOCKED`

---

## 4. Source of Truth

Gunakan:

```text
PRD_Revisi_6.2_Final.md
schema_d1_revisi6.2.sql
TEAM_DIVISION_IRKOP_CELL.md
00_GLOBAL_PROJECT_RULES.md
API_CONTRACT.md
```

Aturan:
- Jangan mengubah business rule saat release.
- Jangan membuat schema alternatif.
- Jangan membuat API baru hanya untuk melewati error deployment.
- Jangan menghapus fitur untuk membuat deployment berhasil.
- Requirement conflict → `BLOCKED`.

---

## 5. Pre-Release Source Check

### Repository

- [ ] Branch/revision release sudah ditentukan.
- [ ] Source Team 1 dan Team 2 yang terintegrasi digunakan.
- [ ] QA Team 3 menggunakan source final.
- [ ] Tidak ada source eksperimen ikut production.
- [ ] Tidak ada file sementara yang tidak diperlukan.

### Git Hygiene

- [ ] Tidak ada perubahan source yang tidak disengaja.
- [ ] Tidak ada credential yang ter-track.
- [ ] Tidak ada `.env` production yang ter-track.
- [ ] `token.md` tetap ignored.
- [ ] `node_modules` tidak ter-track.
- [ ] `.wrangler` tidak ter-track.

**Known cleanup item:** laporan integrator menyebut `node_modules` (1627) dan `.wrangler` (49) pernah ikut ter-track. Pastikan sudah dikeluarkan dari Git tracking dan ditambahkan ke `.gitignore`.

---

## 6. Dependency & Build Check

### Backend

- [ ] Dependency install PASS.
- [ ] Backend test 34/34 PASS.
- [ ] Worker build/deploy bundle PASS.

### Frontend

- [ ] Dependency install PASS.
- [ ] Frontend test 21/21 PASS.
- [ ] Production build PASS.
- [ ] Tidak ada mock API production.
- [ ] `VITE_API_BASE` menunjuk API production.

### Lint

Diketahui ada 4 warning `react(only-export-components)`.

- [ ] Warning tetap non-blocking.
- [ ] Tidak ada error lint baru.
- [ ] Warning dicatat sebagai technical debt jika belum diperbaiki.

---

## 7. Database — Cloudflare D1 Production

### Schema

Target:

```text
schema_d1_revisi6.2.sql
```

- [ ] Schema production sesuai schema final.
- [ ] Tidak ada schema alternatif.
- [ ] FK sesuai.
- [ ] Index sesuai.
- [ ] Constraint sesuai.

### Migration

```text
0001_init.sql
0002_manual_transaksi.sql
```

- [ ] Migration 0001 siap.
- [ ] Migration 0002 siap.
- [ ] `tanggal_transaksi` sesuai migration 0002.
- [ ] Backfill WIB sesuai implementasi final.

### Production Apply

- [ ] Database D1 production sudah diverifikasi.
- [ ] Migration dijalankan pada database yang benar.
- [ ] Output migration dicatat.
- [ ] Tidak ada migration failure.
- [ ] Schema setelah migration diverifikasi.

**PENTING:** jangan menjalankan migration production sebelum database target dipastikan benar.

---

## 8. Production Secrets & Environment

### Cloudflare

- [ ] `CLOUDFLARE_API_TOKEN` tersedia pada environment deployment.
- [ ] `CLOUDFLARE_ACCOUNT_ID` tersedia.
- [ ] API token memiliki permission minimum yang diperlukan.
- [ ] Secret tidak berada di source code.
- [ ] Secret tidak berada di frontend bundle.

### Frontend

- [ ] `VITE_API_BASE` production benar.
- [ ] Tidak menggunakan localhost.
- [ ] Tidak menggunakan API development/staging.
- [ ] Tidak ada API key rahasia di frontend bundle.

### NotifHook

- [ ] Production `X-API-Key` dikonfigurasi.
- [ ] Secret tidak dikirim ke frontend.
- [ ] `/api/notifhook` memakai konfigurasi production.

---

## 9. Deploy Backend — Cloudflare Workers

- [ ] Worker project diverifikasi.
- [ ] Production environment benar.
- [ ] D1 binding menunjuk database production.
- [ ] Secrets tersedia.
- [ ] Migration production selesai.
- [ ] Deployment PASS.
- [ ] Worker URL production dapat diakses.

Setelah deployment:
- [ ] Login API.
- [ ] Auth token.
- [ ] Permission.
- [ ] Transaksi.
- [ ] Pengeluaran.
- [ ] Laporan.
- [ ] Opening.
- [ ] Closing.
- [ ] NotifHook.
- [ ] Reminder Closing.

---

## 10. Deploy Frontend — Cloudflare Pages

- [ ] Production build PASS.
- [ ] Environment variable production benar.
- [ ] API base URL benar.
- [ ] Deployment PASS.
- [ ] URL production dapat dibuka.
- [ ] Tidak ada console error kritis.
- [ ] Route refresh tidak error.

---

## 11. Live Smoke Test

### Authentication

- [ ] Login berhasil.
- [ ] Credential salah ditolak.
- [ ] Logout berhasil.
- [ ] Protected route tidak dapat dibuka tanpa authentication.

### Authorization

- [ ] Permission halaman berjalan.
- [ ] User tanpa permission mendapat response sesuai.
- [ ] Hard rule `gaji_karyawan` tetap berlaku.
- [ ] Karyawan tidak dapat mengakses nominal gaji.

---

## 12. Financial Smoke Test

**Release gate kritis.**

### Test A — Transaksi Tunai

- [ ] Buat transaksi tunai.
- [ ] Tepat 1 mutasi dibuat.
- [ ] Nominal masuk Tunai Laci.
- [ ] Laporan mencatat transaksi.

### Test B — Transaksi Transfer

- [ ] Buat transaksi transfer.
- [ ] Akun sumber/penerima benar.
- [ ] Tepat 1 mutasi dibuat.
- [ ] Nominal masuk akun yang benar.

### Test C — Pengeluaran Tunai

- [ ] Buat pengeluaran tunai.
- [ ] Saldo Tunai Laci berkurang satu kali.
- [ ] Masuk laporan pengeluaran.

### Test D — Pengeluaran Transfer

- [ ] Buat pengeluaran transfer.
- [ ] Akun sumber benar.
- [ ] Saldo akun berkurang satu kali.
- [ ] Masuk laporan.

### Test E — Opening

- [ ] Buat Opening.
- [ ] Aturan 1x/hari berlaku.
- [ ] Saldo awal benar.

### Test F — Closing

- [ ] Jalankan Closing.
- [ ] Tidak membuat mutasi kedua.
- [ ] Rekonsiliasi benar.
- [ ] Status Closing tersimpan.

### Test G — Duplicate Request

- [ ] Kirim request/event sama dua kali.
- [ ] Gunakan `idempotency_key`.
- [ ] Hanya satu efek finansial terjadi.

### Test H — Koreksi/Reversal

- [ ] Koreksi sesuai flow.
- [ ] Reversal atomik.
- [ ] Audit trail tercatat.
- [ ] Tidak ada double mutation.

---

## 13. Transaction Date / Backdate

Sesuai PRD §5.4:

- [ ] Transaksi manual dapat memakai tanggal yang diizinkan.
- [ ] Tidak dapat memilih tanggal masa depan.
- [ ] Backdate mengikuti PRD.
- [ ] `tanggal_transaksi` tersimpan benar.
- [ ] Filter laporan memakai tanggal transaksi benar.
- [ ] Timezone menggunakan `Asia/Jakarta`.

---

## 14. Laporan & Filter

- [ ] Laporan bulanan dapat dibuka.
- [ ] Filter satu tanggal berfungsi.
- [ ] Filter rentang tanggal berfungsi.
- [ ] Transaksi pada tanggal pilihan tampil benar.
- [ ] Pengeluaran ikut perhitungan laporan.
- [ ] Mutasi konsisten dengan laporan.
- [ ] Tidak terjadi pergeseran tanggal karena UTC.

---

## 15. Frontend Live Responsive Test

Status sebelumnya: **PASS secara statis**. Release membutuhkan live browser test.

### Desktop

- [ ] Login
- [ ] Dashboard
- [ ] Transaksi
- [ ] Kasir
- [ ] Laporan
- [ ] Daftar Barang
- [ ] Service HP
- [ ] Kasbon
- [ ] Pelanggan
- [ ] Pengeluaran
- [ ] Gaji
- [ ] Pengaturan

### Mobile

- [ ] Bottom navigation.
- [ ] Hamburger/drawer.
- [ ] Navbar.
- [ ] Form tidak overflow.
- [ ] Table usable.
- [ ] Modal tidak keluar viewport.
- [ ] Filter usable.
- [ ] Button dapat ditekan.
- [ ] Input dapat digunakan.
- [ ] Theme selector dapat digunakan.

### Tablet

- [ ] Layout tidak rusak.
- [ ] Navigation sesuai.
- [ ] Table dan form usable.

---

## 16. Theme UI

Theme final:

```text
Classic Navy & Gold
+
Paper
```

- [ ] Theme default benar.
- [ ] Theme selector bekerja.
- [ ] Contrast aman.
- [ ] Button terlihat jelas.
- [ ] Form input terlihat jelas.
- [ ] Table readable.
- [ ] Mobile readable.
- [ ] Theme tersimpan sesuai implementasi final.

---

## 17. NotifHook

Endpoint:

```text
POST /api/notifhook
```

Protection:

```text
X-API-Key
idempotency_key
```

- [ ] API key valid diterima.
- [ ] API key invalid ditolak.
- [ ] Payload invalid ditolak.
- [ ] Duplicate event tidak menggandakan efek.
- [ ] Processing/audit sesuai implementasi.

### Known limitation

Parsing event:

```text
DANA
SeaBank
OrderKuota
```

masih menunggu konfigurasi aplikasi nyata.

Jika belum tersedia:
- [ ] Tandai `POST-GO-LIVE CONFIGURATION`.
- [ ] Jangan menganggapnya sebagai integration failure.

---

## 18. Reminder Closing

Endpoint:

```text
GET /api/kasir/reminder-closing
```

- [ ] Endpoint dapat diakses dengan permission benar.
- [ ] Response sesuai contract.
- [ ] Banner reminder tampil.
- [ ] Tidak error saat reminder tidak tersedia.

Push notification channel masih manual sesuai laporan final.

---

## 19. Security Smoke Test

- [ ] PBKDF2-SHA256 210k tetap digunakan.
- [ ] JWT TTL sesuai implementasi.
- [ ] Protected endpoint menolak tanpa token.
- [ ] Permission enforcement berjalan.
- [ ] Hard rule `gaji_karyawan` berjalan.
- [ ] NotifHook memerlukan `X-API-Key`.
- [ ] SQL menggunakan parameterized query.
- [ ] Secret tidak muncul di frontend.
- [ ] `.env` tidak ter-track.
- [ ] `token.md` tidak ter-track.
- [ ] Production logs tidak membocorkan credential/token.

---

## 20. Browser Console & Network

- [ ] Tidak ada error JavaScript kritis.
- [ ] Tidak ada request ke localhost.
- [ ] Tidak ada request ke development/staging.
- [ ] Tidak ada 401 yang tidak diharapkan.
- [ ] Tidak ada 403 yang tidak diharapkan.
- [ ] Tidak ada 404 API pada flow normal.
- [ ] Tidak ada 500 pada flow normal.
- [ ] Tidak ada CORS error.
- [ ] Tidak ada secret pada request yang seharusnya private.

---

## 21. Production Rollback Readiness

- [ ] Release version/tag dicatat.
- [ ] Git commit dicatat.
- [ ] Migration yang digunakan dicatat.
- [ ] Worker deployment version dicatat.
- [ ] Frontend deployment version dicatat.
- [ ] Rollback backend diketahui.
- [ ] Rollback frontend diketahui.
- [ ] Database rollback limitation dipahami.

Jangan menjalankan destructive database rollback tanpa prosedur terverifikasi.

---

## 22. Release Evidence

Simpan bukti:

- [ ] Backend 34/34.
- [ ] Frontend 21/21.
- [ ] Production build.
- [ ] Migration.
- [ ] Worker deployment.
- [ ] Pages deployment.
- [ ] Live smoke test.
- [ ] Responsive test.
- [ ] Financial smoke test.
- [ ] Security smoke test.

---

## 23. Final Release Decision

### BLOCKED

Gunakan jika:
- migration gagal;
- deployment gagal;
- financial flow gagal;
- authentication/security gagal;
- API/frontend tidak terhubung;
- critical regression ditemukan;
- production configuration salah.

```text
GO-LIVE = BLOCKED
```

### READY

Gunakan jika:
- release gate kritis PASS;
- migration production PASS;
- backend deployment PASS;
- frontend deployment PASS;
- live smoke test PASS;
- financial smoke test PASS;
- security smoke test PASS;
- responsive live test PASS;
- tidak ada critical bug.

```text
GO-LIVE = READY
```

---

## 24. Final Release Report

Isi setelah release:

```text
IRKOP CELL — FINAL RELEASE REPORT

DATE:
TIME:
TIMEZONE: Asia/Jakarta

RELEASE VERSION:
GIT COMMIT:

BACKEND:
PASS / FAIL

FRONTEND:
PASS / FAIL

DATABASE:
PASS / FAIL

MIGRATION:
PASS / FAIL

API:
PASS / FAIL

FINANCIAL:
PASS / FAIL

SECURITY:
PASS / FAIL

RESPONSIVE:
PASS / FAIL

NOTIFHOOK:
PASS / BLOCKED / POST-GO-LIVE

SMOKE TEST:
PASS / FAIL

REGRESSION:
PASS / FAIL

CRITICAL BUG:
YES / NO

KNOWN NON-BLOCKERS:
-

DEPLOYMENT:
PASS / FAIL

FINAL DECISION:
READY FOR GO LIVE / BLOCKED

RELEASE NOTES:
-
```

---

## 25. Post-Go-Live Monitoring

Setelah live:

- [ ] Login production diuji.
- [ ] Dashboard diuji.
- [ ] Satu transaksi terkontrol diuji.
- [ ] Satu pengeluaran terkontrol diuji.
- [ ] Saldo diverifikasi.
- [ ] Laporan diverifikasi.
- [ ] Closing diverifikasi.
- [ ] Worker error diperiksa.
- [ ] D1 error diperiksa.
- [ ] Frontend runtime error diperiksa.

Prioritas monitoring:
1. Financial mutation.
2. Authentication.
3. API 4xx/5xx.
4. Database error.
5. Duplicate transaction.
6. Closing.
7. NotifHook.

---

## 26. Definition of Done

```text
SOURCE FINAL
     ↓
BUILD PASS
     ↓
MIGRATION PASS
     ↓
BACKEND DEPLOY PASS
     ↓
FRONTEND DEPLOY PASS
     ↓
LIVE SMOKE TEST PASS
     ↓
FINANCIAL TEST PASS
     ↓
SECURITY TEST PASS
     ↓
RESPONSIVE TEST PASS
     ↓
NO CRITICAL BUG
     ↓
========================
     READY FOR GO LIVE
========================
```

**Dokumen ini tidak mengubah requirement PRD.**

Dokumen ini hanya digunakan sebagai checklist release berdasarkan status final integration dan QA yang sudah dilaporkan.
