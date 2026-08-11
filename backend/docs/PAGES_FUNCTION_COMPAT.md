# IRKOP CELL — Kompatibilitas Pages Function Proxy (untuk Team 2)

Status: selesai review (BLOCKER-1 Release Agent).
Tujuan: memastikan backend (Cloudflare Worker) kompatibel dengan solusi Pages Function proxy yang akan dibuat Team 2, TANPA mengubah business logic finansial.

## Ringkasan hasil

Backend **sudah kompatibel** — tidak ada perubahan bisnis/perilaku yang diperlukan.
Yang dilakukan Team 1:

1. Review routing (`src/index.js`) — verifikasi semua method + header + body.
2. Menambah suite test `tests/proxy-compat.test.js` yang mensimulasikan proxy (host Pages berbeda) dan memverifikasi seluruh persyaratan BLOCKER-1.
3. Perbaikan bug routing kecil: `match()` untuk subroute `/api/auth/*` tidak mengekstrak param → `GET /api/auth/me` dan `POST /api/auth/logout` (dipakai frontend) balas 404. Sekarang param diekstrak (`seg[1] ?? null`). Tidak menyentuh financial engine.

## Yang harus diteruskan proxy (persis)

Frontend (`frontend/src/lib/api.js`) mengirim:

| Header | Kapan |
|---|---|
| `Accept: application/json` | selalu |
| `Authorization: Bearer <token>` | semua kecuali login & webhook |
| `Content-Type: application/json` | saat ada body |
| `Idempotency-Key: <string>` | operasi finansial retry-safe |

Petunjuk untuk Team 2:
- **Path wajib dipertahankan**: backend mencocokkan `pathname` mulai dari `/api/...` dan mengabaikan host, jadi host Pages Function bebas. Forward URL dengan path asli + query string (`?bulan=`, `?tahun=`, `?date=`, dsb).
- **Jangan re-encode body**: forward body JSON mentah apa adanya; jangan ubah `Content-Type`.
- **Jangan ubah/lempar header `Authorization`, `Idempotency-Key`, `X-API-Key`, `X-Bootstrap-Secret`.**
- **Jangan parse/serialize ulang response JSON**: forward response byte-per-byte. Error shape sudah konsisten `{ "error": { "code", "message" } }` di semua status.
- **CSV export bukan JSON**: `GET /api/laporan/export` mengembalikan `text/csv` + `Content-Disposition: attachment`. Proxy TIDAK boleh mencoba `res.json()`; forward sebagai blob/teks dengan content-type (frontend `downloadFile` memakai blob).

## Checklist persyaratan BLOCKER-1

| Persyaratan | Status | Bukti |
|---|---|---|
| Semua HTTP method API didukung (GET/POST/PUT/DELETE) | ✅ | `dispatch()` switch method per route; test proxy GET/POST/PUT/DELETE |
| POST/PUT/PATCH/DELETE tidak rusak | ✅ | test proxy POST transaksi, PUT produk, DELETE transaksi (soft-delete + reversal) |
| Authorization header diterima | ✅ | `readAuthHeader` (`Bearer ...`); test 401 tanpa token |
| Request body diteruskan benar | ✅ | `readBody()` → `request.json()`; test valid + invalid JSON (400 `invalid_json`) |
| Response/error shape sesuai contract | ✅ | `json()`/`handleError()` seragam; test `assertErrorShape` untuk 401/400/404 |
| Tidak ada perubahan business logic finansial | ✅ | tidak ada perubahan di `src/financial/*` |

## Method yang TIDAK ada di kontrak

- `PATCH`: tidak dipakai. Setelah auth → 404 `not_found` (test).
- `OPTIONS`: tidak ada di kontrak. Karena frontend memakai `VITE_API_BASE=''` (same-origin `/api`), preflight CORS tidak terjadi. Jika kelak ada panggilan cross-origin, tangani `OPTIONS` di lapisan Pages Function (bukan Worker).

## Temuan pada implementasi proxy Team 2 (wajib disesuaikan sebelum go-live)

Review atas `frontend/functions/api/[...path].ts` menemukan 3 hal yang perlu diperbaiki Team 2:

1. **Body DELETE tidak diteruskan.** Daftar `bodyAllowed = ['POST','PUT','PATCH']` tidak memuat `DELETE`, padahal frontend mengirim body pada DELETE (transaksi `deleted_reason`, pengeluaran). Dampak saat ini: soft-delete tetap jalan (backend toleran terhadap `{}`), tapi `deleted_reason` hilang dari audit. → tambahkan `'DELETE'` ke `bodyAllowed`.
2. **Header `X-Bootstrap-Secret` tidak diteruskan.** Tidak ada di allowlist header proxy. Karena BLOCKER-2 menambah endpoint `POST /api/auth/bootstrap` (wajib header ini), bootstrap melalui proxy akan selalu 403. → tambahkan `x-bootstrap-secret` ke daftar header yang di-forward.
3. **`Content-Disposition` response dibuang.** Allowlist header response tidak memuat `content-disposition`, sehingga nama file CSV bawaan server hilang. Frontend `downloadFile` tetap jalan (pass filename sendiri), tapi nama server hilang. → tambahkan `content-disposition` ke allowlist.

CATATAN LOKASI: file proxy saat ini hanya ada di direktori lama `Revisi/frontend/functions/`, BELUM ada di repo aktif `/root/konter/frontend/`. Pastikan Team 2 memindahkan hasilnya ke repo aktif sebelum deployment.

## Catatan verifikasi produksi (bersama Team 3)

1. Setelah proxy live, jalankan smoke: login → `/api/auth/me` → buka kasir → transaksi → closing → export CSV.
2. `Authorization` tidak boleh jatuh di log proxy (jangan log header).
3. Bootstrap production wajib lewat proxy dengan `X-Bootstrap-Secret` ter-forward (lihat `docs/FIRST_ADMIN_BOOTSTRAP.md`).
