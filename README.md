# Irkop Cell — POS & Buku Kas Digital

Aplikasi Point of Sale (POS) dan buku kas digital untuk usaha retail kecil-menengah (warung, konter PPOB, service HP). Mengelola transaksi penjualan, kasbon, pengeluaran, service HP, payroll karyawan, serta laporan keuangan bulanan dan tahunan.

## Tujuan

Memberikan sistem pencatatan keuangan yang:
- **Akurat**: saldo sumber kebenaran berasal dari backend (`mutasi_saldo`)
- **Auditabel**: semua perubahan tercatat di `audit_log`
- **Idempoten**: request duplikat tidak menghasilkan mutasi ganda
- **Responsif**: desktop, tablet, dan mobile

Target pengguna: pemilik konter PPOB, kasir, dan admin.

---

## Fitur Utama

### Authentication & Authorization
- Login dengan username + password
- JWT (HS256) dengan TTL 30 hari
- Permission granular per halaman (bukan hanya role)
- Hard rule: role Karyawan tidak pernah mendapat akses `gaji_karyawan` atau `pengaturan`

### Dashboard
- Ringkasan omzet harian, jumlah transaksi, kasbon aktif
- Status kasir (belum buka / buka / tutup)
- Saldo sistem per akun (opening + mutasi)
- Transaksi terbaru hari ini

### Transaksi (PRD 5.2)
- Multi-item: keranjang produk dengan qty dan harga
- Metode bayar: Tunai, Transfer, Bon, Cash Tunai
- **Jenis transaksi**: Penjualan, **Produk Digital** (`jenis: 'produkdigital'`, modal dipotong dari akun sumber), Tarik Tunai, Transfer admin, Service
- Transfer membutuhkan akun penerima; status `menunggu` konfirmasi
- Bon membuat kasbon (`belum_lunas`), tidak ada mutasi saldo saat transaksi
- Filter: tanggal tunggal atau rentang (mutually exclusive), pencarian (q), metode bayar, status konfirmasi
- Detail transaksi + struk print via browser
- **Auto-kurang stok** saat penjualan fisik (kategori `lacak_stok=1`); produk digital tidak menyentuh stok
- **Manual entry** (PRD 5.4): tombol "Tambah Transaksi Manual" di halaman Laporan, menandai `manual_entry: true` dengan `tanggal_transaksi` (backdate ≤30 hari dari hari ini)

### Kasir (PRD 5.3)
- Opening: input saldo awal per akun, **otomatis diisi dari saldo sesi terakhir** (hasil closing) — tinggal disesuaikan
- Satu sesi per hari untuk semua karyawan
- Closing: rekonsiliasi saldo sistem vs saldo real; **akru gaji owner otomatis** saat closing
- **Buka ulang sesi** yang sudah ditutup (`POST /api/kasir/reopen`) — hasil closing lama dibersihkan
- **Setoran pasca-closing**: Isi Saldo & Beli Stok tetap bisa dicatat walau sesi hari ini sudah tutup (mis. setor tunai ke ATM setelah tutup toko)
- Banner reminder jika ada sesi kasir dari hari lampau belum ditutup (PRD 8.1.1)

### Laporan (PRD 5.4)
- **Bulanan**: jumlah transaksi, **omzet (penjualan item saja)**, laba, **pendapatan admin**, rekap kategori, kasbon, pengeluaran, net, perbandingan bulan sebelumnya
- **Arus Dana** (bukan omzet): kirim uang/tarik tunai/transfer
- **Saldo Akun (awal → akhir bulan)** + total uang
- **Rincian Harian** per tanggal (trx, omzet, laba, pengeluaran, beli stok, net)
- **Produk Terlaris** (qty, transaksi, omzet, laba per produk)
- **Nilai Stok** (modal & jual per kategori + total)
- **Rekonsiliasi Bulanan** (`ΔUang = Laba − ΔStok − Pengeluaran_ops − ΔPiutang`) + baris Cek + toleransi
- **Buku Kas**: satu daftar semua pergerakan (jual, pengeluaran, beli stok, transfer, kasbon, reversal)
- **Tahunan**: breakdown 12 bulan, ranking kategori terlaris
- Export CSV (UTF-8 BOM, Excel-compatible) via `GET /api/laporan/export` — termasuk baris `BELI_STOK` & `TRANSFER_SALDO`
- Cetak PDF via browser print (sisi klien)
- Data finansial 100% dari backend, tidak dihitung di frontend

### Daftar Barang / Produk
- CRUD produk dengan kategori
- Pencarian dan filter

### Service HP (PRD 5.6)
- CRUD service HP dengan status: Masuk → Proses → Selesai → Diambil
- Notifikasi ke pelanggan bersifat manual (admin telepon/chat sendiri)
- Pencatatan biaya dan tanggal masuk/selesai

### Kasbon (PRD 5.7)
- CRUD kasbon terkait transaksi bon
- Status: belum lunas / lunas
- Pelunasan via PUT /api/kasbon/:id

### Pelanggan (PRD 5.8)
- CRUD pelanggan
- Merge pelanggan (gabung akun dengan nama mirip)
- Riwayat belanja per pelanggan
- Ranking pelanggan setia

### Pengeluaran (PRD 5.9)
- CRUD pengeluaran dengan deskripsi, nominal, metode bayar, akun sumber
- Transfer: 1 mutasi −nominal ke akun sumber
- Tunai: 1 mutasi −nominal ke kas/tunai
- Soft-delete + reversal atomik

### Isi Saldo / Transfer Antar Akun (baru)
- Memindahkan saldo antar akun uang (mis. SeaBank → OrderKuota); **net 0** (Total Saldo tetap)
- Bukan penjualan & bukan biaya; `sumber_tipe='penyesuaian'`, `kategori='transfer_internal'`
- Bisa dicatat **setelah closing** (setoran tunai pasca tutup toko)
- Saldo akun ditampilkan **live** di form
- Soft-delete + reversal; idempotency
- Endpoint: `GET/POST /api/transfer-saldo`, `PUT/DELETE /api/transfer-saldo/:id`

### Beli Stok (baru)
- Inject stok voucher/aksesoris (multi-item), akun sumber bisa OrderKuota/SeaBank/Tunai
- Efek: akun sumber **−total**, `produk.stok += qty`, `harga_modal` diperbarui
- Bukan penjualan & bukan biaya operasional; `kategori='pembelian_stok'`
- Otomatis buat **harga_alert** bila modal beli > harga server
- Soft-delete + reversal (stok & saldo kembali); idempotency
- Endpoint: `GET/POST /api/pembelian-stok`, `PUT/DELETE /api/pembelian-stok/:id`

### Gaji Karyawan (PRD 5.10) — diperbarui
- Halaman ADMIN ONLY; hard rule: tidak dapat diakses role Karyawan
- **Akru harian otomatis**:
  - Karyawan: saat **Opening** — rate khusus bila diatur, jika tidak ikut **jam buka** (`<16:00` = Rp60.000, `≥16:00` = Rp45.000)
  - Owner: saat **Closing** — upah ikut jam buka + **50% laba service** (tanggal transaksi service)
- **Pembayaran berkala** (mis. tiap 15 hari): halaman Gaji → "Gaji Belum Dibayar" → bayar **per orang** (1 Pengeluaran dari akun, default Tunai Laci) + tandai lunas
- Baris gaji bisa diedit; kolom `dibayar_at`/`dibayar_oleh` (migrasi 0012)
- Endpoint: `GET /api/gaji/owner?tanggal=`, `GET /api/gaji/unpaid`, `POST /api/gaji/bayar`

### Pengaturan (PRD 5.11)
- Konfigurasi umum (nama website, tema)
- NotifHook (auto-input, API key, sumber notifikasi)
- Manajemen user & permission
- Master akun uang
- Log / audit trail

### NotifHook (PRD 12.6)
- Webhook endpoint: `POST /api/notifhook`
- Autentikasi: X-API-Key header
- Idempotensi: idempotency_key wajib
- Auto-confirm transaksi transfer (menunggu → otomatis)
- Block parsing otomatis package_name/matcher hingga konfigurasi aplikasi nyata tersedia (PRD 12.6)

### Audit Trail
- Semua perubahan tercatat di `audit_log`
- Kolom: data_before, data_after, aksi, tabel_terkait, user_id
- Lihat via halaman Pengaturan → Log

---

## Changelog (Perubahan Terbaru)

### Ditambahkan
- **Isi Saldo / Transfer Antar Akun** — pindah saldo antar akun (net 0), bisa pasca-closing, saldo live di form.
- **Beli Stok** — inject stok voucher/aksesoris multi-item dari OrderKuota/SeaBank/Tunai; update `harga_modal` + alert harga server.
- **Auto-kurang stok** saat penjualan fisik + **Nilai Stok** (modal & jual).
- **Laporan**: Produk Terlaris, Rincian Harian, Saldo Akun (awal→akhir) + total uang, Arus Dana (bukan omzet), Pendapatan admin, Buku Kas, Rekonsiliasi bulanan (baris Cek + toleransi).
- **Buka ulang sesi kasir** (`POST /api/kasir/reopen`) + setoran pasca-closing.
- **Opening otomatis** dari saldo sesi terakhir.
- **Gaji**: akru otomatis (karyawan saat opening, owner saat closing), gaji owner = upah ikut jam buka + 50% laba service, dan pembayaran berkala via "Gaji Belum Dibayar" (per orang).
- **Seed riwayat lokal** `backend/seed-history.js` (contoh 1 bulan: service, pengeluaran, beli stok, gaji, transfer, kasbon).

### Diubah
- **Omzet** = penjualan item saja (nominal tarik tunai/transfer/kirim uang dipindah ke **Arus Dana**); Rekap Kategori otomatis = Omzet.
- **Produk Digital** menyertakan `jenis` + `akun_sumber`; modal dipakai dari form (bukan hanya master).
- **Harga Produk Digital** per transaksi memakai `harga_jual`/`harga_modal` dari form.
- **Merge pelanggan** ikut memindahkan nomor telepon & semua alias (format satu baris nama — nomor).
- **Detail pelanggan** jadi inline.
- **Total/frekuensi pelanggan** dihitung dari transaksi (bukan kolom basi); riwayat transaksi tampil.
- Export CSV menyertakan `BELI_STOK` & `TRANSFER_SALDO`.

### Diperbaiki
- `updateKategori` menulis kolom `updated_at` yang tidak ada (error 500).
- Default tanggal **Pengeluaran** memakai WIB (sebelumnya UTC → bisa beda hari).
- Riwayat transaksi pelanggan tidak tampil (`riwayat` vs `riwayat_transaksi`).
- Simpan transaksi manual di Laporan memanggil fungsi `run()` yang tidak ada.

### Migrasi baru
- `0010_transfer_saldo.sql`, `0011_pembelian_stok.sql`, `0012_gaji_dibayar.sql`.

---

## Financial Integrity

### Flow
```
Transaksi      → mutasi_saldo → Laporan
Pengeluaran    → mutasi_saldo → Laporan
Isi Saldo      → mutasi_saldo (2 mutasi, net 0) → Laporan
Beli Stok      → mutasi_saldo + produk.stok   → Laporan
Penjualan fisik→ mutasi_saldo + produk.stok   → Laporan
```

### Prinsip
- **Source of truth**: `mutasi_saldo` table (saldo = opening + sum(mutasi))
- **Idempotency**: header `Idempotency-Key` mencegah double processing
- **Reversal**: edit/hapus transaksi/pengeluaran/transfer/beli stok memicu mutasi reversal atomik
- **Closing**: tidak membuat mutasi baru (hanya rekonsiliasi); akru gaji owner tanpa mutasi
- **Double mutation prevention**: operasi finansial memvalidasi sesi kasir; **kecuali** Isi Saldo & Beli Stok yang boleh pasca-closing (`requireSessionForToday`)
- **Stok**: otomatis berkurang saat penjualan fisik; bertambah saat Beli Stok. Produk digital tidak menyentuh stok fisik
- **Rekonsiliasi**: `ΔUang = Laba − ΔStok(modal) − Pengeluaran_ops − ΔPiutang`; selisih di luar toleransi ditandai

---

## Security

- **Password hashing**: PBKDF2-SHA256, 12.000 iterasi (budget CPU Workers Free; hash lama 210k tetap diverifikasi via fallback pure-JS)
- **JWT**: HS256, TTL 30 hari, stateless
- **Permission**: granular per halaman, hard rule enforced di frontend & backend
- **Parameterized SQL**: semua query menggunakan prepared statement (wrangler D1)
- **NotifHook API key**: X-API-Key validation, idempotency key wajib
- **Secret management**: environment variables, tidak ada secret di source code

---

## UI / UX

- **Responsive**: desktop (sidebar + topbar), tablet (collapsible sidebar), mobile (bottom nav + hamburger drawer)
- **Theme**: Classic Navy & Gold (default), Paper, Dark — persist di localStorage
- **State management**: loading, error, empty state di setiap halaman
- **Mobile navigation**: bottom nav 4 menu utama (Dashboard, Transaksi, Kasir, Laporan)
- **Form validation**: required fields, numeric input, date picker dengan min/max

---

## Technology Stack

| Layer | Teknologi |
|---|---|
| Frontend | React 19, Vite 8, React Router 7, Vitest, Testing Library |
| Styling | CSS custom properties (variables), vanilla CSS |
| Linting | oxlint |
| Backend | Cloudflare Workers (JavaScript/ESM) |
| Database | Cloudflare D1 (SQLite) |
| Hosting Frontend | Cloudflare Pages |
| Hosting Backend | Cloudflare Workers |
| Authentication | JWT HS256 |
| Password | PBKDF2-SHA256 |

---

## Architecture

```
┌──────────┐     ┌─────────────────┐     ┌──────────────────┐     ┌───────┐
│  Browser  │────▶│ Cloudflare Pages│────▶│ Pages Function   │────▶│Worker │
└──────────┘     │ (Static Assets) │     │ (/api/* proxy)   │     │(D1)   │
                 └─────────────────┘     └──────────────────┘     └───────┘
                              │                                      │
                              └──────────────────────────────────────┘
                                        (SPA routing)
```

**Alur request API:**
1. Browser → `GET/POST/PUT/DELETE /api/*`
2. Pages Function (`functions/api/[...path].ts`) menerima request
3. Forward ke Worker backend dengan header & body lengkap
4. Worker → D1 (query database)
5. Response dikembalikan ke browser melalui Pages Function

---

## Local Development

Struktur project saat ini berada di root repository (bukan `Revisi/`):

```
backend/     # Cloudflare Worker (src/index.js, routes, lib, financial, migrations)
frontend/    # React 19 + Vite (src/pages, components, lib)
```

```bash
# Backend lokal (Node + node:sqlite, meniru D1 — TANPA workerd/wrangler)
cd backend && npm run dev:local
cd backend && npm run dev:local -- --fresh   # reset DB lokal dulu

# Frontend
cd frontend && npm run dev

# Seed data riwayat 1 bulan (contoh: service, pengeluaran, beli stok, gaji)
cd backend && node seed-history.js 30
```

Catatan:
- `workerd`/`wrangler dev` tidak jalan di Android/Termux → gunakan `dev-server.js`.
- Login default lokal: `admin / admin1234` (auto-seed saat DB kosong).
- Zona waktu bisnis aplikasi ditetapkan WIB (+07:00) di `backend/src/lib/time.js`.

---

## Deployment

Project menggunakan ekosistem Cloudflare:
- **Frontend**: Cloudflare Pages (build dari `frontend/dist/`)
- **Backend**: Cloudflare Workers
- **Database**: Cloudflare D1

Deployment dilakukan oleh Release Agent setelah semua pre-check lulus.

---

## Project Status

**STATUS: READY FOR RELEASE**

Semua task Sprint 1–5 selesai. QA dan integration test lulus.

| Sprint | Status |
|---|---|
| Sprint 1–2 (Backend Core) | ✅ DONE |
| Sprint 3 (Operational CRUD) | ✅ DONE |
| Sprint 4 (NotifHook + Reminder) | ✅ DONE |
| Sprint 5 (Laporan Final + QA) | ✅ DONE |

**Menunggu:** Final Go-Live decision dari Release Agent.

---

## Testing

| Area | Tests | Status |
|---|---|---|
| Backend (financial engine, auth, laporan, stok, transfer, beli stok, gaji, rekonsiliasi, NotifHook, reminder, timezone) | 191 | ✅ PASS |
| Frontend (format, routes, smoke login/tema/redirect, smoke laporan, halaman) | 75 | ✅ PASS |
| **Total** | **266** | **✅ PASS** |

Jalankan:
```bash
# Backend
cd backend && npm test

# Frontend
cd frontend && npm test
```

---

## API Documentation

Kontrak API resmi tersedia di:
```
backend/docs/API_CONTRACT.md
```

Halaman ini mendokumentasikan seluruh endpoint, request/response shape, error codes, dan aturan bisnis.

---

## Future Development

Status fitur lanjutan:

| Fitur | Status | Keterangan |
|---|---|---|
| Auto stock update (jual & beli stok) | ✅ DONE | Stok turun saat penjualan fisik, naik via Beli Stok |
| Thermal printer support | 🟡 Planned | Bisa ditambahkan tanpa ubah schema |
| Real-time push notification | 🟡 Planned | Butuh external service (WA/SMS gateway) |
| NotifHook auto-parsing DANA/SeaBank | 🟡 Planned | Menunggu konfigurasi aplikasi pembayaran nyata (PRD 12.6) |
| Multi-cabang | 🔵 Future | Scaling ke banyak lokasi |

---

## Tim & Kontribusi

| Team | Tanggung Jawab |
|---|---|
| Team 1 | Backend, Database, API, Financial Engine |
| Team 2 | Frontend, UI/UX, Responsive, Theme |
| Team 3 | QA, Integration, Security, NotifHook |

---

## License

Project internal Irkop Cell.

---

**Dikembangkan:** Agustus 2026
**Timezone:** Asia/Jakarta (WIB)
**Source of Truth:** PRD Revisi 6.2 Final
