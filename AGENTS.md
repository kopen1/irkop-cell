# AGENTS.md — IRKOP CELL

Panduan untuk AI/agent (dan developer) yang bekerja di repo ini. Baca ini dulu
sebelum mengubah apa pun. Aturan global di `~/.config/opencode/AGENTS.md` tetap berlaku;
file ini menambah konteks khusus project.

---

## 1. Apa ini

Aplikasi **POS & Buku Kas Digital** untuk konter PPOB / service HP.
Mengelola transaksi, kasbon, pengeluaran, service HP, payroll, laporan, harga server.

- **Repo:** github.com/kopen1/irkop-cell
- **Frontend web:** https://konter.irkop.eu.org (Cloudflare Pages)
- **Backend API:** https://konter.irkop.workers.dev (Cloudflare Worker `konter`)
- **DB:** Cloudflare D1 `irkop-d1`
- **Bahasa UI & kode:** Indonesia (nama variabel/kolom/route pakai istilah bisnis)

## 2. Struktur

```
irkop-cell/
  backend/     Cloudflare Worker (ESM, TANPA dependency runtime)
    src/
      index.js            entry + router manual + dispatch (cron trigger juga di sini)
      lib/                auth, jwt, password, time(WIB), validate, errors, audit, db, rateLimit
      routes/             per-domain handler (transaksi, kasir, akun, pelanggan, hargaServer, ...)
      financial/          mesin finansial: mutasi, reversal, kasir(sesi), akun, gaji, tarif
      cron/priceCheck.js  fetch harga OrderKuota (cron Senin)
    migrations/           0001..0009 (SQL D1)
    tests/                node:test + adapter D1 in-memory (node:sqlite)
    dev-server.js         server LOKAL (tanpa workerd) — lihat §5
    seed.js               seed kategori+produk contoh untuk lokal
  frontend/    React 19 + Vite 8
    src/pages/            halaman (Dashboard, Transaksi, Kasir, Laporan, Pengaturan, HargaServer, ...)
    src/components/       ui/, layout/, transaksi/, service/
    src/context/          Auth, Theme, Toast
    src/lib/              api.js, format.js, routes.js, csv.js, offline-*.js (Capacitor)
    functions/api/[[path]].js  proxy Pages -> Worker
    android/              Capacitor Android
  mobile/      Capacitor config & sync script
  .github/workflows/   build-apk.yml, deploy-backend.yml, deploy-frontend.yml
```

## 3. Prinsip wajib (jangan dilanggar)

- **Source of truth uang = tabel `mutasi_saldo`.** Saldo = opening + sum(mutasi).
  Jangan menyimpan/ menghitung saldo di FE.
- **Idempotency:** operasi finansial pakai header `Idempotency-Key` + `mutation_key`
  UNIQUE. Jangan hapus mekanisme ini.
- **Soft delete** untuk transaksi/produk/pengeluaran/service (`deleted_at`).
  Edit/hapus memicu **reversal** atomik (`financial/reversal.js`), bukan update mutasi lama.
- **Timezone bisnis = WIB (UTC+7)** di `lib/time.js`. Tanggal bisnis `YYYY-MM-DD`.
- **Uang = INTEGER rupiah** (tanpa desimal/float).
- **Hard rule:** role `karyawan` tidak pernah dapat akses `gaji_karyawan`/`pengaturan`.
  Ditegakkan di BE (`requirePage`/`requireAdmin`) dan FE (`lib/routes.js`).
- **Jangan tambah dependency** (BE sengaja zero-dep; FE hanya yang sudah ada) tanpa izin.
- **Jangan commit/push** tanpa perintah eksplisit user.

## 4. Menjalankan

### 4a. Backend LOKAL (WAJIB — bukan wrangler)

`workerd`/`wrangler dev` TIDAK jalan di Android/Termux. Gunakan `dev-server.js`
(Node + `node:sqlite`, meniru D1):

```bash
cd backend
npm run dev:local          # http://localhost:8787, DB di backend/.dev-data/irkop.db
npm run dev:local -- --fresh  # reset DB dulu (HATI-HATI: menghapus data)
```

- Login default: **admin / admin1234** (auto-seed saat DB kosong).
- Saat DB kosong, `seed.js` otomatis mengisi kategori + 49 produk contoh.
- **JANGAN hapus `.dev-data/` saat server jalan** (SQLite masih memegang file yang sudah
  terhapus → data "nyangkut"). Stop server dulu, atau pakai `--fresh`.
- Kalau port 8787 dipakai: matikan `dev-server` lama (`pkill -f "node dev-server.js"`).
- Data **persist** antar restart. Sesi kasir juga persist — tidak perlu buka kasir tiap refresh.

### 4b. Frontend

```bash
cd frontend
npm run dev                # http://localhost:5173, proxy /api -> localhost:8787
```

`frontend/.env` (gitignored) untuk lokal:
```
VITE_API_BASE=/api
VITE_API_PROXY=http://localhost:8787
```

Catatan Termux: install dengan `npm install --no-bin-links` (external storage tidak
support symlink). Karena itu `package.json` memanggil binary via `node node_modules/...`
(jangan dikembalikan ke `vite`/`vitest` polos — nanti "not found" di Termux).

### 4c. Backend production (Cloudflare)

```bash
cd backend
npx wrangler login
npx wrangler dev --remote      # butuh workerd? tidak; remote mode
npx wrangler deploy
```

## 5. Migrasi D1 (PENTING)

- File migrasi ada di `backend/migrations/`. Workflow deploy **TIDAK** menjalankan migrasi;
  migrasi diterapkan **manual** oleh user di Cloudflare D1 Console (satu statement per jalan).
- Urutan aman: **deploy kode dulu**, baru jalankan migrasi (mis. migrasi yang mengubah
  daftar akun).
- Migrasi bersifat additive; `ALTER TABLE ADD COLUMN` tidak punya `IF NOT EXISTS`, jadi
  re-run bisa error "duplicate column" — abaikan bila sudah terpasang.
- Sudah ada: 0008 harga server, 0009 nonaktifkan akun ledger.

## 6. Domain penting

### 6a. Akun uang vs akun ledger
- **Akun uang:** `tunai`, `bank`, `e_wallet`, `digital` (di `akun_master`).
- **Akun ledger bawaan (BUKAN akun uang, tidak perlu ada di `akun_master`):**
  `Saldo Akun`, `Total Saldo`, `Laba` (lihat `financial/akun.js` → `isLedgerAkun`).
- `listActiveAccounts`/`listAllAccounts` **mengecualikan** akun ledger.
- `getAccount` mengenali akun ledger tanpa query DB; `routes/akun.js` menolak
  membuat/mengganti nama ke nama ledger (`reserved_name`).
- **Kasir (opening/closing) hanya akun uang.** Baris **"Total Saldo" = jumlah akun uang
  KECUALI `Tunai Laci`** (jadi: hanya bank/e-wallet/digital; tanpa uang fisik, tanpa Laba).
  Backend mengabaikan akun ledger bila dikirim klien lama.

### 6b. Jenis transaksi (route /transaksi)
- `jenis` null/`penjualan`: jual produk fisik; mutasi ke Tunai Laci/akun penerima + Laba.
  **Tidak** mengurangi akun digital.
- `jenis: 'produkdigital'`: WAJIB dikirim FE. Menyertakan `akun_sumber` = akun digital
  sumber modal → akun itu **berkurang** sebesar total modal. Ada test di
  `tests/produkdigital.test.js` (jangan sampai FE lupa mengirim `jenis` lagi).
- `jenis: 'tariktunai'` / `'transfer'`: jalur admin (`createAdminTransaksi`), tanpa item produk.
- `service`: buat record `service_hp` + 1 transaksi.

### 6c. Pelanggan & alias
- `pelanggan_alias` (tipe: `nama` / `no_rekening` / `no_hp`, sumber `manual`/`notifhook_auto`).
- CRUD alias: `POST /api/pelanggan/:id/alias`, `PUT|DELETE /api/pelanggan/alias/:id`.
- Merge pelanggan menambah alias `"<nama> (merge dari id N)"`.

### 6d. Harga Server (perbandingan harga OrderKuota)
- Tabel `harga_server`, `harga_server_log`, `harga_alert` (migrasi 0008).
- `GET /api/harga-server/perbandingan` (join `produk.kode = harga_server.kode_produk`).
- `POST /api/harga-server/update-modal`: samakan `produk.harga_modal` ke `harga_server`
  (margin jual lama dipertahankan). Body: `{ kode }`, `{ kode_list }`, atau `{ all_naik:true }`.
- Cron `cron/priceCheck.js` tiap Senin 08:00 UTC (15:00 WIB), atau manual via
  `POST /api/price-check` (admin only, juga jalan di dev-server lokal).
- **Bisa di-fetch** (halaman server-rendered, kolom `kode | nama | harga_beli | harga_jual`):
  - `cetak-voucher` — 7 halaman, filter `harga < 100.000` + named "Jateng".
  - `pulsa/{indosat,axis,xl,three,smartfren,telkomsel}` — kategori `pulsa`, filter
    **nominal ≤ 100.000**. Kode OrderKuota = kode produk lokal (`A10`, `X5`, `T15`),
    jadi tidak perlu auto-link.
- **TIDAK bisa di-fetch**: DANA / GoPay / OVO / Token. `/harga/{dana,gopay,ovo,token}`
  hanya mengembalikan halaman generik yang isinya sama dengan halaman pulsa (bukan
  daftar harga e-wallet). Harga e-wallet harus diisi manual lewat Import.
- Harga yang "terbaca" 0 dari OrderKuota biasanya berarti request dari IP Cloudflare
  diblokir — cek `pulsa.fetched` pada respons `POST /api/price-check`.

## 7. Testing

```bash
cd backend  && npm test     # node:test + D1 in-memory (adapter: tests/d1adapter.js)
cd frontend && npm test     # vitest
cd frontend && npm run build
cd frontend && npm run lint # oxlint
```

- Semua test harus hijau sebelum dianggap selesai.
- Helper test BE: `tests/helpers.js` (`setupEnv`, `call`, `login`, `createUserRaw`,
  `createKategoriRaw`, `createProdukRaw`).

## 8. Deployment (otomatis via GitHub)

Push ke `main` memicu:
- `deploy-backend.yml` → wrangler deploy (TIDAK migrasi DB).
- `deploy-frontend.yml` → Cloudflare Pages (butuh `frontend/.env.production` = `VITE_API_BASE=/api`).
- `build-apk.yml` → APK Capacitor (artefak).

Pastikan `frontend/.env.production` ada; kalau tidak, `VITE_API_BASE` kosong dan FE
memanggil `/auth/...` (bukan `/api/auth/...`) → error.

## 9. CORS

Whitelist di `backend/src/index.js` (`corsHeaders`):
`https://konter.irkop.eu.org`, `https://irkop-cell.pages.dev`,
`https://localhost`, `capacitor://localhost`. Tambah origin baru bila perlu.

## 10. Referensi

- Kontrak API resmi: `backend/docs/API_CONTRACT.md`
- README project: `README.md`
- Bootstrap admin pertama: `backend/docs/FIRST_ADMIN_BOOTSTRAP.md`
