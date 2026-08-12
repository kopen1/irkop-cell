// Scanner PBKDF2 berbasis Metrics (Cloudflare Analytics GraphQL).
// Self-timing via performance.now di workerd = 0.00ms (klok isolat tidak berdetak
// selama native crypto) -> TIDAK dipakai. Sumber CPU yang valid = cpuTimeMs worker.
//
// MODE BURST (dari nilai rendah, naik bertahap; satu nilai per request):
//   node bench/scan-pbkdf2.mjs https://konter-pbkdf2-bench.<sub>.workers.dev
//   opsional: --iters=2000,5000,10000,15000  --gap=60000  --burst=10  --worker=konter-pbkdf2-bench
//   => menembakkan semburan per nilai dan mencatat log waktu ke bench/bursts.ndjson
//
// MODE REPORT (baca cpuTimeMs asli setelah menunggu latensi analitik ~5 menit):
//   CF_ACCOUNT_ID=<id> CF_API_TOKEN=<token> node bench/scan-pbkdf2.mjs --report
//   => tabel iter | cpuTimeP50 | per_iter_us | -> iterasi utk ~4ms + rekomendasi.
//
// Tidak menyentuh worker produksi `konter`/D1. Parameter final tetap ditentukan
// dari cpuTimeMs asli (bukan Node, bukan self-timing).

import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BURST_LOG = fileURLToPath(new URL('./bursts.ndjson', import.meta.url));
const GRAPHQL = process.env.GRAPHQL_URL || 'https://api.cloudflare.com/client/v4/graphql';

// ----- argumen --------------------------------------------------------------
const argv = process.argv.slice(2);
const report = argv.includes('--report');
const flag = (name, dflt) => {
  const i = argv.findIndex((a) => a.startsWith(`--${name}=`));
  return i === -1 ? dflt : argv[i].slice(name.length + 3);
};
const BASE = (argv.find((a) => a.startsWith('http')) || 'http://localhost:8787/').replace(/\/+$/, '');
const ITERS = (flag('iters') || '2000,5000,7500,10000,12000,15000,20000').split(',').map(Number);
const GAP_MS = Number(flag('gap', '60000'));
const BURST = Number(flag('burst', '10'));
const SAFE_MS = 4.0; // ambang: nilai terbesar dengan cpuTimeP50 <= 4ms -> margin aman < 10ms

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => new Date(d).toISOString();

// ----- mode: report ---------------------------------------------------------
async function reportMode() {
  const tag = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  if (!tag || !token) {
    console.error('Butuh CF_ACCOUNT_ID dan CF_API_TOKEN (token dgn permission "Workers Analytics" read).');
    process.exit(1);
  }
  if (!existsSync(BURST_LOG)) {
    console.error(`Tidak ada ${BURST_LOG}; jalankan mode burst dulu (node bench/scan-pbkdf2.mjs <URL>).`);
    process.exit(1);
  }
  const bursts = readFileSync(BURST_LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const from = new Date(Math.min(...bursts.map((b) => b.t0)) - 120000);
  const to = new Date();
  const dims = [...new Set(bursts.map((b) => b.worker))];

  const gql = async (query, variables) => {
    const resp = await fetch(GRAPHQL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const out = await resp.json();
    if (!resp.ok || out.errors) {
      console.error('GraphQL gagal:', JSON.stringify(out.errors || out, null, 2));
      console.error('Periksa: (1) CF_ACCOUNT_ID benar, (2) token permission "Workers Analytics" read, (3) schema GraphQL via GraphQL Explorer.');
      process.exit(1);
    }
    return out.data;
  };

  // Preflight: validasi account id + token (tanpa ini hasil bawah tak berarti).
  const acc = await gql(
    `query($tag:String!){viewer{accounts(filter:{accountTag:$tag}){accountTag}}}`,
    { tag }
  );
  const accTag = acc?.viewer?.accounts?.[0]?.accountTag;
  if (!accTag || accTag !== tag) {
    console.error(`Preflight gagal: CF_ACCOUNT_ID=${tag} tidak dikenal atau token tanpa akses (dibalas ${accTag || 'kosong'}).`);
    process.exit(1);
  }
  console.log(`Account terverifikasi: ${accTag}`);

  const rows = [];
  for (const worker of dims) {
    // workerName adalah DIMENSION, bukan arg filter pada schema saat ini.
    // Ambil semua baris lalu filter di sisi klien.
    const data = await gql(
      `query($tag:String!,$from:String!,$to:String!){
        viewer{accounts(filter:{accountTag:$tag}){
          workersInvocationsAdaptive(limit:500,filter:{datetime_geq:$from,datetime_lt:$to}){
            dimensions{datetime scriptName}
            sum{requests errors}
            quantiles{cpuTimeP50 cpuTimeP90}
          }
        }}}`,
      { tag, from: iso(from), to: iso(to) }
    );
    const nodes = data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];
    for (const n of nodes) {
      if (n.dimensions?.scriptName !== worker) continue; // filter nama worker di klien
      const t = new Date(n.dimensions?.datetime).getTime();
      const reqs = n.sum?.requests || 0;
      if (!reqs) continue;
      const p50 = n.quantiles?.cpuTimeP50;
      const p90 = n.quantiles?.cpuTimeP90;
      if (p50 == null || p90 == null) continue;
      const hit = bursts.filter((b) => b.worker === worker && t >= b.t0 - 30000 && t <= b.t1 + 30000);
      if (hit.length !== 1) continue; // baris menabrak >1 burst atau tak berburst: buang (biar bersih)
      const b = hit[0];
      rows.push({ iter: b.iter, p50: Number(p50), p90: Number(p90), at: iso(t) });
    }
  }

  if (!rows.length) {
    console.error('Tidak ada data cpuTime untuk jendela itu. Belum masuk (tunggu ~5 menit) atau nama worker/akun salah?');
    process.exit(1);
  }

  const byIter = new Map();
  for (const r of rows) {
    if (!byIter.has(r.iter)) byIter.set(r.iter, []);
    byIter.get(r.iter).push(r);
  }
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  console.log('cpuTimeMs asli per nilai (dari Metrics worker; unit cpuTimeP50 = microdetik):');
  console.log('iter      cpuP50(ms)  cpuP90(ms)  per_iter(us)');
  let chosen = null;
  for (const iter of [...byIter.keys()].sort((a, b) => a - b)) {
    const v = byIter.get(iter);
    const p50 = median(v.map((r) => r.p50)) / 1000; // us -> ms
    const p90 = median(v.map((r) => r.p90)) / 1000;
    const per = (p50 * 1000) / iter;
    console.log(`${String(iter).padStart(5)}  ${p50.toFixed(2).padStart(8)}  ${p90.toFixed(2).padStart(8)}  ${per.toFixed(3).padStart(8)}`);
    if (p50 <= SAFE_MS) chosen = { iter, p50, p90 };
  }
  console.log(`\nKandidat final: iterasi terbesar dgn cpuTimeP50 <= ${SAFE_MS}ms => ${chosen ? chosen.iter : '(tidak ada; turunkan daftar ke nilai lebih rendah)'}`);
  if (chosen) console.log(`  iter=${chosen.iter} cpuP50~${chosen.p50.toFixed(2)}ms cpunP90~${chosen.p90.toFixed(2)}ms (margin: ${(10 - chosen.p90).toFixed(1)}ms dari budget 10ms)`);
  console.log('\nKonfirmasi di Metrics -> CPU time per execution utk iter=' + (chosen?.iter ?? ITERS[0]) + ', lalu finalisasi di HQ.');
}

// ----- mode: burst ----------------------------------------------------------
async function burstMode() {
  const worker = flag('worker') || flag('name') || new URL(BASE).hostname.split('.')[0];
  console.log(`Base: ${BASE}`);
  console.log(`Nilai (naik dari rendah): ${ITERS.join(', ')} | burst=${BURST} req/nilai | jeda antar nilai=${GAP_MS/1000}s`);
  console.log('Tiap request hanya SATU derive -> CPU per request terkendali. Semburan dicatat ke bursts.ndjson.\n');
  for (const iter of ITERS) {
    const t0 = Date.now();
    let ok = 0, errs = 0;
    for (let i = 0; i < BURST; i++) {
      try {
        const r = await fetch(`${BASE}/bench?iter=${iter}&fmt=json`);
        if (r.ok) ok++; else errs++;
        if (!r.ok) console.log(`  iter=${iter} #${i + 1} HTTP ${r.status}`);
      } catch (e) {
        errs++;
        console.log(`  iter=${iter} #${i + 1} ERROR ${e.message}`);
        if (e.message.includes('1102')) {
          console.log('  -> Error 1102 (resource limit): HENTIKAN di sini. Batas aman < iter ini.');
          throw new Error('1102');
        }
      }
      await sleep(250);
    }
    const t1 = Date.now();
    appendFileSync(BURST_LOG, JSON.stringify({ iter, t0, t1, worker, ok, errs }) + '\n');
    console.log(`iter=${String(iter).padStart(5)}  ok=${ok}/${BURST} err=${errs}  (${iso(t0)})`);
    await sleep(GAP_MS);
  }
  console.log('\nSelesai. Tunggu ~5 menit (latensi analitik), lalu:');
  console.log('  CF_ACCOUNT_ID=<id> CF_API_TOKEN=<token> node bench/scan-pbkdf2.mjs --report');
}

if (report) await reportMode();
else await burstMode();