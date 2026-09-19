// Seed contoh data LOKAL untuk tabel harga_server, supaya halaman Harga Server
// (perbandingan vs modal Daftar Barang) bisa diuji tanpa cron OrderKuota.
//
//   node seed-harga-server.js
//
// Menghasilkan variasi status: naik / turun / sama + beberapa kode "baru".
// Idempotent (upsert per kode_produk).
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '.dev-data', 'irkop.db'));
const now = new Date().toISOString();

function upsert(kode, nama, sumber, kategori, harga, adminFee = 0) {
  const ex = db.prepare('SELECT id, harga_server FROM harga_server WHERE kode_produk = ?').get(kode);
  if (ex) {
    db.prepare('UPDATE harga_server SET harga_sebelumnya = harga_server, harga_server = ?, nama_produk = ?, updated_at = ? WHERE id = ?')
      .run(harga, nama, now, ex.id);
    if (ex.harga_server !== harga) {
      const selisih = harga - ex.harga_server;
      db.prepare('INSERT INTO harga_server_log (kode_produk, nama_produk, harga_lama, harga_baru, selisih, tipe, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(kode, nama, ex.harga_server, harga, selisih, 'update', now);
      if (selisih > 0) {
        db.prepare('INSERT INTO harga_alert (kode_produk, nama_produk, harga_lama, harga_baru, selisih, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(kode, nama, ex.harga_server, harga, selisih, now);
      }
    }
    return 'update';
  }
  db.prepare('INSERT INTO harga_server (kode_produk, sumber, kategori, operator, nama_produk, harga_server, admin_fee, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(kode, sumber, kategori, null, nama, harga, adminFee, now);
  db.prepare('INSERT INTO harga_server_log (kode_produk, nama_produk, harga_lama, harga_baru, selisih, tipe, fetched_at) VALUES (?, ?, NULL, ?, ?, ?, ?)')
    .run(kode, nama, harga, harga, 'create', now);
  return 'insert';
}

const prods = db.prepare(`
  SELECT p.kode, p.nama, p.harga_modal, p.harga
    FROM produk p LEFT JOIN kategori_produk k ON k.id = p.kategori_id
   WHERE p.deleted_at IS NULL AND k.nama = 'Voucher'
   ORDER BY p.id`).all();

let naik = 0;
let turun = 0;
let sama = 0;
prods.forEach((p, i) => {
  const modal = p.harga_modal || 0;
  const m = i % 3;
  let hs = modal;
  if (m === 0) { hs = modal + 500; naik += 1; }
  else if (m === 1) { hs = modal - 300; turun += 1; }
  else { sama += 1; }
  upsert(p.kode, p.nama, 'orderkuota', 'cetak_voucher', hs, 0);
});

// Beberapa kode "baru" (tidak ada di Daftar Barang) → status 'baru'.
upsert('Vi999', 'Indosat Contoh Baru 3GB', 'orderkuota', 'cetak_voucher', 7000, 0);
upsert('Vx99', 'XL Contoh Baru 7GB', 'orderkuota', 'cetak_voucher', 9000, 0);

console.log(`[seed-harga-server] selesai. produk voucher=${prods.length} (naik=${naik}, turun=${turun}, sama=${sama}) + 2 kode baru.`);
