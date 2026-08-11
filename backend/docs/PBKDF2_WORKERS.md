# IRKOP CELL — BLOCKER-3: PBKDF2 di Cloudflare Workers

Status: FIXED (menunggu regression QA Team 3 & re-deploy oleh Release Agent).
File: `src/lib/password.js`.

## Root cause

`src/lib/password.js` sebelumnya memakai Web Crypto `crypto.subtle.deriveBits({ name: 'PBKDF2', iterations: 210000 })`.
Cloudflare Workers (workerd) membatasi PBKDF2 Web Crypto **maksimal 100.000 iterasi**:

```
NotSupportedError: iteration counts above 100000 are not supported (requested 210000).
```

Node.js tidak punya batas ini, sehingga seluruh test backend (login, bootstrap, dst.) lulus secara lokal
padahal di production Worker request gagal 500. **Test PASS di Node bukan bukti kompatibel dengan Workers.**

## Perbaikan

`src/lib/password.js` kini mengimplementasikan **PBKDF2-HMAC-SHA256 murni JavaScript (RFC 2898)**:

- Tidak memanggil `crypto.subtle` sama sekali untuk hash/verifikasi (bukti: test statis).
- Parameter PRD dipertahankan: **210.000 iterasi**, PBKDF2-HMAC-SHA256, salt acak 16 byte per password.
- SHA-256 ditulis sendiri (pure JS) — bekerja identik di Node, workerd, dan browser.
- Optimasi: state SHA-256 untuk `ipad`/`opad` di-precompute sehingga hanya 2 kompresi per iterasi (~510–615 ms per operasi di Node V8 / workerd V8).
- `hashPassword()` / `verifyPassword()` / `randomToken()` signature API tidak berubah.
- Format hash **tidak berubah**: `pbkdf2$v1$<iterasi>$<salt_b64>$<hash_b64>`. PBKDF2-HMAC-SHA256 standar → hasil **identik** dengan hashing crypto.subtle lama → **tidak perlu migrasi/re-hash**.

## Alasan keamanan

- Iterasi 210.000 dipertahankan persis seperti PRD (tidak diturunkan ke ≤100.000).
- Standar PBKDF2 (RFC 2898) dengan HMAC-SHA256 — bukan konstruksi ad-hoc; output diverifikasi sama dengan implementasi referensi (Node crypto, OpenSSL).
- Salt acak 16 byte per password; verifikasi memakai perbandingan constant-time.
- `verifyPassword` toleran terhadap hash rusak/base64 invalid (return false, tidak throw).

## Catatan performa & CPU (Workers)

- 210.000 iterasi ≈ **510–615 ms CPU** per operasi hash/verify (di Node V8; workerd V8 serupa).
- CPU dihitung terhadap limit Workers: **Free 10 ms, Paid default 30 s** (dapat dinaikkan sampai 5 menit via `limits.cpu_ms`).
- **WAJIB production di plan Paid** (default 30 s) — login (~0.5 s CPU) aman. Di plan Free, pure-JS maupun crypto.subtle PBKDF2 tidak muat di 10 ms.
- Login = 1× verify (~0.5 s); create/update user & bootstrap = 1× hash (~0.6 s).

## Verifikasi

1. `npm test` → **58/58 PASS**, termasuk:
   - `tests/password.test.js` (8): format hash, verify benar/salah, hash rusak, konsistensi lintas-runtime (hash Node crypto 210k terverifikasi), salt acak, reject password pendek, timing.
   - `tests/workers-compat.test.js` (4): bukti statis password.js tanpa `crypto.subtle`; simulasi cap workerd (`deriveBits` PBKDF2 >100k → NotSupportedError) dan seluruh alur **bootstrap → login → me** tetap lulus di bawah cap tersebut.
2. `npx wrangler deploy --dry-run` → PASS (bundle 127.72 KiB / gzip 26.47 KiB).

### Catatan: workerd tidak bisa dijalankan di sandbox ini

Runtime workerd (`wrangler dev`) **tidak dapat start di lingkungan kerja ini** karena batasan lingkungan
(termux/proot; tcmalloc gagal `MmapAligned()` untuk region tagged 1 GB — `sandbox/VSS limitations`),
bukan karena kode. Bukti pengganti yang diberikan:
- kode hash/verify **tanpa** `crypto.subtle` (cap PBKDF2 100k tidak mungkin terpicu);
- simulasi cap workerd yang **presisi** (NotSupportedError yang sama) — seluruh alur auth lulus;
- kesamaan bit-exact dengan PBKDF2 referensi di 210k iterasi.

Langkah verifikasi runtime yang disarankan untuk Release Agent/Team 3 di environment normal:

```bash
cd backend
echo "BOOTSTRAP_SECRET=<secret>" > .dev.vars   # secret lokal, jangan commit
npx wrangler dev --port 8787
# lalu:
curl -X POST http://127.0.0.1:8787/api/auth/bootstrap -H 'Content-Type: application/json' -H 'X-Bootstrap-Secret: <secret>' \
  -d '{"nama":"Admin","username":"admin","password":"<password min 8>","role":"admin"}'
curl -X POST http://127.0.0.1:8787/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<password>"}'
# keduanya harus 200 (bukan 500 NotSupportedError)
```

## Tidak diubah

- Schema D1, API contract, financial engine (`src/financial/*`): **tidak disentuh**.
- Hanya `src/lib/password.js` + test + docs.
