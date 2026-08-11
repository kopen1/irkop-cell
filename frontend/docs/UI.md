# Iirkop Cell — Frontend (TEAM 2)

Frontend untuk **Iirkop Cell**: POS & Buku Kas Digital (PPOB + Service HP).
Teknologi: **React 19 + Vite**. Hosting target: Cloudflare Pages.
Backend: Cloudflare Workers (Team 1) — lihat `../docs/API_CONTRACT.md`.

## Cara menjalankan

```bash
npm install
cp .env.example .env.local   # sesuaikan VITE_API_BASE
npm run dev                   # dev server (proxy /api → http://localhost:8787)
```

- `VITE_API_BASE` — base URL API (kosong = origin server `/api`).
- `VITE_API_PROXY` — target proxy dev untuk `/api` (default `http://localhost:8787`).

## Skrip

| Perintah | Fungsi |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | build production ke `dist/` |
| `npm run lint` | oxlint |
| `npm test` | vitest (unit + smoke) |

## Struktur

```
src/
├── components/
│   ├── layout/        # AppShell, Sidebar, Topbar, BottomNav, Guard (auth/permission)
│   ├── transaksi/     # TransaksiForm (multi-item), TransaksiDetail (+ struk print)
│   └── ui/            # Button, Card, Field/Input/Select, Modal/ConfirmDialog,
│                      # Toast, Table, Badge, States (loader/empty/error), Icon
├── context/           # AuthContext, ThemeContext, ToastContext
├── hooks/             # useAsync, useDebounce
├── lib/               # api client (API Contract), format (rupiah/date WIB), routes (permission)
└── pages/             # 12 halaman (Login, Dashboard, Transaksi, Kasir, Laporan,
                       # Daftar Barang, Service HP, Kasbon, Pelanggan, Pengeluaran,
                       # Gaji, Pengaturan)
```

## Integrasi API (API Contract Team 1 v1.0)

Frontend memakai endpoint resmi. **Frontend TIDAK menghitung saldo/omzet** —
semua nilai finansial adalah hasil backend (`mutasi_saldo` = source of truth).
Idempotency: operasi finansial POST mengirim header `Idempotency-Key`.

### Dependensi aktif
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/kasir/current`, `POST /api/kasir/opening`, `POST /api/kasir/closing`
- `GET/POST /api/transaksi`, `GET/PUT/DELETE /api/transaksi/:id`
- `GET/POST /api/produk`, `PUT/DELETE /api/produk/:id`, `GET/POST /api/kategori`
- `GET/POST /api/pelanggan`, `GET /api/pelanggan/:id`, `POST /api/pelanggan/merge`
- `GET/POST /api/kasbon`, `PUT /api/kasbon/:id`
- `GET/POST /api/pengeluaran`, `GET/PUT/DELETE /api/pengeluaran/:id`
- `GET/POST /api/service-hp`, `GET/PUT /api/service-hp/:id`
- `GET/POST/PUT /api/gaji`, `GET/POST /api/gaji/rate`
- `GET/POST/PUT /api/users`, `PUT /api/users/:id/permissions`
- `GET/POST/PUT /api/akun`
- `GET/PUT /api/settings`, `POST /api/settings/generate`, `POST /api/settings/notifhook-source`
- `GET /api/logs`
- `GET /api/laporan/bulan?bulan=YYYY-MM` · `GET /api/laporan/tahun?tahun=YYYY` · `GET /api/laporan/export?cakupan=bulan|tahun` (CSV)

### WAITING_DEPENDENCY
Tidak ada lagi. Semua fitur Laporan Bulanan/Tahunan + Export + Transaksi Manual (PRD 5.4) sudah aktif mengacu kontrak API resmi.

## Aturan yang dijaga

- **Timezone bisnis `Asia/Jakarta` (WIB)** untuk semua tampilan & filter tanggal (lihat `lib/format.js`).
- **Laporan hanya Bulanan & Tahunan** (tidak ada filter Harian, PRD 5.4).
- **Filter Transaksi**: 1 tanggal ATAU rentang (mutually exclusive), `q`, `metode_bayar`, `status_konfirmasi`. Ringkasan `total_items`/`total_nilai` dari backend.
- **Closing = rekonsiliasi**; UI Kasir hanya menampilkan nilai backend, tidak membuat pengurangan kedua.
- **HARD RULE permission**: `gaji_karyawan` & `pengaturan` tidak pernah diberikan ke role Karyawan (PRD 3.2). Dijaga di navigasi (`lib/routes.js`, `canAccess`) dan guard rute; backend tetap penjaga utama.
- **Soft-delete + reversal**: tombol Hapus pada transaksi/pengeluaran memicu konfirmasi lalu memanggil DELETE; reversal dibuat backend secara atomik.
- **Tidak ada tombol CRUD tanpa endpoint backend** (kategori hanya GET/POST sesuai contract).
- **Tema**: default Classic Navy & Gold; tema tidak mengubah data/aturan bisnis.

## Testing

- `src/lib/__tests__/` — unit test `format` (rupiah/date WIB) & `routes` (permission-aware navigation, hard rule gaji).
- `src/components/__tests__/app.smoke.test.jsx` — smoke render: login, tema default, redirect rute tanpa auth, PLUS smoke halaman terautentikasi (Laporan render dari `GET /api/laporan/bulan` sesuai kontrak, dengan fetch stub).
- `npm test` = 4 files, 21 test. `npm run build` + `npm run lint` hijau.
- Catatan: `AppShell` memakai `<Outlet />` (React Router). Sebelumnya memakai prop `children` via `RequireAuth` yang menelannya sehingga <main> semua halaman terautentikasi tampil kosong — sudah diperbaiki.
- Smoke test terpisah: `src/components/__tests__/app.smoke.test.jsx` (3 test) dan `src/components/__tests__/laporan.smoke.test.jsx` (1 test).

## Catatan untuk Team 3

Mohon diuji saat integrasi:
1. Alur Opening → transaksi (Tunai/Transfer/Bon) → Closing; pastikan tidak ada mutasi ganda.
2. Filter Transaksi satu tanggal & rentang terhadap WIB.
3. Hapus/edit transaksi & pengeluaran → reversal + audit.
4. Hard rule: Karyawan tidak pernah melihat nominal gaji (UI & API).
5. Responsive: sidebar/hamburger, bottom nav, tabel/filter/form di mobile.
6. Theme: Classic Navy & Gold + Paper Buku Kas tetap kontras & terbaca.

## Menjalankan UI sambil backend dev

```bash
# terminal 1 (backend Team 1, dari folder /root/konter/Revisi)
npm run db:local && npm run dev

# terminal 2 (frontend)
cd /root/konter/Revisi/frontend && npm run dev
```

Buka `http://localhost:5173`. Proxy dev `/api` diarahkan ke Worker lokal.