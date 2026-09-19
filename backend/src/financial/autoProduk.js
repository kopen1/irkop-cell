// Engine "Buat Produk Otomatis" dari transaksi.
// Memindai transaksi Produk Digital (DANA/GoPay/Ovo) dan Transfer (Bank) N hari
// terakhir. Kalau (provider + nominal) muncul >= MIN_COUNT kali dan belum ada
// produknya, otomatis dibuatkan produk (kategori Saldo) dengan harga = nominal + admin.
import { nowIso } from '../lib/time.js';

export const SCAN_DAYS = 7;
export const SCAN_MIN_COUNT = 10;

const PREFIX = { Dana: 'D', Bank: 'B', Ovo: 'O', Gopay: 'G' };

function providerDariNama(nama) {
  const n = String(nama || '').toLowerCase();
  if (n.includes('gopay') || n.includes('go pay')) return 'Gopay';
  if (n.includes('ovo')) return 'Ovo';
  if (n.includes('dana')) return 'Dana';
  return '';
}

// Admin (fee) per provider & nominal sesuai aturan bisnis. Minimal nominal 10k.
export function adminFee(provider, nominal) {
  const n = Number(nominal);
  if (!Number.isFinite(n) || n < 10000) return 0;
  if (n >= 2000000) return 10000 + 5000 * Math.floor((n - 2000000) / 1000000);
  if (n >= 950000) return 10000;
  if (n >= 95000) return 5000;
  if (provider === 'Dana') return n <= 30000 ? 2000 : 3000;
  if (provider === 'Bank') return 5000; // 10k–940k
  return 3000; // Gopay / Ovo (<= 94k)
}

function kodeProduk(provider, nominal) {
  const prefix = PREFIX[provider] || '';
  return `${prefix}${Math.round(nominal / 1000)}`;
}

function namaProduk(provider, nominal) {
  if (nominal >= 1000000) {
    const jt = nominal / 1000000;
    return `${provider} ${jt}jt`;
  }
  return `${provider} ${nominal / 1000}k`;
}

function wibDateOffset(days) {
  const t = new Date(Date.now() + 7 * 3600 * 1000 - days * 86400 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export async function autoCreateProdukFromTransaksi(db, { days = SCAN_DAYS, minCount = SCAN_MIN_COUNT } = {}) {
  const start = wibDateOffset(days);

  // Kumpulkan kandidat: provider + nominal (per transaksi unik).
  const bucket = new Map(); // key -> Set(txId)
  const add = (provider, nominal, txId) => {
    if (!provider || !Number.isFinite(nominal) || nominal < 10000) return;
    const key = `${provider}:${nominal}`;
    if (!bucket.has(key)) bucket.set(key, { provider, nominal, txIds: new Set() });
    bucket.get(key).txIds.add(txId);
  };

  const digital = await db.many(
    `SELECT t.id AS tx_id, ti.nama_produk_snapshot, ti.harga_modal_snapshot, ti.qty
       FROM transaksi t JOIN transaksi_item ti ON ti.transaksi_id = t.id
      WHERE t.deleted_at IS NULL AND t.jenis = 'produkdigital' AND t.tanggal_transaksi >= ?`,
    start
  );
  for (const r of digital) {
    const provider = providerDariNama(r.nama_produk_snapshot);
    const nominal = Number(r.harga_modal_snapshot || 0) * Number(r.qty || 1);
    add(provider, nominal, r.tx_id);
  }

  const transfer = await db.many(
    `SELECT id AS tx_id, total, COALESCE(laba, 0) AS laba
       FROM transaksi
      WHERE deleted_at IS NULL AND jenis = 'transfer' AND tanggal_transaksi >= ?`,
    start
  );
  for (const r of transfer) {
    add('Bank', Number(r.total || 0) - Number(r.laba || 0), r.tx_id);
  }

  // Kategori Saldo.
  const kat = await db.one("SELECT id FROM kategori_produk WHERE nama = 'Saldo' AND deleted_at IS NULL");
  const created = [];
  const skipped = [];
  for (const { provider, nominal, txIds } of bucket.values()) {
    if (txIds.size < minCount) continue;
    const kode = kodeProduk(provider, nominal);
    const existing = await db.one('SELECT id FROM produk WHERE lower(kode) = lower(?)', kode);
    if (existing) { skipped.push(kode); continue; }
    const fee = adminFee(provider, nominal);
    const res = await db.exec(
      `INSERT INTO produk (kode, nama, kategori_id, harga, harga_modal, stok, stok_minimum, satuan, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, 'pcs', ?)`,
      kode, namaProduk(provider, nominal), kat ? kat.id : null, nominal + fee, nominal, nowIso()
    );
    created.push({ id: res.lastRowId, kode, nama: namaProduk(provider, nominal), nominal, admin: fee, jumlah_trx: txIds.size });
  }

  return { dibuat: created.length, dilewati: skipped.length, created, skipped, sejak: start, min_count: minCount };
}
