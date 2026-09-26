// =====================================================================
// Price Check Worker — Auto-fetch harga dari OrderKuota
// Dijalankan via Cron Trigger (Senin jam 8 pagi UTC / 15:00 WIB)
// =====================================================================

const BASE_URL = 'https://www.orderkuota.com/harga/cetak-voucher';
// Halaman harga pulsa (server-rendered, berbeda endpoint dari cetak-voucher).
const PULSA_BASE_URL = 'https://www.orderkuota.com/harga/pulsa';
// Batas nominal pulsa yang diambil: 100.000 ke bawah.
const PULSA_MAX_NOMINAL = 100000;
const EXCLUDE_KW = ['jabo', 'jabodetabek', 'jatim', 'jabar', 'jakarta', 'sukabumi', 'sumatera', 'kalimantan', 'sulawesi'];

const PAGES = [
  { op: 'indosat', slug: 'isat-cetak-vcr-freedom-mini-java' },
  { op: 'indosat', slug: 'isat-cetak-freedom-internet-java' },
  { op: 'tri', slug: 'tri-cetak-vcr-happy-java' },
  { op: 'tri', slug: 'tri-cetak-vcr-mini-happy-java' },
  { op: 'telkomsel', slug: 'tsel-cetak-voucher-jateng' },
  { op: 'xl', slug: 'xl-cetak-voucher-flex' },
  { op: 'xl', slug: 'xl-cetak-voucher-flex-mini' },
];

// Pulsa: kolom kode OrderKuota (I5, A10, T15, SM20, ...) = kode produk lokal.
const PULSA_PAGES = [
  { op: 'indosat', slug: 'indosat' },
  { op: 'axis', slug: 'axis' },
  { op: 'xl', slug: 'xl' },
  { op: 'three', slug: 'three' },
  { op: 'smartfren', slug: 'smartfren' },
  { op: 'telkomsel', slug: 'telkomsel' },
];

function genKode(op, produk, hari) {
  const gbMatch = produk.match(/(\d+(?:\.\d+)?)\s*[Gg][Bb]/);
  const gb = gbMatch ? Math.floor(parseFloat(gbMatch[1])) : 0;
  const isUnli = /unli|unlimited/i.test(produk);
  if (isUnli) return `V${op}u${gb}`;
  if (hari === 1) return `V${op}0${String(gb).padStart(2,'0')}01`;
  if (hari === 28 || hari === 30) return `V${op}${gb}`;
  return `V${op}${String(gb).padStart(2,'0')}${String(hari).padStart(2,'0')}`;
}

function parseHari(p) {
  const m = p.match(/(\d+)\s*hari/i);
  if (m) return parseInt(m[1]);
  if (/harian/i.test(p)) return 1;
  return 999;
}

function isJateng(p) {
  const lower = p.toLowerCase();
  return !EXCLUDE_KW.some(kw => lower.includes(kw));
}

async function fetchHarga(slug) {
  const url = `${BASE_URL}/${slug}`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 Linux Android 13 Chrome/120' }
    });
    const html = await resp.text();
    const products = [];
    const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
    if (!tbodyMatch) return [];
    const rows = tbodyMatch[1].match(/<tr>([\s\S]*?)<\/tr>/g) || [];
    for (const row of rows) {
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
      if (cells.length >= 3) {
        const kode = cells[0].replace(/<[^>]+>/g, '').trim();
        const produk = cells[1].replace(/<[^>]+>/g, '').trim();
        const hargaStr = cells[2].replace(/<[^>]+>/g, '').trim();
        const harga = parseInt(hargaStr.replace(/[^0-9]/g, ''));
        const hari = parseHari(produk);
        if (kode && harga && harga < 100000 && isJateng(produk) && hari < 999) {
          products.push({ produk, harga, hari });
        }
      }
    }
    return products;
  } catch (e) {
    return [];
  }
}

// --- Pulsa -----------------------------------------------------------------
// Nama produk memuat nominal, mis. "Indosat 25.000" -> 25000. Kalau nominal
// tidak terbaca, fall back ke harga agar tetap bisa disaring <= 100k.
function parseNominal(produk) {
  const cleaned = String(produk || '').replace(/\./g, '');
  const m = cleaned.match(/(\d{3,7})\s*$/);
  if (m) return parseInt(m[1], 10);
  const first = cleaned.match(/(\d{3,7})/);
  return first ? parseInt(first[1], 10) : null;
}

// Baris tabel: [kode, nama, harga_beli, harga_jual]. Harga yang dipakai untuk
// modal adalah kolom "harga beli" (kolom 3).
function parsePulsaRows(html) {
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) return [];
  const rows = tbodyMatch[1].match(/<tr>([\s\S]*?)<\/tr>/g) || [];
  const out = [];
  for (const row of rows) {
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
    if (cells.length < 3) continue;
    const kode = cells[0].replace(/<[^>]+>/g, '').trim().toUpperCase();
    const produk = cells[1].replace(/<[^>]+>/g, '').trim();
    const harga = parseInt(cells[2].replace(/[^0-9]/g, ''), 10);
    if (!kode || !produk || !harga) continue;
    const nominal = parseNominal(produk);
    if ((nominal != null ? nominal : harga) > PULSA_MAX_NOMINAL) continue;
    out.push({ kode, produk, harga, nominal });
  }
  return out;
}

async function fetchHargaPulsa(slug) {
  try {
    const resp = await fetch(`${PULSA_BASE_URL}/${slug}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 Linux Android 13 Chrome/120' }
    });
    if (!resp.ok) return [];
    return parsePulsaRows(await resp.text());
  } catch {
    return [];
  }
}

// Tulis hasil fetch pulsa ke harga_server (kategori 'pulsa'), sama seperti
// voucher: insert bila baru, log + alert bila harga berubah.
async function syncPulsa(db, now) {
  let total = 0, updated = 0, alerts = 0, fetched = 0;
  for (const page of PULSA_PAGES) {
    const products = await fetchHargaPulsa(page.slug);
    fetched += products.length;
    for (const p of products) {
      const kode = p.kode;
      const existing = await db.prepare('SELECT * FROM harga_server WHERE kode_produk = ?').bind(kode).first();
      if (existing) {
        if (existing.harga_server !== p.harga) {
          await db.prepare('UPDATE harga_server SET harga_sebelumnya = harga_server, harga_server = ?, updated_at = ? WHERE kode_produk = ?')
            .bind(p.harga, now, kode).run();
          await db.prepare('INSERT INTO harga_server_log (kode_produk, nama_produk, harga_lama, harga_baru, selisih, tipe, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(kode, p.produk, existing.harga_server, p.harga, p.harga - existing.harga_server, 'update', now).run();
          if (p.harga > existing.harga_server) {
            await db.prepare('INSERT INTO harga_alert (kode_produk, nama_produk, harga_lama, harga_baru, selisih) VALUES (?, ?, ?, ?, ?)')
              .bind(kode, p.produk, existing.harga_server, p.harga, p.harga - existing.harga_server).run();
            alerts++;
          }
          updated++;
        }
      } else {
        await db.prepare('INSERT INTO harga_server (kode_produk, sumber, kategori, operator, nama_produk, harga_server, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(kode, 'orderkuota', 'pulsa', page.op, p.produk, p.harga, now).run();
        total++;
      }
    }
  }
  return { total, updated, alerts, fetched };
}

export default {
  async scheduled(event, env, ctx) {
    const db = env.DB;
    const now = new Date().toISOString();
    let total = 0, updated = 0, alerts = 0, voucherFetched = 0;

    for (const page of PAGES) {
      const products = await fetchHarga(page.slug);
      voucherFetched += products.length;
      for (const p of products) {
        const kode = genKode(page.op, p.produk, p.hari);
        const existing = await db.prepare('SELECT * FROM harga_server WHERE kode_produk = ?').bind(kode).first();
        if (existing) {
          if (existing.harga_server !== p.harga) {
            await db.prepare('UPDATE harga_server SET harga_sebelumnya = harga_server, harga_server = ?, updated_at = ? WHERE kode_produk = ?')
              .bind(p.harga, now, kode).run();
            await db.prepare('INSERT INTO harga_server_log (kode_produk, nama_produk, harga_lama, harga_baru, selisih, tipe, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .bind(kode, p.produk, existing.harga_server, p.harga, p.harga - existing.harga_server, 'update', now).run();
            if (p.harga > existing.harga_server) {
              await db.prepare('INSERT INTO harga_alert (kode_produk, nama_produk, harga_lama, harga_baru, selisih) VALUES (?, ?, ?, ?, ?)')
                .bind(kode, p.produk, existing.harga_server, p.harga, p.harga - existing.harga_server).run();
              alerts++;
            }
            updated++;
          }
        } else {
          await db.prepare('INSERT INTO harga_server (kode_produk, sumber, kategori, operator, nama_produk, harga_server, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(kode, 'orderkuota', 'cetak_voucher', page.op, p.produk, p.harga, now).run();
          total++;
        }
      }
    }

    const pulsa = await syncPulsa(db, now);
    total += pulsa.total;
    updated += pulsa.updated;
    alerts += pulsa.alerts;

    console.log(`[PriceCheck] ${total} baru, ${updated} update, ${alerts} alerts (terbaca: voucher ${voucherFetched}, pulsa ${pulsa.fetched})`);
  },

  async fetch(env) {
    // Manual trigger via POST /api/price-check
    const db = env.DB;
    const now = new Date().toISOString();
    let total = 0, updated = 0, alerts = 0, voucherFetched = 0;

    for (const page of PAGES) {
      const products = await fetchHarga(page.slug);
      voucherFetched += products.length;
      for (const p of products) {
        const kode = genKode(page.op, p.produk, p.hari);
        const existing = await db.prepare('SELECT * FROM harga_server WHERE kode_produk = ?').bind(kode).first();
        if (existing) {
          if (existing.harga_server !== p.harga) {
            await db.prepare('UPDATE harga_server SET harga_sebelumnya = harga_server, harga_server = ?, updated_at = ? WHERE kode_produk = ?')
              .bind(p.harga, now, kode).run();
            await db.prepare('INSERT INTO harga_server_log (kode_produk, nama_produk, harga_lama, harga_baru, selisih, tipe, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .bind(kode, p.produk, existing.harga_server, p.harga, p.harga - existing.harga_server, 'update', now).run();
            if (p.harga > existing.harga_server) {
              await db.prepare('INSERT INTO harga_alert (kode_produk, nama_produk, harga_lama, harga_baru, selisih) VALUES (?, ?, ?, ?, ?)')
                .bind(kode, p.produk, existing.harga_server, p.harga, p.harga - existing.harga_server).run();
              alerts++;
            }
            updated++;
          }
        } else {
          await db.prepare('INSERT INTO harga_server (kode_produk, sumber, kategori, operator, nama_produk, harga_server, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(kode, 'orderkuota', 'cetak_voucher', page.op, p.produk, p.harga, now).run();
          total++;
        }
      }
    }

    const pulsa = await syncPulsa(db, now);
    return {
      total: total + pulsa.total,
      updated: updated + pulsa.updated,
      alerts: alerts + pulsa.alerts,
      fetched: voucherFetched + pulsa.fetched,
      voucher: { fetched: voucherFetched },
      pulsa,
    };
  }
};
