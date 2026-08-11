# IRKOP CELL — TEAM DIVISION & WORK PLAN

**Project:** Irkop Cell  
**Planning Baseline:** PRD Revisi 6.2 Final  
**Status:** Go Play Preparation  
**Timezone:** Asia/Jakarta  
**Jumlah Team:** 3

---

## 1. Tujuan Pembagian Team

Pembagian team dibuat agar proses build Irkop Cell berjalan paralel tetapi tetap terkontrol.

Prinsip utama:

> Team yang membuat fitur tidak menjadi satu-satunya pihak yang menyatakan fitur tersebut benar.

Tiga tanggung jawab utama:

1. **Team 1 — Core & Backend:** memastikan mesin, database, API, dan financial engine benar.
2. **Team 2 — Frontend & UI/UX:** memastikan aplikasi mudah digunakan, konsisten, dan responsif.
3. **Team 3 — Integration, QA & Security:** memastikan integrasi berjalan, bug ditemukan, dan fitur aman sebelum release.

---

# 2. TEAM 1 — CORE & BACKEND

## 2.1 Tujuan

Membangun fondasi teknis dan seluruh business logic utama Irkop Cell.

## 2.2 Tanggung Jawab

### Infrastructure & Backend
- Cloudflare Workers
- Cloudflare D1
- Migration database
- API
- Authentication
- Authorization
- Role & permission
- Environment/configuration
- Error handling

### Database
- Implementasi schema PRD 6.2
- Migration
- Foreign key dan constraint
- Index
- Integrity rule
- Seed/demo data bila diperlukan

### Financial Engine
- Master akun
- Mutasi saldo
- Transaksi
- Pengeluaran
- Transfer/kirim uang
- Opening
- Closing
- Reversal/koreksi
- Soft-delete
- Idempotency
- Audit trail

### Modul Backend
- Produk
- Pelanggan
- Service HP
- Kasbon
- Gaji
- Laporan
- Pengaturan
- NotifHook backend

## 2.3 Aturan Finansial Wajib

Semua perubahan saldo harus melalui:

`mutasi_saldo`

Tidak boleh ada endpoint yang mengubah saldo secara langsung tanpa membuat jejak mutasi.

Closing hanya melakukan rekonsiliasi.

Closing TIDAK boleh membuat mutasi pengurangan kedua.

Koreksi transaksi finansial harus menggunakan reversal/adjustment sesuai aturan PRD.

## 2.4 API Contract

Team 1 wajib mendokumentasikan kontrak API sebelum Team 2 mengintegrasikan UI.

Minimal setiap endpoint menjelaskan:

- Method
- Path
- Authentication
- Permission
- Request
- Validation
- Response sukses
- Response error
- HTTP status
- Idempotency bila diperlukan
- Side effect terhadap saldo/mutasi
- Audit log bila diperlukan

Contoh:

```text
POST /api/transaksi

Request:
{
  customer_id,
  items[],
  payment_method,
  account_id
}

Response:
{
  transaction_id,
  total,
  status,
  created_at
}
```

## 2.5 Output Team 1

- Database migration
- Backend API
- Financial engine
- API Contract
- Authentication & permission
- Seed/demo data
- Unit/integration test backend
- Dokumentasi teknis

## 2.6 Definition of Done

Fitur Team 1 dianggap selesai jika:

- API berjalan
- validation berjalan
- permission benar
- database transaction aman
- saldo sesuai aturan
- idempotency diuji jika relevan
- audit/reversal sesuai aturan
- test backend lulus
- API Contract diperbarui

---

# 3. TEAM 2 — FRONTEND & UI/UX

## 3.1 Tujuan

Membangun aplikasi Irkop Cell yang nyaman digunakan pada desktop, tablet, dan HP.

## 3.2 Prinsip UI

Target:

> Classic, bersih, profesional, dan mudah dipahami teknisi/pemilik konter.

UI harus responsif.

Desktop:
- Sidebar
- Topbar
- Content area

Mobile:
- Hamburger/sidebar adaptif
- Bottom navigation untuk menu utama
- Form dan tabel harus tetap usable

## 3.3 Modul Frontend

### Core
- Login
- Dashboard
- Navbar
- Sidebar
- Responsive layout
- Theme system
- Toast
- Modal
- Loading state
- Error state
- Empty state

### Operasional
- Transaksi
- Kasir
- Pengeluaran
- Produk
- Service HP
- Kasbon
- Pelanggan
- Gaji

### Reporting
- Laporan
- Filter
- Detail
- Export UI

### System
- Pengaturan
- User management
- Permission UI
- NotifHook configuration
- Console/log UI

## 3.4 Transaksi

Frontend wajib mendukung:

- Filter tanggal
- Filter rentang tanggal
- Pencarian ID
- Pencarian pelanggan
- Pencarian produk
- Filter metode pembayaran
- Detail transaksi
- Status transaksi

Timezone tampilan:

`Asia/Jakarta`

## 3.5 Pengeluaran

Form minimal:

- Deskripsi
- Nominal
- Metode bayar
- Akun sumber
- Tanggal
- Catatan bila diperlukan

Contoh:

```text
Beli sparepart LCD iPhone 11
Rp300.000
Transfer
SeaBank

Ongkir Maxim
Rp15.000
Tunai
Tunai Laci
```

## 3.6 Theme System

Sediakan pilihan tema.

Default:

**Classic Navy & Gold**

Tema lain dapat disediakan selama tetap menjaga keterbacaan dan konsistensi.

## 3.7 CRUD

CRUD UI harus memiliki:

- List
- Search/filter bila diperlukan
- Create
- Read/detail
- Update
- Delete/soft-delete sesuai aturan modul
- Confirmation
- Success state
- Error state
- Empty state

Untuk data finansial, UI tidak boleh menawarkan hard delete jika backend menerapkan reversal/soft-delete.

## 3.8 Output Team 2

- UI semua halaman
- Responsive implementation
- Theme system
- Form
- Table
- Modal
- CRUD
- API integration
- Loading/error/empty state
- Accessibility dasar
- UI documentation

## 3.9 Definition of Done

Fitur dianggap selesai jika:

- Desktop usable
- Mobile usable
- API terintegrasi
- validation tampil jelas
- error state tersedia
- loading state tersedia
- empty state tersedia
- permission UI sesuai role
- tidak ada data finansial yang dimanipulasi langsung dari frontend

---

# 4. TEAM 3 — INTEGRATION, QA & SECURITY

## 4.1 Tujuan

Menjadi pihak independen yang menguji hasil Team 1 dan Team 2 sebelum release.

Team 3 bukan hanya tester terakhir.

Team 3 ikut dari awal untuk mendefinisikan acceptance test dan menguji kontrak API.

## 4.2 Integration

### NotifHook
- Endpoint
- API key
- Source configuration
- Event parsing
- Validation
- Idempotency
- Retry behavior
- Error handling
- Logging

### Sumber Notifikasi
Contoh sumber yang dikonfigurasi:

- DANA
- SeaBank
- OrderKuota
- Custom source

Team 3 tidak boleh menganggap format event tanpa kontrak/adapter yang terdokumentasi.

## 4.3 Financial QA

Team 3 harus menguji minimal:

### Test 001 — Penjualan Tunai

```text
Penjualan Rp100.000
→ Tunai +100.000
→ mutasi tercatat
```

### Test 002 — Penjualan Transfer

```text
Penjualan Rp200.000
→ Akun transfer +200.000
→ mutasi tercatat
```

### Test 003 — Pengeluaran Transfer

```text
Pengeluaran Rp50.000
→ SeaBank -50.000
→ mutasi tercatat
```

### Test 004 — Pengeluaran Tunai

```text
Pengeluaran Rp15.000
→ Tunai Laci -15.000
→ mutasi tercatat
```

### Test 005 — Closing

```text
Closing
→ saldo tidak dipotong lagi
→ hanya rekonsiliasi
```

### Test 006 — Duplicate Request

Request yang sama dikirim dua kali.

Expected:

```text
1 transaksi
1 efek saldo
1 mutasi finansial
```

Bukan:

```text
2 transaksi
2 mutasi
```

### Test 007 — Koreksi

Transaksi finansial dikoreksi.

Expected:

```text
Efek lama dibalik
Efek baru dicatat
Audit trail tetap ada
```

## 4.4 Security QA

Uji:

- Authentication
- Authorization
- Role restriction
- Admin-only page
- API authentication
- API key handling
- Input validation
- SQL injection resistance
- XSS resistance
- CSRF bila relevan
- Rate limiting bila diperlukan
- Sensitive data exposure
- Audit log

## 4.5 Responsive QA

Minimal:

- Desktop
- Tablet
- Android phone
- Mobile portrait
- Mobile landscape

Test:

- Navbar
- Sidebar
- Bottom navigation
- Table
- Form
- Modal
- Filter
- Dashboard
- Laporan

## 4.6 Regression Test

Setiap perubahan backend/frontend wajib menjalankan regression test terhadap:

- Login
- Transaksi
- Mutasi
- Pengeluaran
- Opening
- Closing
- Laporan
- NotifHook
- Permission

## 4.7 Output Team 3

- Test plan
- Test cases
- Integration test
- Security test
- Responsive test
- Bug report
- Regression report
- Release checklist
- Go-live approval

## 4.8 Definition of Done

Fitur dianggap lulus QA jika:

- Acceptance test lulus
- Tidak ada critical bug
- Tidak ada saldo salah
- Permission benar
- Integration test lulus
- Responsive test lulus
- Regression test lulus

---

# 5. ALUR KERJA ANTAR TEAM

```text
                  PRD 6.2 FINAL
                       │
                       ▼
                API CONTRACT
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
      TEAM 1        TEAM 2        TEAM 3
      Backend       Frontend      QA/Integrasi
      Database      UI/UX         Security
      Financial     Responsive    Test
          │            │            │
          └────────────┼────────────┘
                       ▼
                   INTEGRATION
                       │
                       ▼
                    QA TEST
                       │
                ┌──────┴──────┐
                ▼             ▼
              FAIL          PASS
                │             │
                ▼             ▼
             FIX/RETEST    RELEASE
                              │
                              ▼
                           GO LIVE
```

---

# 6. Aturan Kolaborasi

## Rule 1 — PRD adalah sumber keputusan

Developer tidak boleh membuat keputusan bisnis baru jika sudah diatur dalam PRD.

Jika ada konflik:

`PRD → API Contract → Implementation`

Jika PRD belum mengatur sesuatu, buat decision/issue sebelum implementasi.

## Rule 2 — Backend dan Frontend menggunakan API Contract

Team 2 tidak menebak response backend.

Team 1 tidak mengubah response API secara diam-diam.

Perubahan contract harus diinformasikan ke Team 2 dan Team 3.

## Rule 3 — Team 3 independen

Team 3 boleh menolak fitur yang secara teknis sudah selesai tetapi belum memenuhi acceptance criteria.

## Rule 4 — Tidak ada merge tanpa test

Minimal:

```text
Code
→ Review
→ Test
→ Merge
```

## Rule 5 — Financial feature mendapat prioritas QA tertinggi

Prioritas:

1. Saldo
2. Mutasi
3. Transaksi
4. Pengeluaran
5. Opening/Closing
6. NotifHook
7. Permission
8. Laporan
9. UI detail

---

# 7. Urutan Sprint

## Sprint 1 — Foundation

Team 1:
- D1
- Schema
- Migration
- Auth
- Permission
- API contract
- Financial engine dasar

Team 2:
- App shell
- Login
- Sidebar
- Navbar
- Responsive
- Theme system

Team 3:
- Test framework
- Test database
- Security baseline
- Acceptance criteria

## Sprint 2 — Financial Core

Prioritas:

```text
Opening
↓
Transaksi
↓
Mutasi
↓
Pengeluaran
↓
Closing
```

Tidak lanjut ke tahap berikutnya jika financial core belum stabil.

## Sprint 3 — Operational Modules

- Produk
- Service HP
- Kasbon
- Pelanggan
- Gaji

## Sprint 4 — Integration

- NotifHook
- DANA
- SeaBank
- OrderKuota
- Custom source

## Sprint 5 — Reporting & Final QA

- Laporan
- Audit
- Security
- Responsive QA
- Regression
- Performance
- Release checklist

## Sprint 6 — Go Live

```text
Production configuration
↓
Database backup/migration check
↓
Smoke test
↓
Security check
↓
Financial reconciliation test
↓
Go-live
↓
Post-release monitoring
```

---

# 8. Go-Live Checklist

### Team 1
- [ ] Production schema verified
- [ ] Migration verified
- [ ] API verified
- [ ] Financial engine verified
- [ ] Authentication verified
- [ ] Permission verified
- [ ] Audit log verified
- [ ] Idempotency verified

### Team 2
- [ ] Semua halaman selesai
- [ ] Desktop responsive
- [ ] Mobile responsive
- [ ] Theme verified
- [ ] Form verified
- [ ] CRUD verified
- [ ] Error state verified
- [ ] Loading state verified
- [ ] Empty state verified

### Team 3
- [ ] API test pass
- [ ] Financial test pass
- [ ] Duplicate request test pass
- [ ] Closing test pass
- [ ] Reversal test pass
- [ ] NotifHook test pass
- [ ] Security test pass
- [ ] Responsive test pass
- [ ] Regression pass
- [ ] No critical bug

---

# 9. Final Responsibility Matrix

| Area | Team 1 | Team 2 | Team 3 |
|---|---|---|---|
| Database | OWNER | — | TEST |
| API | OWNER | CONSUMER | TEST |
| Financial Engine | OWNER | UI | QA |
| Transaksi | BACKEND | UI | QA |
| Pengeluaran | BACKEND | UI | QA |
| Opening/Closing | OWNER | UI | QA |
| Produk | BACKEND | UI | QA |
| Service | BACKEND | UI | QA |
| Kasbon | BACKEND | UI | QA |
| Pelanggan | BACKEND | UI | QA |
| Gaji | BACKEND | UI | SECURITY/QA |
| Laporan | BACKEND | UI | QA |
| NotifHook | INTEGRATION | UI | OWNER QA |
| Authentication | OWNER | UI | SECURITY |
| Permission | OWNER | UI | SECURITY |
| Responsive | — | OWNER | QA |
| Theme | — | OWNER | QA |
| Security | SUPPORT | SUPPORT | OWNER |
| Release | SUPPORT | SUPPORT | OWNER |

---

# 10. Prinsip Utama Irkop Cell

> **Tidak boleh ada uang yang berubah tanpa jejak.**

Setiap uang masuk/keluar harus dapat ditelusuri:

```text
Kapan
→ Dari mana
→ Ke akun mana
→ Nominal
→ Alasan
→ User
→ Sumber transaksi
→ Mutasi
→ Audit trail
```

Dengan pembagian ini, Team 1 menjaga **kebenaran mesin**, Team 2 menjaga **pengalaman pengguna**, dan Team 3 menjaga **keandalan sebelum production**.

**Status:** READY FOR GO PLAY
