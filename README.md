# IRKOP CELL — POS & Buku Kas Digital

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
- Transfer membutuhkan akun penerima; status `menunggu` konfirmasi
- Bon membuat kasbon (`belum_lunas`), tidak ada mutasi saldo saat transaksi
- Filter: tanggal tunggal atau rentang (mutually exclusive), pencarian (q), metode bayar, status konfirmasi
- Detail transaksi + struk print via browser
- **Manual entry** (PRD 5.4): tombol "Tambah Transaksi Manual" di halaman Laporan, menandai `manual_entry: true` dengan `tanggal_transaksi` (backdate ≤30 hari dari hari ini)

### Kasir (PRD 5.3)
- Opening: input saldo awal per akun
- Satu sesi per hari untuk semua karyawan
- Closing: rekonsiliasi saldo sistem vs saldo real
- Banner reminder jika ada sesi kasir dari hari lampau belum ditutup (PRD 8.1.1)

### Laporan (PRD 5.4)
- **Bulanan**: omzet, laba, rekap kategori, kasbon, pengeluaran, net, perbandingan bulan sebelumnya
- **Tahunan**: breakdown 12 bulan, ranking kategori terlaris
- Export CSV (UTF-8 BOM, Excel-compatible) via `GET /api/laporan/export`
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

### Gaji Karyawan (PRD 5.10)
- Halaman ADMIN ONLY
- Hard rule: tidak dapat diakses role Karyawan
- Otomatis input gaji harian saat opening (sumber: auto)

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

## Financial Integrity

### Flow
```
Transaksi → mutasi_saldo → Laporan
Pengeluaran → mutasi_saldo → Laporan
```

### Prinsip
- **Source of truth**: `mutasi_saldo` table
- **Idempotency**: header `Idempotency-Key` mencegah double processing
- **Reversal**: edit/hapus transaksi atau pengeluaran memicu mutasi reversal atomik
- **Closing**: tidak membuat mutasi baru (hanya rekonsiliasi)
- **Double mutation prevention**: setiap operasi finansial memvalidasi sesi kasir terbuka; jika tutup → 409 error

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
# Preview frontend + backend sekaligus (skrip bantu)
./start-preview.sh

# Backend saja
cd backend && npm run dev   # wrangler dev

# Frontend saja
cd frontend && npm run dev
```

Catatan: zona waktu bisnis aplikasi ditetapkan WIB (+07:00) secara langsung di `backend/src/lib/time.js`.

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
| Backend (financial engine, auth, laporan, manual transaksi, NotifHook, reminder, timezone) | 76 | ✅ PASS |
| Frontend (format, routes, smoke login/tema/redirect, smoke laporan) | 21 | ✅ PASS |
| **Total** | **97** | **✅ PASS** |

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

Fitur berikut direncanakan untuk pengembangan lanjutan (belum tersedia):

| Fitur | Status | Keterangan |
|---|---|---|
| Thermal printer support | 🟡 Planned | Bisa ditambahkan tanpa ubah schema |
| Auto stock update on expenditure | 🟡 Planned | Pembaruan stok otomatis saat pembelian sparepart |
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
