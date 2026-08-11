# IRKOP CELL — API CONTRACT v1.0 (Team 1 → Team 2 & Team 3)

Status: `READY_FOR_REVIEW` (baseline Sprint 1–2)
Source of truth: PRD Revisi 6.2 Final + `schema_d1_revisi6.2.sql`
Timezone bisnis: `Asia/Jakarta` (WIB)

## Konvensi umum

- Base URL: Cloudflare Worker (mis. `https://api.irkop.example`).
- Semua request (kecuali login & webhook) wajib header `Authorization: Bearer <token>`.
- Webhook NotifHook wajib header `X-API-Key: <key>`.
- Body JSON `application/json`. Angka nominal = INTEGER rupiah (tanpa desimal).
- Tanggal filter = kalender WIB `YYYY-MM-DD`. Timestamp respon = ISO 8601 UTC.
- Error shape: `{ "error": { "code": "...", "message": "..." } }`
- HTTP: 200 sukses, 400 validasi, 401 unauthenticated, 403 forbidden, 404 not found, 409 konflik, 500 internal.
- Idempotensi retry: kirim header `Idempotency-Key` (string unik per operasi finansial).

## Ringkasan endpoint

| Method | Path | Permission | Keterangan |
|---|---|---|---|
| POST | `/api/auth/login` | publik | login → `{token, user}` |
| POST | `/api/auth/bootstrap` | publik (sekali) | buat admin pertama saat tabel users kosong, wajib header `X-Bootstrap-Secret` |
| POST | `/api/auth/logout` | login | invalidasi sisi klien (JWT stateless) |
| GET | `/api/auth/me` | login | profil + permission |
| GET | `/api/kasir/current` | halaman kasir | status sesi hari ini |
| GET | `/api/kasir/reminder-closing` | halaman kasir | sesi "buka" dari hari lampau (reminder closing, PRD 8.1.1) |
| POST | `/api/kasir/opening` | halaman kasir | buka kasir (multi akun) |
| POST | `/api/kasir/closing` | halaman kasir | tutup kasir (rekonsiliasi) |
| GET | `/api/transaksi` | halaman transaksi | list + filter tanggal/q/metode |
| POST | `/api/transaksi` | halaman transaksi | buat transaksi multi-item |
| GET | `/api/transaksi/:id` | halaman transaksi | detail + mutasi |
| PUT | `/api/transaksi/:id` | halaman transaksi | edit (dengan reversal atomik) |
| DELETE | `/api/transaksi/:id` | halaman transaksi | soft-delete + reversal |
| GET/POST | `/api/produk` | daftar_barang | list/tambah produk |
| PUT/DELETE | `/api/produk/:id` | daftar_barang | edit/soft-delete produk |
| GET/POST | `/api/kategori` | daftar_barang | list/tambah kategori |
| GET | `/api/pelanggan` | pelanggan | list + search + ranking |
| POST | `/api/pelanggan` | pelanggan | tambah pelanggan |
| GET | `/api/pelanggan/:id` | pelanggan | detail (riwayat, kasbon, alias) |
| POST | `/api/pelanggan/merge` | pelanggan | gabung 2 pelanggan manual |
| GET/POST | `/api/kasbon` | kasbon | list/tambah kasbon |
| PUT | `/api/kasbon/:id` | kasbon | edit / set lunas (mutasi pelunasan) |
| GET/POST | `/api/pengeluaran` | pengeluaran | list/tambah pengeluaran |
| GET | `/api/pengeluaran/:id` | pengeluaran | detail + mutasi |
| PUT/DELETE | `/api/pengeluaran/:id` | pengeluaran | edit/soft-delete + reversal |
| GET/POST | `/api/service-hp` | laporan_service_hp | list/tambah service |
| PUT | `/api/service-hp/:id` | laporan_service_hp | update status/detail |
| GET | `/api/gaji` | ADMIN | list gaji harian |
| POST | `/api/gaji` | ADMIN | input manual gaji |
| PUT | `/api/gaji/:id` | ADMIN | edit nominal gaji |
| GET | `/api/gaji/rate` | ADMIN | list rate karyawan |
| POST | `/api/gaji/rate` | ADMIN | set rate flat/custom |
| GET | `/api/users` | ADMIN | list user |
| POST | `/api/users` | ADMIN | tambah user |
| PUT | `/api/users/:id` | ADMIN | edit user (nama/role/password/aktif) |
| PUT | `/api/users/:id/permissions` | ADMIN | set akses halaman user |
| GET | `/api/akun` | login | daftar akun uang aktif |
| POST | `/api/akun` | ADMIN | tambah akun uang |
| PUT | `/api/akun/:id` | ADMIN | edit/nonaktifkan akun |
| GET | `/api/settings` | ADMIN | konfigurasi + health NotifHook |
| PUT | `/api/settings` | ADMIN | ubah setting |
| POST | `/api/settings/generate` | ADMIN | generate API key NotifHook |
| POST | `/api/settings/notifhook-source` | ADMIN | config sumber notif |
| GET | `/api/logs` | ADMIN | audit trail |
| POST | `/api/notifhook` | X-API-Key | webhook NotifHook |
| GET | `/api/laporan/bulan?bulan=YYYY-MM` | halaman laporan | Laporan Bulanan (omzet, laba, kategori, kasbon, pengeluaran, net, perbandingan) |
| GET | `/api/laporan/tahun?tahun=YYYY` | halaman laporan | Laporan Tahunan + breakdown 12 bulan + ranking kategori |
| GET | `/api/laporan/export?cakupan=bulan\|tahun&bulan=&tahun=` | halaman laporan | Export CSV (Excel-compatible) transaksi + pengeluaran |

---

## Kontrak detail penting

### POST /api/auth/login
Request: `{ "username": "...", "password": "..." }`
Success 200: `{ "token": "<JWT>", "user": { "id", "nama", "username", "role", "permissions": {} } }`
Error: 400 missing username/password; 401 invalid_credentials; 403 user_inactive.
Catatan: JWT HS256, TTL default 30 hari, tanpa paksa-expiry (sesuai PRD 3.1).

### POST /api/auth/bootstrap

Hanya tersedia saat tabel `users` kosong (provisioning admin pertama). Wajib header `X-Bootstrap-Secret` yang nilainya diambil dari env `BOOTSTRAP_SECRET` (bukan hardcode di source, lihat `docs/FIRST_ADMIN_BOOTSTRAP.md`).

Request: `{ "nama": "...", "username": "...", "password": "...", "role": "admin" }`
- `role` dipaksa `admin`; nilai lain → 400.
- Hanya boleh dipanggil SEKALI; setelah ada user → 409 `bootstrap_done`.
- Tanpa auth; login tetap lewat `/api/auth/login`.

Success 200: `{ "message": "...", "user": { "id", "nama", "username", "role", "permissions": {} } }`
Error: 503 `bootstrap_not_configured` (env belum diset); 403 `invalid_bootstrap_secret`; 400 validasi; 409 `bootstrap_done`.

### GET /api/kasir/current
Success:
```
{ "tanggal": "2026-08-10", "status": "belum_buka" | "buka" | "tutup",
  "kasir_sesi_id": 1|null, "dibuka_at", "ditutup_at", "catatan_closing",
  "saldo": [ { "nama_akun", "saldo_opening", "mutasi", "saldo_sistem" } ],
  "closing": [ { "nama_akun", "saldo_sistem", "saldo_real", "selisih" } ] }
```

### GET /api/kasir/reminder-closing
Bertujuan reminder (PRD 8.1.1): deteksi sesi kasir yang masih `buka` dari hari lampau (karyawan lupa closing). Tidak perlu tabel baru. Kirim `GET /api/kasir/reminder-closing` (halaman kasir):
```
{ "tanggal": "2026-08-10", "perlu_diingatkan": true|false,
  "sesi_buka_lampau": [ { "kasir_sesi_id": 1, "tanggal": "2026-08-09", "dibuka_at": "...", "dibuka_oleh": "nama" } ] }
```
Side effects: tulis `audit_log` aksi `reminder_closing` (jejak bahwa cek dilakukan) hanya bila ada sesi lampau. Keterbatasan: penyampaian notifikasi ke Admin (channel push WA/email) di luar backend — sumber data & penanda UI disediakan backend, UI menampilkan peringatan; sesuai fase ini notifikasi ke pelanggan/admin bersifat manual (PRD §7, line 148).

### POST /api/kasir/opening
Request: `{ "saldo_awal": [ { "nama_akun": "Tunai Laci", "saldo": 500000 }, { "nama_akun": "DANA", "saldo": 0 } ] }`
Aturan: 1 sesi per hari (`kasir_sesi.tanggal` UNIQUE). Sesi digabung untuk semua karyawan.
Side effects:
- 1 `kasir_sesi` (status buka) + `kasir_saldo` tipe opening per akun.
- Jika dibuka oleh karyawan → auto-input `gaji_harian` (sumber=auto) berdasarkan rate hari itu (PRD 5.10).
- Audit `opening` dan `auto_input_gaji`.
Error: 409 session_already_opened; 400 invalid_account/missing saldo_awal.

### POST /api/kasir/closing
Request: `{ "saldo_real": [ { "nama_akun": "Tunai Laci", "saldo_real": 585000 } ], "catatan_closing": "opsional" }`
Aturan Closing (PRD 12.2):
- `saldo_sistem = saldo_opening + SUM(mutasi_saldo valid)` per akun.
- `selisih = saldo_real - saldo_sistem` disimpan sebagai rekonsiliasi.
- Closing **TIDAK membuat mutasi baru** dan tidak memotong saldo kedua kali.
Side effects: `kasir_saldo` tipe closing per akun + `kasir_sesi` status=tutup + audit.
Error: 409 session_not_open/session_closed; 400 missing saldo_real.

### POST /api/transaksi
Request:
```
{ "items": [ { "produk_id": 1, "qty": 2 } ],
  "metode_bayar": "tunai" | "transfer" | "bon" | "cash_tunai",
  "pelanggan_id": null, "akun_penerima": "SeaBank",
  "manual_entry": false, "tanggal_transaksi": null }
```
Item jasa "Kirim Uang": tambah `nominal_referensi` (nominal ditransfer) dan `akun_sumber` (akun eksekusi, mis. DANA). Omzet hanya `harga` (biaya admin); `nominal_referensi` murni info.
Aturan metode:
- `tunai` → mutasi +total ke `Tunai Laci`.
- `transfer` → butuh `akun_penerima`; mutasi +total ke akun tsb; `konfirmasi_pembayaran='menunggu'` (dipasang manual/otomatis via NotifHook).
- `bon` → membuat kasbon (`belum_lunas`), **tanpa mutasi saldo** (uang belum diterima).
- `cash_tunai` → mutasi +total ke `Tunai Laci` (asumsi PRD belum merinci; lihat keputusan di bawah).
- Item kirim uang: Tunai Laci + (nominal_referensi + biaya admin); akun_sumber − nominal_referensi (dibuat saat transaksi, bukan Closing).
- `tanggal_transaksi` (YYYY-MM-DD, WIB): tanggal bisnis transaksi. Default hari ini. Boleh mundur (kasus "lupa catat di hari sebelumnya", PRD §5.4) — **tidak boleh masa depan**. `manual_entry: true` menandai input manual dari halaman Laporan. ID `TX-YYYYMMDD-XXX` berbasis `tanggal_transaksi` (bukan created_at); kasbon dari transaksi bon ikut `tanggal_transaksi`.
- `PUT /api/transaksi/:id` juga menerima `tanggal_transaksi` (jika berubah → kode baru sesuai tanggal baru). Mutasi/reversal tetap mengikuti sesi kasir saat ini yang terbuka.
Idempotensi: kirim `Idempotency-Key` → retry balik 200 `{..., "duplicate": true}` tanpa transaksi/mutasi kedua.
Success 200: `{ "id": "TX-20260810-001", "total": 126500, "status": "sukses", "konfirmasi_pembayaran": "...", "created_at", "tanggal_transaksi" }`
ID: `TX-YYYYMMDD-XXX`, nomor urut reset harian WIB.
Side effects: `transaksi`, `transaksi_item`, `mutasi_saldo` (sesuai aturan), `kasbon` (bila bon), audit `create`.
Error: 400 missing items/invalid produk/invalid qty/invalid akun; 409 session_not_open/session_closed.

### GET /api/transaksi
Param filter (kombinasi diperbolehkan):
- `date=YYYY-MM-DD` ATAU `date_from=YYYY-MM-DD&date_to=YYYY-MM-DD` (mutually exclusive).
- `q` (ID transaksi, nama produk, nama pelanggan), `pelanggan_id`, `metode_bayar`, `status_konfirmasi`.
- Paginasi: `limit` (default 100, maks 200), `offset`.
Keterangan: filter tanggal = kalender WIB; backend menerjemahkan ke batas timestamp UTC sebelum query. Data soft-delete tidak tampil.
Success:
```
{ "items": [ { "id": "TX-...", "created_at", "pelanggan_nama", "metode_bayar",
               "konfirmasi_pembayaran", "subtotal", "diskon", "total", "laba",
               "manual_entry", "items": [ ... ] } ],
  "total_items": N, "total_nilai": M, "filter": { ... } }
```

### PUT /api/transaksi/:id (edit / koreksi)
Body sama seperti POST. Aturan (PRD 12.3 / Test G):
- `data_before` & `data_after` masuk `audit_log`.
- Bila transaksi pernah menghasilkan mutasi → dibuat mutasi `reversal` (atomik) lalu mutasi baru untuk nilai koreksi.
- Memerlukan sesi kasir hari ini dalam status buka (reversal tercatat pada sesi hari ini).
Error: 409 session_not_open; 400 invalid items.

### DELETE /api/transaksi/:id
Body opsional: `{ "deleted_reason": "..." }`
Aturan: soft-delete (`deleted_at`, `deleted_by`) + mutasi `reversal` atomik. Histori mutasi lama tidak dihapus.
Success: `{ "id": "TX-...", "status": "soft_deleted", "reversal": N }`

### POST /api/pengeluaran
Request: `{ "deskripsi", "kategori"?, "nominal", "metode_bayar": "tunai"|"transfer", "akun_sumber", "tanggal"? }`
Aturan (PRD 12.4):
- Transfer → 1 mutasi −nominal ke `akun_sumber`.
- Tunai → 1 mutasi −nominal ke akun tunai (mis. `Tunai Laci`).
- `akun_sumber` menentukan akun berkurang; harus akun aktif (`akun_master`).
- Pembelian sparepart belum otomatis menambah stok (stok manual).
Idempotensi: `Idempotency-Key` didukung.
Side effects: `pengeluaran` + `mutasi_saldo` + audit.
Error: 400 missing/invalid; 409 session_not_open.

### PUT/DELETE /api/pengeluaran/:id
Sama pola transaksi: edit/soft-delete memicu `reversal` atomik + audit `data_before`/`data_after`. Tidak menggandakan mutasi lama.

### PUT /api/kasbon/:id — set lunas
Body: `{ "status": "lunas", "akun"? }` (`akun` default `Tunai Laci`).
Side effects: 1 mutasi `kasbon_pelunasan` +nominal ke akun; `lunas_at` di-set. Tidak bisa dibatalkan ke `belum_lunas` (harus reversal resmi).

### POST /api/notifhook
Request header: `X-API-Key`.
Body:
```
{ "idempotency_key": "<hash isi notif + timestamp>",
  "source_app": "DANA"|"SeaBank"|"OrderKuota",
  "transaksi_kode": "TX-20260810-001",   // untuk auto-konfirmasi transfer
  "akun"?: "SeaBank" }
```
Aturan (PRD 9.2, 12.6):
- `idempotency_key` WAJIB; Webhook yang sama hanya diproses sekali (log `notifhook_log`).
- Dengan `transaksi_kode` + toggle auto-input aktif → cocokkan ke transaksi transfer `menunggu` → set `otomatis` + audit.
- Parsing event DANA/SeaBank/OrderKuota OTOMATIS penuh **tidak ditebak**: menunggu data aplikasi nyata (BLOCKED, lihat §Keputusan).
Success: `{ "status": "diterima"|"diproses"|"gagal"|"diabaikan", "duplicate": bool, "transaksi_id": null|N }`
Error: 401 invalid_api_key; 400 invalid_json / missing idempotency_key.

### GET /api/settings (ADMIN)
Return: nama_website, default_theme, app_timezone, notifhook (auto_input, endpoint, api_key, sources, kesehatan/last received), dst.

### PUT /api/users/:id/permissions (ADMIN)
Body: `{ "halaman": ["transaksi", "kasir"] }`
Hard rule (PRD 3.2): role karyawan TIDAK PERNAH boleh diberi `gaji_karyawan` → respon 403 `forbidden_permission`. Nominal gaji hanya admin.

---

## Keputusan yang perlu konfirmasi (FLAG untuk PRD/Team 3)

1. **`cash_tunai`**: tidak dirinci PRD. Implementasi sementara = disetarakan `tunai` (1 mutasi +total ke Tunai Laci). Perlu keputusan resmi.
2. **`bon`**: tidak ada mutasi saldo saat transaksi dibuat; saat lunas via PUT kasbon menghasilkan mutasi `kasbon_pelunasan`. Idempotensi request `bon` tidak dilindungi `mutation_key` (tidak ada mutasi) — UI wajib mencegah submit ganda. Perlu perhatian Team 3.
3. **Kasbon lunas akun penerima** default `Tunai Laci`, bisa diganti via field `akun`.
4. **Logout JWT stateless**: token tidak bisa di-revoke server tanpa sesi store (schema tidak punya). Direspons sukses; klien buang token.
5. **NotifHook auto-parsing provider event**: BLOCKED — PRD 11.4/12.6 melarang menebak package_name/matcher DANA/SeaBank/OrderKuota. Menunggu konfigurasi nyata.

## Endpoint belum diimplementasikan (menunggu sprint)

- PDF export laporan: backend menyediakan CSV (excel-compatible); render PDF dilakukan sisi klien (browser print) agar tidak membebani Worker.

## Laporan Bulanan / Tahunan

### GET /api/laporan/bulan?bulan=2026-08
Return:
```
{ "periode": "bulanan", "bulan": "2026-08",
  "jumlah_transaksi", "omzet", "laba",
  "rekap_kategori": [ { "kategori_id", "nama_kategori", "jumlah_item", "qty", "omzet" } ],
  "kasbon": { "baru", "nominal_baru", "lunas", "belum_lunas", "nominal_belum_lunas" },
  "pengeluaran": { "jumlah", "total" }, "net",
  "perbandingan_bulan_sebelumnya": { "bulan", "omzet", "laba", "pengeluaran" } }
```
Catatan: rekap kategori memakai snapshot `transaksi_item`; omzet dekati `SUM(subtotal)` item. Laba = `SUM(laba)` transaksi. `net = laba − pengeluaran` (PRD 5.4, 11.1). Periode laporan memakai **`tanggal_transaksi`** (tanggal bisnis WIB), jadi transaksi manual backdate (kasus lupa catat) tercatat di bulan/tahun yang benar; `created_at` tetap sebagai jejak teknis input.

### GET /api/laporan/tahun?tahun=2026
Return:
```
{ "periode": "tahunan", "tahun", "jumlah_transaksi", "omzet", "laba",
  "pengeluaran": {...}, "net",
  "breakdown_12_bulan": [ { "bulan", "omzet", "jumlah_transaksi", "laba", "pengeluaran", "net" } ],
  "ranking_kategori_terlaris": [ { ...qty, omzet... } ] }
```

### GET /api/laporan/export?cakupan=bulan&bulan=2026-08
`Content-Type: text/csv` (UTF-8 BOM agar terbuka rapi di Excel). Baris: header `JENIS,ID,TANGGAL/WAKTU,PELANGGAN/DESKRIPSI,METODE,NOMINAL,LABA,CATATAN/EKSTRA`, lalu `TRANSAKSI,...` dan `PENGELUARAN,...`.

## Tanda tangan dokumen

- Owner: TEAM 1 (Core & Backend)
- Status: READY_FOR_REVIEW
- Perubahan kontrak harus di-notifikasi ke Team 2 & Team 3 (Rule 2 kolaborasi).