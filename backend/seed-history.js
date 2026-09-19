// Seed data LOKAL untuk riwayat 1 bulan (default 30 hari) ke belakang.
// Variasi: penjualan fisik, produk digital, jasa service HP, pengeluaran,
// beli stok (OrderKuota/SeaBank), transfer/setor, kasbon + pelunasan, gaji
// karyawan. Semua baris seed ditandai "[seed]" / kode "-S" agar bisa dibersihkan
// dan dijalankan ulang.
//
//   node seed-history.js            # 30 hari
//   node seed-history.js 7          # 7 hari
//
// HANYA untuk DB dev (.dev-data/irkop.db). Hari yang sesinya sudah ada
// (data asli) dilewati.
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '.dev-data', 'irkop.db'));
db.exec('PRAGMA foreign_keys = ON');

const DAYS = Number(process.argv[2] || 30);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

function wibDate(offsetDays) {
  const t = Date.now() + 7 * 3600 * 1000 - offsetDays * 86400 * 1000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function isoAt(tanggal, hh, mm) {
  return `${tanggal}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`;
}
function wibWeekday(tanggal) {
  return ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'][new Date(`${tanggal}T00:00:00Z`).getUTCDay()];
}
const isWeekend = (t) => ['sabtu', 'minggu'].includes(wibWeekday(t));

// ---------------- Prasyarat ----------------
const admin = get("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
if (!admin) {
  console.error('[seed-history] Admin belum ada. Jalankan dev-server dulu.');
  process.exit(1);
}
const nowTs = new Date().toISOString();

if (!get("SELECT id FROM akun_master WHERE nama_akun = 'Simpanan'")) {
  run("INSERT INTO akun_master (nama_akun, tipe, aktif, created_at) VALUES ('Simpanan', 'tunai', 1, ?)", nowTs);
}
run("UPDATE kategori_produk SET lacak_stok = 1 WHERE nama = 'Voucher'");

// Karyawan + rate gaji
let karyawan = get("SELECT id FROM users WHERE role = 'karyawan' ORDER BY id LIMIT 1");
if (!karyawan) {
  run(
    "INSERT INTO users (nama, username, password_hash, role, aktif, created_at) VALUES ('Kasir Seed', 'kasir_seed', 'x', 'karyawan', 1, ?)",
    nowTs
  );
  karyawan = { id: Number(get("SELECT last_insert_rowid() AS id").id) };
}
if (!get('SELECT id FROM karyawan_rate WHERE user_id = ?', karyawan.id)) {
  run("INSERT INTO karyawan_rate (user_id, tipe, rate_flat, created_at) VALUES (?, 'flat', 60000, ?)", karyawan.id, nowTs);
}

// Pelanggan default
let umum = get("SELECT id FROM pelanggan WHERE nama = 'Umum'");
if (!umum) {
  run("INSERT INTO pelanggan (nama, created_at) VALUES ('Umum', ?)", nowTs);
  umum = { id: Number(get("SELECT last_insert_rowid() AS id").id) };
}
let budi = get("SELECT id FROM pelanggan WHERE nama = 'Budi'");
if (!budi) {
  run("INSERT INTO pelanggan (nama, created_at) VALUES ('Budi', ?)", nowTs);
  budi = { id: Number(get("SELECT last_insert_rowid() AS id").id) };
}

// ---------------- Bersihkan seed lama ----------------
function cleanupSeed() {
  const seedSesi = all(
    `SELECT DISTINCT ks.id FROM kasir_sesi ks
      WHERE EXISTS (SELECT 1 FROM transaksi t WHERE t.kasir_sesi_id = ks.id AND t.kode_transaksi LIKE '%-S%')
         OR EXISTS (SELECT 1 FROM pengeluaran p WHERE p.tanggal = ks.tanggal AND (p.deskripsi LIKE '[seed]%' OR p.deskripsi IN ('Listrik & kebersihan')))
         OR EXISTS (SELECT 1 FROM transfer_saldo ts WHERE ts.tanggal = ks.tanggal AND (ts.catatan LIKE '[seed]%' OR ts.catatan = 'setor ke bank'))`
  ).map((r) => r.id);
  // Kasbon seed dihapus lebih dulu (FK kasbon.transaksi_id -> transaksi).
  run("DELETE FROM kasbon_pembayaran WHERE kasbon_id IN (SELECT id FROM kasbon WHERE catatan LIKE '[seed]%')");
  run("DELETE FROM kasbon WHERE catatan LIKE '[seed]%'");
  for (const id of seedSesi) {
    run('DELETE FROM mutasi_saldo WHERE kasir_sesi_id = ?', id);
    run('DELETE FROM transaksi_item WHERE transaksi_id IN (SELECT id FROM transaksi WHERE kasir_sesi_id = ?)', id);
    run('DELETE FROM transaksi WHERE kasir_sesi_id = ?', id);
    run('DELETE FROM kasir_saldo WHERE kasir_sesi_id = ?', id);
    run('DELETE FROM kasir_sesi WHERE id = ?', id);
  }
  run("DELETE FROM pengeluaran WHERE deskripsi LIKE '[seed]%' OR deskripsi = 'Listrik & kebersihan'");
  run("DELETE FROM transfer_saldo WHERE catatan LIKE '[seed]%' OR catatan = 'setor ke bank'");
  run("DELETE FROM pembelian_stok_item WHERE pembelian_id IN (SELECT id FROM pembelian_stok WHERE catatan LIKE '[seed]%')");
  run("DELETE FROM pembelian_stok WHERE catatan LIKE '[seed]%'");
  run("DELETE FROM service_hp WHERE catatan = '[seed]'");
  run("DELETE FROM kasbon_pembayaran WHERE kasbon_id IN (SELECT id FROM kasbon WHERE catatan LIKE '[seed]%')");
  run("DELETE FROM kasbon WHERE catatan LIKE '[seed]%'");
  run("DELETE FROM gaji_harian WHERE catatan LIKE '[seed]%'");
  if (seedSesi.length) console.log(`[seed-history] bersihkan ${seedSesi.length} sesi seed lama`);
}
cleanupSeed();

// ---------------- Produk & saldo ----------------
const P = (kode) => get('SELECT id, kode, nama, harga, harga_modal FROM produk WHERE kode = ? AND deleted_at IS NULL', kode);
const produkDigital = ['D10', 'D50', 'D100', 'GP50', 'pi10', 'pi25', 'pi50'].map(P).filter(Boolean);
const produkFisik = ['AC-001', 'AC-002', 'AC-003', 'AC-004', 'AC-005'].map(P).filter(Boolean);
const produkVoucher = ['Vi07', 'Vi15', 'Vsm7', 'Vs6', 'T50'].map(P).filter(Boolean);

const balances = {};
for (const a of all('SELECT nama_akun FROM akun_master WHERE aktif = 1')) balances[a.nama_akun] = 0;
Object.assign(balances, { 'Tunai Laci': 500000, SeaBank: 9000000, DANA: 8000000, OrderKuota: 1500000, Simpanan: 1500000 });

let seq = 0;
const kodeTx = (tanggal) => `TX-${tanggal.replace(/-/g, '')}-S${String((seq += 1)).padStart(3, '0')}`;

function addMutation(sesiId, akun, jumlah, sumberTipe, sumberId, key, kategori, createdAt) {
  if (!akun || !jumlah) return;
  run(
    `INSERT OR IGNORE INTO mutasi_saldo
       (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, kategori, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    sesiId, akun, jumlah, sumberTipe, sumberId, key, kategori || null, createdAt
  );
  balances[akun] = (balances[akun] || 0) + jumlah;
}
const addStok = (produkId, delta, ts) => produkId && run('UPDATE produk SET stok = stok + ?, updated_at = ? WHERE id = ?', delta, ts, produkId);

function insertTransaksi(sesiId, tanggal, createdAt, { jenis = null, metode, total, laba, pelangganId = null }) {
  const kode = kodeTx(tanggal);
  const r = run(
    `INSERT INTO transaksi (kode_transaksi, pelanggan_id, metode_bayar, konfirmasi_pembayaran, subtotal, diskon, total, laba,
       kasir_sesi_id, dibuat_oleh, manual_entry, jenis, tanggal_transaksi, created_at, sisa, status_bayar)
     VALUES (?, ?, ?, 'tidak_perlu', ?, 0, ?, ?, ?, ?, 0, ?, ?, ?, 0, 'lunas')`,
    kode, pelangganId, metode, total, total, laba, sesiId, admin.id, jenis, tanggal, createdAt
  );
  const txId = Number(r.lastInsertRowid);
  return { txId, kode };
}

function itemFisik(txId, p, qty, ts) {
  run(
    `INSERT INTO transaksi_item (transaksi_id, produk_id, nama_produk_snapshot, harga_snapshot, harga_modal_snapshot, qty, subtotal)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    txId, p.id, p.nama, p.harga, p.harga_modal, qty, p.harga * qty
  );
  addStok(p.id, -qty, ts);
}

// ---------------- Jenis transaksi ----------------
function jualFisik(sesiId, tanggal, createdAt, p, qty, metode = 'tunai') {
  const total = p.harga * qty;
  const laba = (p.harga - (p.harga_modal || 0)) * qty;
  const { txId, kode } = insertTransaksi(sesiId, tanggal, createdAt, { metode, total, laba });
  itemFisik(txId, p, qty, createdAt);
  if (metode === 'tunai') addMutation(sesiId, 'Tunai Laci', total, 'transaksi', txId, `seed:${kode}:Tunai Laci`, 'pendapatan', createdAt);
  if (metode === 'bon') {
    run(
      "INSERT INTO kasbon (pelanggan_id, transaksi_id, nominal, status, tanggal, dicatat_oleh, catatan) VALUES (?, ?, ?, 'belum_lunas', ?, ?, ?)",
      budi.id, txId, total, tanggal, admin.id, '[seed] kasbon'
    );
  }
  addMutation(sesiId, 'Laba', laba, 'transaksi', txId, `seed:${kode}:Laba`, 'pendapatan_laba', createdAt);
  return { txId, kode, total };
}

function jualDigital(sesiId, tanggal, createdAt, p, akunSumber, hargaJual, adminFee, qty = 1) {
  const modal = p.harga_modal || 0;
  const total = hargaJual * qty;
  const { txId, kode } = insertTransaksi(sesiId, tanggal, createdAt, { jenis: 'produkdigital', metode: 'tunai', total, laba: adminFee });
  run(
    `INSERT INTO transaksi_item (transaksi_id, produk_id, nama_produk_snapshot, harga_snapshot, harga_modal_snapshot, qty, subtotal, akun_sumber)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    txId, p.id, p.nama, hargaJual, modal, qty, total, akunSumber
  );
  addMutation(sesiId, 'Tunai Laci', total, 'transaksi', txId, `seed:${kode}:Tunai Laci`, 'pendapatan', createdAt);
  addMutation(sesiId, akunSumber, -(modal * qty), 'transaksi', txId, `seed:${kode}:${akunSumber}`, 'saldo_akun', createdAt);
  addMutation(sesiId, 'Laba', adminFee, 'transaksi', txId, `seed:${kode}:Laba`, 'pendapatan_laba', createdAt);
}

function jualService(sesiId, tanggal, createdAt, namaDevice, kerusakan, biaya, modal, metode = 'tunai') {
  const r = run(
    `INSERT INTO service_hp (pelanggan_id, nama_device, deskripsi_kerusakan, status, biaya, harga_modal, tanggal_masuk, tanggal_selesai, catatan)
     VALUES (?, ?, ?, 'diambil', ?, ?, ?, ?, '[seed]')`,
    umum.id, namaDevice, kerusakan, biaya, modal, tanggal, tanggal
  );
  const svcId = Number(r.lastInsertRowid);
  const laba = biaya - modal;
  const { txId, kode } = insertTransaksi(sesiId, tanggal, createdAt, { metode, total: biaya, laba });
  run(
    `INSERT INTO transaksi_item (transaksi_id, service_hp_id, nama_produk_snapshot, harga_snapshot, harga_modal_snapshot, qty, subtotal)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    txId, svcId, `Service: ${namaDevice}`, biaya, modal, biaya
  );
  if (metode === 'tunai') addMutation(sesiId, 'Tunai Laci', biaya, 'transaksi', txId, `seed:${kode}:Tunai Laci`, 'pendapatan', createdAt);
  addMutation(sesiId, 'Laba', laba, 'transaksi', txId, `seed:${kode}:Laba`, 'pendapatan_laba', createdAt);
}

function buatPengeluaran(sesiId, tanggal, createdAt, deskripsi, nominal, akun) {
  const r = run(
    `INSERT INTO pengeluaran (deskripsi, kategori, nominal, metode_bayar, akun_sumber, tanggal, dicatat_oleh, created_at)
     VALUES (?, 'operasional', ?, 'tunai', ?, ?, ?, ?)`,
    `[seed] ${deskripsi}`, nominal, akun, tanggal, admin.id, createdAt
  );
  addMutation(sesiId, akun, -nominal, 'pengeluaran', Number(r.lastInsertRowid), `seed:${tanggal}:peng:${deskripsi}`, null, createdAt);
}

function buatTransfer(sesiId, tanggal, createdAt, dari, ke, nominal) {
  const r = run(
    `INSERT INTO transfer_saldo (tanggal, dari_akun, ke_akun, nominal, catatan, dibuat_oleh, created_at)
     VALUES (?, ?, ?, ?, '[seed] setor', ?, ?)`,
    tanggal, dari, ke, nominal, admin.id, createdAt
  );
  const id = Number(r.lastInsertRowid);
  addMutation(sesiId, dari, -nominal, 'penyesuaian', id, `seed:${tanggal}:tr:${dari}`, 'transfer_internal', createdAt);
  addMutation(sesiId, ke, nominal, 'penyesuaian', id, `seed:${tanggal}:tr:${ke}`, 'transfer_internal', createdAt);
}

function beliStok(sesiId, tanggal, createdAt, akun, items) {
  const total = items.reduce((s, it) => s + it.harga * it.qty, 0);
  const r = run(
    `INSERT INTO pembelian_stok (tanggal, akun_sumber, total, catatan, dibuat_oleh, created_at)
     VALUES (?, ?, ?, '[seed] beli stok', ?, ?)`,
    tanggal, akun, total, admin.id, createdAt
  );
  const id = Number(r.lastInsertRowid);
  for (const it of items) {
    run(
      `INSERT INTO pembelian_stok_item (pembelian_id, produk_id, qty, harga_modal_satuan, subtotal) VALUES (?, ?, ?, ?, ?)`,
      id, it.produk.id, it.qty, it.harga, it.harga * it.qty
    );
    addStok(it.produk.id, it.qty, createdAt);
    run('UPDATE produk SET harga_modal = ?, updated_at = ? WHERE id = ?', it.harga, createdAt, it.produk.id);
  }
  addMutation(sesiId, akun, -total, 'penyesuaian', id, `seed:${tanggal}:beli:${akun}`, 'pembelian_stok', createdAt);
}

function bayarKasbon(sesiId, tanggal, createdAt, akun = 'Tunai Laci') {
  const kb = get("SELECT k.* FROM kasbon k WHERE k.status = 'belum_lunas' AND k.catatan LIKE '[seed]%' ORDER BY k.id LIMIT 1");
  if (!kb) return;
  const sisa = Number(kb.nominal) - Number(kb.terbayar || 0);
  const r = run(
    `INSERT INTO kasbon_pembayaran (kasbon_id, nominal, metode, akun_id, dicatat_oleh, tanggal, created_at)
     VALUES (?, ?, 'tunai', ?, ?, ?, ?)`,
    kb.id, sisa, akun, admin.id, tanggal, createdAt
  );
  run("UPDATE kasbon SET terbayar = nominal, status = 'lunas', lunas_at = ? WHERE id = ?", createdAt, kb.id);
  addMutation(sesiId, akun, sisa, 'kasbon_pelunasan', Number(r.lastInsertRowid), `seed:${tanggal}:kasbon:${kb.id}`, null, createdAt);
}

// ---------------- Satu hari ----------------
let gajiMinggu = 0;
function seedDay(tanggal) {
  if (get('SELECT id FROM kasir_sesi WHERE tanggal = ?', tanggal)) {
    return false; // data asli / sudah ada
  }
  const openTs = isoAt(tanggal, 1, 0);
  const closeTs = isoAt(tanggal, 13, 0);
  const r = run(
    `INSERT INTO kasir_sesi (tanggal, dibuka_oleh, dibuka_at, ditutup_oleh, ditutup_at, status)
     VALUES (?, ?, ?, ?, ?, 'tutup')`,
    tanggal, admin.id, openTs, admin.id, closeTs
  );
  const sesiId = Number(r.lastInsertRowid);
  for (const [akun, saldo] of Object.entries(balances)) {
    run(
      `INSERT INTO kasir_saldo (kasir_sesi_id, nama_akun, saldo_sistem, saldo_real, selisih, tipe, created_at)
       VALUES (?, ?, ?, ?, 0, 'opening', ?)`,
      sesiId, akun, saldo, saldo, openTs
    );
  }

  const dNum = Number(tanggal.slice(-2));
  const weekend = isWeekend(tanggal);

  // Top-up saldo OrderKuota dari SeaBank bila mulai menipis.
  if ((balances['OrderKuota'] || 0) < 2000000) {
    buatTransfer(sesiId, tanggal, isoAt(tanggal, 2, 0), 'SeaBank', 'OrderKuota', 4000000);
  }

  // Gaji harian karyawan (informational) + akumulasi untuk dibayar mingguan.
  run(
    `INSERT OR IGNORE INTO gaji_harian (user_id, tanggal, nominal, sumber, catatan, created_at)
     VALUES (?, ?, 60000, 'auto', '[seed]', ?)`,
    karyawan.id, tanggal, isoAt(tanggal, 1, 5)
  );
  gajiMinggu += 60000;

  // Penjualan digital 1-2x/hari
  const nDigital = weekend ? 2 : 1;
  for (let i = 0; i < nDigital && produkDigital.length; i += 1) {
    const p = produkDigital[(dNum + i) % produkDigital.length];
    const fee = 1000 + ((dNum + i) % 3) * 500;
    jualDigital(sesiId, tanggal, isoAt(tanggal, 5 + i, 0), p, 'OrderKuota', p.harga + fee, fee, 1);
  }

  // Voucher fisik (lacak stok) hampir tiap hari
  if (produkVoucher.length && dNum % 2 === 1) {
    const p = produkVoucher[dNum % produkVoucher.length];
    jualFisik(sesiId, tanggal, isoAt(tanggal, 8, 0), p, 1, 'tunai');
  }

  // Aksesoris fisik (beberapa hari)
  if (produkFisik.length && dNum % 3 === 0) {
    const p = produkFisik[dNum % produkFisik.length];
    jualFisik(sesiId, tanggal, isoAt(tanggal, 9, 0), p, 1 + (dNum % 2), 'tunai');
  }

  // Service HP (2x/minggu)
  if (['selasa', 'jumat'].includes(wibWeekday(tanggal))) {
    const svc = [
      ['iPhone 11', 'Ganti LCD', 350000, 220000],
      ['Samsung A54', 'Ganti Baterai', 250000, 150000],
      ['Xiaomi Redmi 10', 'Ganti Touchscreen', 280000, 175000],
    ][dNum % 3];
    jualService(sesiId, tanggal, isoAt(tanggal, 10, 0), svc[0], svc[1], svc[2], svc[3], 'tunai');
  }

  // Kasbon (bon) kadang, & pelunasan kadang
  if (produkFisik.length && dNum % 7 === 4) {
    const p = produkFisik[dNum % produkFisik.length];
    jualFisik(sesiId, tanggal, isoAt(tanggal, 11, 0), p, 1, 'bon');
  }
  if (dNum % 7 === 6) bayarKasbon(sesiId, tanggal, isoAt(tanggal, 11, 30));

  // Pengeluaran operasional 2x/minggu
  if (['rabu', 'sabtu'].includes(wibWeekday(tanggal))) {
    buatPengeluaran(sesiId, tanggal, isoAt(tanggal, 6, 0), 'Listrik / kebersihan', 50000, 'Tunai Laci');
    buatPengeluaran(sesiId, tanggal, isoAt(tanggal, 6, 30), 'Kuota & internet', 100000, 'SeaBank');
  }

  // Transfer setor tunai ke bank 2x/minggu
  if (['kamis', 'sabtu'].includes(wibWeekday(tanggal))) {
    buatTransfer(sesiId, tanggal, isoAt(tanggal, 12, 0), 'Tunai Laci', 'SeaBank', 300000);
  }

  // Beli stok (voucher dari OrderKuota) 1x/minggu
  if (wibWeekday(tanggal) === 'senin' && produkVoucher.length) {
    beliStok(sesiId, tanggal, isoAt(tanggal, 12, 30), 'OrderKuota', produkVoucher.slice(0, 2).map((p) => ({ produk: p, qty: 5, harga: p.harga_modal || 0 })));
  }

  // Bayar gaji mingguan (tiap sabtu) dari Tunai Laci
  if (wibWeekday(tanggal) === 'sabtu' && gajiMinggu > 0) {
    buatPengeluaran(sesiId, tanggal, isoAt(tanggal, 12, 45), `Bayar gaji karyawan (${gajiMinggu / 60000} hari)`, gajiMinggu, 'Tunai Laci');
    gajiMinggu = 0;
  }

  // Closing
  for (const akun of Object.keys(balances)) {
    const akhir = balances[akun];
    run(
      `INSERT INTO kasir_saldo (kasir_sesi_id, nama_akun, saldo_sistem, saldo_real, selisih, tipe, created_at)
       VALUES (?, ?, ?, ?, 0, 'closing', ?)`,
      sesiId, akun, akhir, akhir, closeTs
    );
  }
  return true;
}

console.log(`[seed-history] membuat ${DAYS} hari...`);
let created = 0;
for (let i = DAYS; i >= 1; i -= 1) {
  if (seedDay(wibDate(i))) created += 1;
}
console.log(`[seed-history] selesai: ${created} hari baru. Saldo akhir:`, balances);
