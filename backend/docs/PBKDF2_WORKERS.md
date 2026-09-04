# IRKOP CELL — BLOCKER-3 / FREE PLAN: PBKDF2 di Cloudflare Workers

Status: FIXED — parameter final **12.000 iterasi, PBKDF2-HMAC-SHA256 native `crypto.subtle`**, diukur langsung di Workers runtime (Metrics `cpuTimeMs`).
File: `src/lib/password.js`.

## Konteks & keputusan

- workerd membatasi PBKDF2 Web Crypto `crypto.subtle.deriveBits` **maksimal 100.000 iterasi** (`NotSupportedError`).
- Plan worker = **Workers Free**: CPU **10 ms/request** (Paid 30 s default, s.d. 5 mnt via `limits.cpu_ms`).
- Keputusan pemilik (option B): **tetap di Free**, turunkan iterasi — bukan naikkan plan.
- Ukur **di Workers runtime asli** via `cpuTimeMs` (Metrics/GraphQL `workersInvocationsAdaptive.quantiles.cpuTimeP50`), bukan Node. Hasil:
  (alat: `backend/bench/workers-pbkdf2-bench.mjs` + `scan-pbkdf2.mjs`)

  | iter | cpuP50 | cpuP90 | per_iter |
  |------|--------|--------|----------|
  | 5000 | 2.72ms | 2.72ms | 0.543us |
  | 10000 | 2.56ms | 2.60ms | 0.256us |
  | 12000 | 5.36ms | 5.91ms | 0.447us |
  | 15000 | 3.88ms | 3.88ms | 0.259us |
  | 18000 | 6.25ms | 7.10ms | 0.347us |
  | 20000 | 5.04ms | 5.81ms | 0.252us |

- Data per menit berisik (p50 dari ~25 sampel). Dipakai model konservatif 0.35µs/iter + ~1ms overhead (cocok dgn 12000 & 18000); 12000 ÷ 5.2ms p50 → **margin ~48% dari 10ms**. Nilai terbesar yang ber-margin aman = **12.000** (15k: ~6.2ms, tipis; 20k: ~8ms, tanpa margin).

## Implementasi (`src/lib/password.js`)

- Jalur utama: **`crypto.subtle` native (BoringSSL)** PBKDF2-HMAC-SHA256, iterasi **12.000** (≤ cap 100k), salt acak 16 byte, dkLen 32.
- Fallback **pure-JS (RFC 2898)** **hanya untuk verify hash legacy** ber-iterasi >100k (era 210k) yang ditolak `crypto.subtle` di workerd — tidak dipakai untuk hash baru.
- Format hash **tidak berubah**: `pbkdf2$v1$<iterasi>$<salt_b64>$<hash_b64>`; hash legacy 210k tetap terverifikasi (bit-exact sama, sudah diuji lintas-runtime).
- `verifyPassword` menolak iterasi < 1 atau > 1.000.000 dan base64 rusak → `false` (tanpa throw).
- API `hashPassword`/`verifyPassword`/`randomToken` tidak berubah.

## Keamanan

- 12.000 iterasi native lebih kuat dari opsi pure-JS yang bisa muat 10ms (~4k) dan memakai BoringSSL (audit Cloudflare) bukan crypto JS buatan sendiri.
- Di bawah rekomendasi OWASP (600k/SHA-256) — kompromi eksplisit demi Workers Free (10ms); dicatat sebagai risiko residu + rekomendasi: bila traffic naik, evaluasi naik ke Paid (30s CPU) dan naikkan iterasi (mis. 100k native).

## Limitation: verifikasi legacy 210k di Workers

- verify hash legacy 210k lewat fallback pure-JS ≈ lambat (Node ~17 s, workerd V8 jauh lebih cepat namun tetap >10ms) → **melebihi budget Free bila dipicu**. D1 production users = 0, sehingga tidak ada hash legacy yang harus diverifikasi. Jika nanti muncul, lakukan re-hash saat login (verify legacy lalu simpan hash 12k baru).

## Verifikasi

1. `npm test` → **60/60 PASS**:
   - `tests/password.test.js` (10): format 12000, verify benar/salah/hash rusak (tanpa throw), konsistensi lintas-runtime, legacy 210000 valid (fallback), salt acak, reject pendek, timing.
   - `tests/workers-compat.test.js` (5): statis (native 12000 + cap 100k + fallback pure-JS ada), simulasi cap workerd (NotSupportedError) → hash/verify 12000 jalan, legacy 210k jalan via fallback, **bootstrap → login → me** utuh.
2. `npx wrangler deploy --dry-run` → PASS.
3. Benchmark runtime asli diisi ulang bila parameter diubah (file `backend/bench/*`).

### Catatan: workerd tidak bisa dijalankan di sandbox ini

`wrangler dev` tidak bisa start (termux/proot; tcmalloc `MmapAligned()` gagal region 1 GB — murni keterbatasan lingkungan).
Bukti pengganti yang diberikan saat BLOCKER-3:
- simulasi cap workerd yang presisi (NotSupportedError sama) — seluruh alur auth (bootstrap→login→me) lulus;
- kesamaan bit-exact & lintas-runtime dengan PBKDF2 referensi;
- **angka CPU final dari Cloudsflare Metrics** (`workersInvocationsAdaptive.cpuTimeP50`) pada worker `konter-pbkdf2-bench` — bukan Node.

## Tidak diubah

- Schema D1, API contract, financial engine (`src/financial/*`), worker produksi `konter`, plan: **tidak disentuh**.
- Yang berubah: `src/lib/password.js` (+test +docs); tambahan `backend/bench/*` (alat ukur; tidak di-deploy ke produksi).