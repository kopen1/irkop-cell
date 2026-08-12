// SAFE PBKDF2-HMAC-SHA256 WORKLOAD worker for Cloudflare Workers Free (10ms CPU/req).
// Worker ini hanya MENGHASILKAN beban: satu derive per request. Ia TIDAK
// menentukan parameter final, dan self-timing (performance.now) di dalamnya
// TIDAK valid (pengukuran 0.00ms – klok isolat tidak berdetak selama native
// crypto.subtle berjalan). Sumber CPU yang sah = Metrics worker: cpuTimeMs.
//
// Protokol (Metrics-first):
//   1) Deploy scratch worker ini (terpisah dari worker `konter` / D1):
//        npx wrangler deploy bench/workers-pbkdf2-bench.mjs --name konter-pbkdf2-bench
//   2) Jalankan burst scan dari nilai RENDAH naik bertahap:
//        node bench/scan-pbkdf2.mjs https://konter-pbkdf2-bench.<sub>.workers.dev
//   3) Tunggu ±5 menit (latensi analitik), lalu baca cpuTimeMs asli:
//        CF_ACCOUNT_ID=... CF_API_TOKEN=... node bench/scan-pbkdf2.mjs --report
//   4) Konfirmasi nilai pilihan di Dashboard/Metrics lalu finalisasi di HQ.
//
// Guard keselamatan Free:
//   - SATU nilai iterasi per request -> CPU per request terkendali.
//   - Warmup murah (1000) lalu satu pengukuran -> total per request kecil.
//   - HARD_CEIL=20000: iter > 20000 DITOLAK (413) agar sebuah request tunggal
//     mustahil melampaui budget (batas aman ditemukan jauh di bawah ini).
//   - Tanpa pure-JS (bukan jalur produksi; dan memperbesar risiko 1102).

const KEY_LEN = 32;
const enc = new TextEncoder();
const WARM_ITER = 1000;
const HARD_CEIL = 20000;
const MAX_ITER = 100000;

const PW = 'bench-password-123';
const SALT = 'bench-salt-16bytes';

async function derive(iterations) {
  const km = await crypto.subtle.importKey('raw', enc.encode(PW), 'PBKDF2', false, ['deriveBits']);
  const t0 = performance.now();
  await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(SALT), iterations },
    km,
    KEY_LEN * 8
  );
  return { ms: performance.now() - t0 };
}

const text = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

const help = () => `
SAFE PBKDF2 workload worker (crypto.subtle, Free-safe). Acuan CPU = Metrics cpuTimeMs,
BUKAN angka performance.now di dalam worker (di workerd self-timing native = ~0ms).

Langkah:
  1) node bench/scan-pbkdf2.mjs https://konter-pbkdf2-bench.<sub>.workers.dev
     -> menembakkan SEMBURAN per nilai iterasi (dari rendah, naik bertahap).
  2) Tunggu ±5 menit (latensi analitik), lalu:
     CF_ACCOUNT_ID=... CF_API_TOKEN=... node bench/scan-pbkdf2.mjs --report
     -> membaca cpuTimeMs asli per nilai dari GraphQL Analytics.
  3) Dashboard > Workers > konter-pbkdf2-bench > Metrics > CPU time per execution
     untuk mengonfirmasi cpuTimeMs nilai pilihan.
  4) Parameter final diimplementasi di HQ (bukan di sandbox worker ini).

Endpoint (satu derive per request):
  GET /bench?iter=N&fmt=json   -> {iter, deriveMs(INFO-only), note}
  GET /health                  -> ok
Guard: iter 100..20000 (ditolak di atas 20000).
`.trim();

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/' || path === '/help') return text(help());
    if (path === '/health') return text('ok');
    if (path === '/bench') {
      const fmtJson = url.searchParams.get('fmt') === 'json';
      const iter = Number(url.searchParams.get('iter'));
      if (!Number.isInteger(iter) || iter < 100 || iter > MAX_ITER) {
        const body = 'iter harus integer 100..100000';
        return fmtJson ? json({ error: body }, 400) : text(body, 400);
      }
      if (iter > HARD_CEIL) {
        const body = `DITOLAK: iter=${iter} > HARD_CEIL=${HARD_CEIL}`;
        return fmtJson ? json({ error: body }, 413) : text(body, 413);
      }
      try {
        await derive(Math.min(WARM_ITER, iter)); // warmup murah
        const { ms } = await derive(iter);       // SATU ukuran
        const note = 'INFO-only: performance.now di workerd ~0 utk native crypto; acuan = Metrics cpuTimeMs.';
        const row = { iter, deriveMs: Number(ms.toFixed(3)), perIterUs: Number(((ms * 1000) / iter).toFixed(3)), note };
        return fmtJson ? json(row) : text(`bench iter=${iter}\nderive_ms=${row.deriveMs} (INFO-only)\nper_iter_us=${row.perIterUs}\nnote=${note}\n`);
      } catch (e) {
        const body = `derive gagal: ${e.name}: ${e.message}`;
        return fmtJson ? json({ error: body }, 500) : text(body, 500);
      }
    }
    return text('path tidak dikenal; lihat /');
  },
};