// =====================================================================
// Seed data contoh untuk pengembangan LOKAL.
// Dipakai oleh dev-server.js: mengisi kategori + produk bila masih kosong.
// =====================================================================
import { nowIso } from './src/lib/time.js';

// [nama, lacak_stok]
const KATEGORI = [
  ['Voucher', 0],
  ['Pulsa', 0],
  ['Saldo', 0],
  ['Token', 0],
  ['Service HP', 0],
  ['Aksesoris', 1],
];

// [kode, nama, kategori, harga_modal, harga, stok]
const PRODUK = [
  // Voucher (Jateng)
  ['Vi03', 'Indosat Freedom Mini 3GB 1Hari', 'Voucher', 6900, 8900, 0],
  ['Vi07', 'Indosat Freedom Mini 7GB 1Hari', 'Voucher', 7681, 9700, 0],
  ['Vi1005', 'Indosat Freedom Mini 10GB 5Hari', 'Voucher', 16848, 18900, 0],
  ['Vi107', 'Indosat Freedom Mini 5GB 7Hari', 'Voucher', 19840, 21900, 0],
  ['Vi7', 'Indosat Freedom Internet 7GB 28Hari', 'Voucher', 32308, 34300, 0],
  ['Vi15', 'Indosat Freedom Internet 15GB 28Hari', 'Voucher', 44075, 46100, 0],
  ['Vt06', 'Tri Happy 6GB+2GB 1Hari', 'Voucher', 6500, 8500, 0],
  ['Vt7', 'Tri Happy Java 7GB 28Hari', 'Voucher', 31510, 33500, 0],
  ['Vs04', 'Tsel Jateng 4GB+3GB 1Hari', 'Voucher', 8750, 10700, 0],
  ['Vs6', 'Tsel Jateng 6GB+12GB 28Hari', 'Voucher', 51810, 53800, 0],
  ['Vx05', 'XL Flex Mini 5GB 1Hari', 'Voucher', 6870, 8900, 0],
  ['Vx7', 'XL Flex 7GB 28Hari', 'Voucher', 33000, 35000, 0],
  ['Vsm7', 'Smartfren Nonstop 7GB 28Hari', 'Voucher', 32620, 34600, 0],
  ['Va7', 'Axis Aigo 7GB 28Hari', 'Voucher', 33220, 35200, 0],

  // Pulsa
  ['pi10', 'Pulsa Indosat 10k', 'Pulsa', 9750, 12000, 0],
  ['pi25', 'Pulsa Indosat 25k', 'Pulsa', 24800, 27000, 0],
  ['pi50', 'Pulsa Indosat 50k', 'Pulsa', 49500, 52000, 0],
  ['pi100', 'Pulsa Indosat 100k', 'Pulsa', 97500, 100000, 0],
  ['pt10', 'Pulsa Tri 10k', 'Pulsa', 9800, 12000, 0],
  ['pt50', 'Pulsa Tri 50k', 'Pulsa', 49200, 52000, 0],
  ['px10', 'Pulsa XL 10k', 'Pulsa', 9700, 12000, 0],
  ['px50', 'Pulsa XL 50k', 'Pulsa', 49300, 52000, 0],
  ['pts10', 'Pulsa Telkomsel 10k', 'Pulsa', 10000, 12000, 0],
  ['pts50', 'Pulsa Telkomsel 50k', 'Pulsa', 49000, 52000, 0],
  ['ps10', 'Pulsa Smartfren 10k', 'Pulsa', 9950, 12000, 0],
  ['pa10', 'Pulsa Axis 10k', 'Pulsa', 9900, 12000, 0],

  // Saldo (DANA/GoPay/OVO)
  ['D10', 'Dana 10k', 'Saldo', 12000, 14000, 0],
  ['D25', 'Dana 25k', 'Saldo', 27000, 29000, 0],
  ['D50', 'Dana 50k', 'Saldo', 53000, 55000, 0],
  ['D100', 'Dana 100k', 'Saldo', 105000, 107000, 0],
  ['GP10', 'GoPay 10k', 'Saldo', 13000, 15000, 0],
  ['GP50', 'GoPay 50k', 'Saldo', 53000, 55000, 0],
  ['GP100', 'GoPay 100k', 'Saldo', 105000, 107000, 0],
  ['OV10', 'OVO 10k', 'Saldo', 13000, 15000, 0],
  ['OV50', 'OVO 50k', 'Saldo', 53000, 55000, 0],
  ['OV100', 'OVO 100k', 'Saldo', 105000, 107000, 0],

  // Token Listrik
  ['T20', 'Token PLN 20k', 'Token', 22000, 24000, 0],
  ['T50', 'Token PLN 50k', 'Token', 53000, 55000, 0],
  ['T100', 'Token PLN 100k', 'Token', 105000, 107000, 0],
  ['T200', 'Token PLN 200k', 'Token', 205000, 207000, 0],

  // Service HP (jasa)
  ['SV-LCD', 'Jasa Ganti LCD', 'Service HP', 150000, 200000, 0],
  ['SV-BAT', 'Jasa Ganti Baterai', 'Service HP', 80000, 120000, 0],

  // Aksesoris (lacak stok)
  ['AC-001', 'Charger USB 2A', 'Aksesoris', 15000, 25000, 20],
  ['AC-002', 'Kabel Data Type-C', 'Aksesoris', 10000, 20000, 30],
  ['AC-003', 'Headset Basic', 'Aksesoris', 20000, 35000, 15],
  ['AC-004', 'Anti Gores', 'Aksesoris', 5000, 15000, 50],
  ['AC-005', 'Powerbank 10000mAh', 'Aksesoris', 120000, 160000, 8],

  // Lainnya
  ['Dana', 'Dana', 'Saldo', 0, 1, 0],
  ['TT', 'Tarik Tunai', 'Service HP', 1, 1, 0],
];

export function seedIfEmpty(sqliteDb, log = () => {}) {
  const count = sqliteDb.prepare('SELECT COUNT(*) AS c FROM produk').get().c;
  if (count > 0) return { seeded: false, produk: count };

  const now = nowIso();
  const katId = {};
  const insKat = sqliteDb.prepare('INSERT INTO kategori_produk (nama, lacak_stok, created_at) VALUES (?, ?, ?)');
  for (const [nama, lacak] of KATEGORI) {
    const existing = sqliteDb.prepare('SELECT id FROM kategori_produk WHERE nama = ?').get(nama);
    if (existing) {
      katId[nama] = existing.id;
    } else {
      const r = insKat.run(nama, lacak, now);
      katId[nama] = Number(r.lastInsertRowid);
    }
  }

  const insProduk = sqliteDb.prepare(
    'INSERT INTO produk (kode, nama, kategori_id, harga, harga_modal, stok, stok_minimum, satuan, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)'
  );
  let n = 0;
  for (const [kode, nama, kategori, modal, harga, stok] of PRODUK) {
    const dup = sqliteDb.prepare('SELECT id FROM produk WHERE kode = ?').get(kode);
    if (dup) continue;
    insProduk.run(kode, nama, katId[kategori] || null, harga, modal, stok, 'pcs', now);
    n++;
  }
  log(`[seed] ${n} produk + ${KATEGORI.length} kategori dimasukkan`);
  return { seeded: true, produk: n };
}
