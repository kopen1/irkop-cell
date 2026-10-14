// Salin katalog produk terbaru dari D1 produksi ke SQLite lokal.
// Produksi hanya dibaca (GET), tidak ada yang ditulis ke sana.
// Pakai: node tools/import_katalog.js <produk.json> <kategori.json>
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const [, , fProduk, fKategori] = process.argv;
const DB = new URL('../.dev-data/irkop.db', import.meta.url).pathname;
const now = new Date().toISOString();

const kategori = JSON.parse(readFileSync(fKategori, 'utf8')).items;
const produk = JSON.parse(readFileSync(fProduk, 'utf8')).items;

const db = new DatabaseSync(DB);

db.exec('PRAGMA foreign_keys = OFF');
const mulai = new Date().toISOString();

// 1. Hapus katalog lama (transaksi belum ada, jadi aman)
db.exec('DELETE FROM transaksi_item');
db.exec('DELETE FROM transaksi');
db.exec('DELETE FROM produk');
db.exec('DELETE FROM kategori_produk');
db.exec("DELETE FROM sqlite_sequence WHERE name IN ('produk','kategori_produk')");

// 2. Kategori
const insKat = db.prepare(
  'INSERT INTO kategori_produk (id, nama, lacak_stok, created_at) VALUES (?, ?, ?, ?)'
);
const idKatLama = new Map();
for (const k of kategori) {
  insKat.run(k.id, k.nama, k.lacak_stok ? 1 : 0, now);
  idKatLama.set(k.id, k.id);
}

// 3. Produk
const insProd = db.prepare(
  `INSERT INTO produk (id, kode, nama, kategori_id, harga, harga_modal, stok, stok_minimum, satuan, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
let n = 0;
for (const p of produk) {
  insProd.run(
    p.id,
    p.kode,
    p.nama,
    p.kategori_id != null && idKatLama.has(p.kategori_id) ? p.kategori_id : null,
    p.harga ?? 0,
    p.harga_modal ?? 0,
    p.stok ?? 0,
    p.stok_minimum ?? 0,
    p.satuan || 'pcs',
    p.created_at || mulai,
    p.updated_at || mulai
  );
  n += 1;
}

// 4. Sinkronkan sequence
const maks = db.prepare('SELECT COALESCE(MAX(id),0) m FROM produk').get().m;
db.prepare("UPDATE sqlite_sequence SET seq=? WHERE name='produk'").run(maks);
const maksK = db.prepare('SELECT COALESCE(MAX(id),0) m FROM kategori_produk').get().m;
db.prepare("UPDATE sqlite_sequence SET seq=? WHERE name='kategori_produk'").run(maksK);

db.exec('PRAGMA foreign_keys = ON');

// 5. Laporan
const c = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
const unit = db.prepare('SELECT COALESCE(SUM(stok),0) s FROM produk p JOIN kategori_produk k ON k.id=p.kategori_id WHERE k.lacak_stok=1').get().s;
console.log('kategori :', c('kategori_produk'), '| produk:', c('produk'), `(${n} diimpor)`);
console.log('unit stok (kategori lacak_stok=1):', Number(unit));

// Cek kode bentrok / produk tanpa kategori
const tanpaKat = db.prepare('SELECT COUNT(*) n FROM produk WHERE kategori_id IS NULL').get().n;
const tanpaModal = db.prepare(
  `SELECT COUNT(*) n FROM produk p JOIN kategori_produk k ON k.id=p.kategori_id
   WHERE k.lacak_stok=1 AND (p.harga_modal IS NULL OR p.harga_modal=0)`
).get().n;
console.log('produk tanpa kategori :', tanpaKat);
console.log('produk berstok modal 0:', tanpaModal);

console.log('\ntop 5 kategori:');
for (const r of db.prepare('SELECT k.nama, COUNT(*) n FROM produk p JOIN kategori_produk k ON k.id=p.kategori_id GROUP BY k.nama ORDER BY n DESC').all()) {
  console.log(`  ${r.nama.padEnd(14)} ${r.n}`);
}

db.close();
console.log(`\nselesai ${mulai}`);
