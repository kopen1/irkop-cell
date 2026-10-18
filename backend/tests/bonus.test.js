import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, setPermission, createKategoriRaw, createProdukRaw, sisipSesiTanggal } from './helpers.js';

// ITEM 15 — Bonus Penjualan
// Invarian:
// - Akru bonus dievaluasi SETELAH transaksi commit (qty & produk asli).
// - Bonus per unit × qty. Aturan bisa target produk atau kategori.
// - Bonus diakru ke kasir yang menjual (transaksi.dibuat_oleh).
// - Pembayaran lewat pengeluaran kategori 'bonus' + mutasi_saldo,
//   sama seperti gaji (tabel bonus_penjualan.dibayar_at).

function wibNow() {
  return new Date(new Date().getTime() + 7 * 3600 * 1000);
}
function todayWib() {
  return `${wibNow().getUTCFullYear()}-${String(wibNow().getUTCMonth() + 1).padStart(2, '0')}-${String(wibNow().getUTCDate()).padStart(2, '0')}`;
}

test('bonus: aturan produk → kasir dapat bonus per unit', async () => {
  const { env } = setupEnv();
  const adminId = await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const karyawanId = await createUserRaw(env, { nama: 'Karyawan', username: 'kry', password: 'kry12345', role: 'karyawan' });
  await setPermission(env, karyawanId, 'kasir');
  await setPermission(env, karyawanId, 'transaksi');
  const adminToken = await login(env, 'admin', 'admin1234');
  const karyawanToken = await login(env, 'kry', 'kry12345');
  const today = todayWib();

  // Buka kasir hari ini (karyawan)
  await call(env, '/api/kasir/opening', { method: 'POST', token: karyawanToken, body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 100000 }] } });

  // Buat kategori & produk
  const katId = await createKategoriRaw(env, 'Aksesoris');
  const prodId = await createProdukRaw(env, { kode: 'BNS-01', nama: 'Kabel USB', kategori_id: katId, harga: 20000, harga_modal: 10000, stok: 10 });

  // Aturan: produk BNS-01 → bonus 2.000 per unit
  const aturan = await call(env, '/api/bonus/aturan', { method: 'POST', token: adminToken, body: { nama: 'Bonus Kabel', jenis_target: 'produk', target_id: prodId, jumlah: 2000 } });
  assert.equal(aturan.status, 200, JSON.stringify(aturan.data));

  // Jual 3 unit
  const idem1 = 'bonus-test-1';
  const trx1 = await call(env, '/api/transaksi', { method: 'POST', token: karyawanToken, headers: { 'Idempotency-Key': idem1 }, body: { jenis: 'penjualan', metode_bayar: 'tunai', items: [{ produk_id: prodId, qty: 3, harga: 20000 }] } });
  assert.equal(trx1.status, 200, JSON.stringify(trx1.data));

  // Cek bonus terakru
  const bonusList = await call(env, '/api/bonus?tanggal=' + today, { token: adminToken });
  const row = bonusList.data.items.find((b) => b.transaksi_kode === trx1.data.id);
  assert.ok(row, 'bonus terakru untuk transaksi 1');
  assert.equal(row.user_id, karyawanId);
  assert.equal(row.jumlah, 6000); // 3 × 2000
  assert.equal(row.nama_produk, 'Kabel USB');
  assert.equal(row.qty, 3);
  assert.equal(row.dibayar_at, null);
});

test('bonus: aturan kategori → semua produk di kategori dapat bonus', async () => {
  const { env } = setupEnv();
  const adminId = await createUserRaw(env, { nama: 'Admin2', username: 'adm2', password: 'adm21234', role: 'admin' });
  const karyawanId = await createUserRaw(env, { nama: 'Karyawan2', username: 'kry2', password: 'kry212345', role: 'karyawan' });
  await setPermission(env, karyawanId, 'kasir');
  await setPermission(env, karyawanId, 'transaksi');
  const adminToken = await login(env, 'adm2', 'adm21234');
  const karyawanToken = await login(env, 'kry2', 'kry212345');
  const today = todayWib();

  await call(env, '/api/kasir/opening', { method: 'POST', token: karyawanToken, body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 100000 }] } });

  const katId = await createKategoriRaw(env, 'Sparepart');
  const p1 = await createProdukRaw(env, { kode: 'BNS-02', nama: 'LCD A', kategori_id: katId, harga: 50000, harga_modal: 30000, stok: 5 });
  const p2 = await createProdukRaw(env, { kode: 'BNS-03', nama: 'LCD B', kategori_id: katId, harga: 60000, harga_modal: 35000, stok: 5 });

  // Aturan: kategori Sparepart → 5.000 per unit
  const aturan = await call(env, '/api/bonus/aturan', { method: 'POST', token: adminToken, body: { nama: 'Bonus Sparepart', jenis_target: 'kategori', target_id: katId, jumlah: 5000 } });
  assert.equal(aturan.status, 200, JSON.stringify(aturan.data));

  // Jual campuran 2 produk di kategori itu
  await call(env, '/api/transaksi', { method: 'POST', token: karyawanToken, headers: { 'Idempotency-Key': 'bonus-kat-1' }, body: { jenis: 'penjualan', metode_bayar: 'tunai', items: [{ produk_id: p1, qty: 2 }, { produk_id: p2, qty: 1 }] } });

  const bonusList = await call(env, '/api/bonus?tanggal=' + today, { token: adminToken });
  const rows = bonusList.data.items.filter((b) => b.aturan_id === aturan.data.id);
  assert.equal(rows.length, 2, 'dua baris bonus untuk dua produk berbeda');
  const total = rows.reduce((s, r) => s + r.jumlah, 0);
  assert.equal(total, 15000); // (2+1) × 5000
});

test('bonus: transaksi kedua punya bonus sendiri (tidak basi)', async () => {
  const { env } = setupEnv();
  const adminId = await createUserRaw(env, { nama: 'Admin3', username: 'adm3', password: 'adm31234', role: 'admin' });
  const karyawanId = await createUserRaw(env, { nama: 'Karyawan3', username: 'kry3', password: 'kry312345', role: 'karyawan' });
  await setPermission(env, karyawanId, 'kasir');
  await setPermission(env, karyawanId, 'transaksi');
  const adminToken = await login(env, 'adm3', 'adm31234');
  const karyawanToken = await login(env, 'kry3', 'kry312345');
  const today = todayWib();

  await call(env, '/api/kasir/opening', { method: 'POST', token: karyawanToken, body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 100000 }] } });

  const katId = await createKategoriRaw(env, 'TestKat');
  const prodId = await createProdukRaw(env, { kode: 'BNS-04', nama: 'Produk Bonus', kategori_id: katId, harga: 10000, harga_modal: 5000, stok: 20 });
  await call(env, '/api/bonus/aturan', { method: 'POST', token: adminToken, body: { nama: 'Bonus Test', jenis_target: 'produk', target_id: prodId, jumlah: 1000 } });

  // Transaksi #1
  await call(env, '/api/transaksi', { method: 'POST', token: karyawanToken, headers: { 'Idempotency-Key': 'bonus-seq-1' }, body: { jenis: 'penjualan', metode_bayar: 'tunai', items: [{ produk_id: prodId, qty: 1 }] } });
  let bonusList = await call(env, '/api/bonus?tanggal=' + today, { token: adminToken });
  let rows = bonusList.data.items.filter((b) => b.produk_id === prodId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].jumlah, 1000);

  // Transaksi #2 (harus mendapat bonus sendiri, tidak menimpa #1)
  await call(env, '/api/transaksi', { method: 'POST', token: karyawanToken, headers: { 'Idempotency-Key': 'bonus-seq-2' }, body: { jenis: 'penjualan', metode_bayar: 'tunai', items: [{ produk_id: prodId, qty: 2 }] } });
  bonusList = await call(env, '/api/bonus?tanggal=' + today, { token: adminToken });
  rows = bonusList.data.items.filter((b) => b.produk_id === prodId);
  assert.equal(rows.length, 2, 'dua transaksi → dua baris bonus');
  const totals = rows.map((r) => r.jumlah).sort((a, b) => a - b);
  assert.deepEqual(totals, [1000, 2000]); // 1×1000 dan 2×1000
});

test('bonus: pembayaran lewat pengeluaran + mutasi + dibayar_at', async () => {
  const { env } = setupEnv();
  const adminId = await createUserRaw(env, { nama: 'Admin4', username: 'adm4', password: 'adm41234', role: 'admin' });
  const karyawanId = await createUserRaw(env, { nama: 'Karyawan4', username: 'kry4', password: 'kry412345', role: 'karyawan' });
  await setPermission(env, karyawanId, 'kasir');
  await setPermission(env, karyawanId, 'transaksi');
  const adminToken = await login(env, 'adm4', 'adm41234');
  const karyawanToken = await login(env, 'kry4', 'kry412345');
  const today = todayWib();

  await call(env, '/api/kasir/opening', { method: 'POST', token: karyawanToken, body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 100000 }] } });

  const katId = await createKategoriRaw(env, 'BonusKat');
  const prodId = await createProdukRaw(env, { kode: 'BNS-05', nama: 'BayarBonus', kategori_id: katId, harga: 10000, harga_modal: 5000, stok: 10 });
  await call(env, '/api/bonus/aturan', { method: 'POST', token: adminToken, body: { nama: 'Bonus Bayar', jenis_target: 'produk', target_id: prodId, jumlah: 3000 } });
  await call(env, '/api/transaksi', { method: 'POST', token: karyawanToken, headers: { 'Idempotency-Key': 'bonus-bayar-1' }, body: { jenis: 'penjualan', metode_bayar: 'tunai', items: [{ produk_id: prodId, qty: 2 }] } });

  // Cek unpaid
  const unpaid = await call(env, '/api/bonus/unpaid', { token: adminToken });
  assert.ok(unpaid.data.items.find((u) => u.user_id === karyawanId && u.total === 6000));

  // Bayar
  const bayar = await call(env, '/api/bonus/bayar', { method: 'POST', token: adminToken, body: { user_id: karyawanId } });
  assert.equal(bayar.status, 200, JSON.stringify(bayar.data));
  assert.equal(bayar.data.total, 6000);
  assert.ok(bayar.data.pengeluaran_id);
  assert.ok(bayar.data.status === 'dibayar');

  // Cek dibayar_at terisi
  const bonusList = await call(env, '/api/bonus?tanggal=' + today, { token: adminToken });
  const rows = bonusList.data.items.filter((b) => b.user_id === karyawanId);
  assert.ok(rows.every((r) => r.dibayar_at !== null), 'semua bonus sudah dibayar');

  // Cek pengeluaran & mutasi
  const pengeluaranList = await call(env, '/api/pengeluaran?date=' + today, { token: adminToken });
  const pg = pengeluaranList.data.items.find((p) => p.kategori === 'bonus' && p.nominal === 6000);
  assert.ok(pg, 'pengeluaran kategori bonus dibuat');
});

test('bonus: update transaksi mengubah item → bonus menyesuaikan', async () => {
  const { env } = setupEnv();
  const adminId = await createUserRaw(env, { nama: 'Admin5', username: 'adm5', password: 'adm51234', role: 'admin' });
  const karyawanId = await createUserRaw(env, { nama: 'Karyawan5', username: 'kry5', password: 'kry512345', role: 'karyawan' });
  await setPermission(env, karyawanId, 'kasir');
  await setPermission(env, karyawanId, 'transaksi');
  const adminToken = await login(env, 'adm5', 'adm51234');
  const karyawanToken = await login(env, 'kry5', 'kry512345');
  const today = todayWib();

  await call(env, '/api/kasir/opening', { method: 'POST', token: karyawanToken, body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 100000 }] } });

  const katId = await createKategoriRaw(env, 'UpdKat');
  const prodId = await createProdukRaw(env, { kode: 'BNS-06', nama: 'UpdBonus', kategori_id: katId, harga: 10000, harga_modal: 5000, stok: 10 });
  const prodNoBonus = await createProdukRaw(env, { kode: 'BNS-06B', nama: 'TanpaBonus', kategori_id: katId, harga: 15000, harga_modal: 8000, stok: 10 });
  const aturan = await call(env, '/api/bonus/aturan', { method: 'POST', token: adminToken, body: { nama: 'Bonus Upd', jenis_target: 'produk', target_id: prodId, jumlah: 2000 } });
  const trx = await call(env, '/api/transaksi', { method: 'POST', token: karyawanToken, headers: { 'Idempotency-Key': 'bonus-upd-1' }, body: { jenis: 'penjualan', metode_bayar: 'tunai', items: [{ produk_id: prodId, qty: 3 }] } });
  assert.equal(trx.status, 200, JSON.stringify(trx.data));

  let bonusList = await call(env, '/api/bonus?tanggal=' + today, { token: adminToken });
  assert.equal(bonusList.data.items.find((b) => b.transaksi_kode === trx.data.id)?.jumlah, 6000);

  // Update transaksi: ganti item ke produk tanpa bonus
  const upd = await call(env, '/api/transaksi/' + trx.data.id, { method: 'PUT', token: karyawanToken, body: { items: [{ produk_id: prodNoBonus, qty: 2 }] } });
  assert.equal(upd.status, 200, JSON.stringify(upd.data));

  bonusList = await call(env, '/api/bonus?tanggal=' + today, { token: adminToken });
  const rows = bonusList.data.items.filter((b) => b.transaksi_kode === trx.data.id);
  // Bonus lama harus di-void (tidak muncul di list), bonus baru tidak ada karena produk tidak punya aturan
  assert.ok(rows.length === 0, 'bonus lama di-void saat item diganti ke produk tanpa aturan');
});

test('bonus: soft delete transaksi tanpa bonus dibayar → bonus di-void', async () => {
  const { env } = setupEnv();
  const adminId = await createUserRaw(env, { nama: 'Admin6', username: 'adm6', password: 'adm61234', role: 'admin' });
  const karyawanId = await createUserRaw(env, { nama: 'Karyawan6', username: 'kry6', password: 'kry612345', role: 'karyawan' });
  await setPermission(env, karyawanId, 'kasir');
  await setPermission(env, karyawanId, 'transaksi');
  const adminToken = await login(env, 'adm6', 'adm61234');
  const karyawanToken = await login(env, 'kry6', 'kry612345');
  const today = todayWib();

  await call(env, '/api/kasir/opening', { method: 'POST', token: karyawanToken, body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 100000 }] } });

  const katId = await createKategoriRaw(env, 'DelKat');
  const prodId = await createProdukRaw(env, { kode: 'BNS-07', nama: 'DelBonus', kategori_id: katId, harga: 10000, harga_modal: 5000, stok: 10 });
  await call(env, '/api/bonus/aturan', { method: 'POST', token: adminToken, body: { nama: 'Bonus Del', jenis_target: 'produk', target_id: prodId, jumlah: 1500 } });
  const trx = await call(env, '/api/transaksi', { method: 'POST', token: karyawanToken, headers: { 'Idempotency-Key': 'bonus-del-1' }, body: { jenis: 'penjualan', metode_bayar: 'tunai', items: [{ produk_id: prodId, qty: 2 }] } });
  assert.equal(trx.status, 200, JSON.stringify(trx.data));

  // Hapus transaksi
  const del = await call(env, '/api/transaksi/' + trx.data.id, { method: 'DELETE', token: adminToken, body: { deleted_reason: 'test hapus' } });
  assert.equal(del.status, 200, JSON.stringify(del.data));

  // Bonus ikut di-void (deleted_at diset) → tidak muncul di list (deleted_at IS NULL)
  const bonusList = await call(env, '/api/bonus?tanggal=' + today, { token: adminToken });
  const row = bonusList.data.items.find((b) => b.transaksi_kode === trx.data.id);
  assert.ok(!row, 'bonus di-void bersama transaksi (tidak muncul di list)');
});

test('bonus: soft delete transaksi DENGAN bonus dibayar → 409 bonus_sudah_dibayar', async () => {
  const { env } = setupEnv();
  const adminId = await createUserRaw(env, { nama: 'Admin7', username: 'adm7', password: 'adm71234', role: 'admin' });
  const karyawanId = await createUserRaw(env, { nama: 'Karyawan7', username: 'kry7', password: 'kry712345', role: 'karyawan' });
  await setPermission(env, karyawanId, 'kasir');
  await setPermission(env, karyawanId, 'transaksi');
  const adminToken = await login(env, 'adm7', 'adm71234');
  const karyawanToken = await login(env, 'kry7', 'kry712345');
  const today = todayWib();

  await call(env, '/api/kasir/opening', { method: 'POST', token: karyawanToken, body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 100000 }] } });

  const katId = await createKategoriRaw(env, 'PaidKat');
  const prodId = await createProdukRaw(env, { kode: 'BNS-08', nama: 'PaidBonus', kategori_id: katId, harga: 10000, harga_modal: 5000, stok: 10 });
  await call(env, '/api/bonus/aturan', { method: 'POST', token: adminToken, body: { nama: 'Bonus Paid', jenis_target: 'produk', target_id: prodId, jumlah: 1000 } });
  const trx = await call(env, '/api/transaksi', { method: 'POST', token: karyawanToken, headers: { 'Idempotency-Key': 'bonus-paid-1' }, body: { jenis: 'penjualan', metode_bayar: 'tunai', items: [{ produk_id: prodId, qty: 1 }] } });
  assert.equal(trx.status, 200, JSON.stringify(trx.data));

  // Bayar bonus dulu
  await call(env, '/api/bonus/bayar', { method: 'POST', token: adminToken, body: { user_id: karyawanId } });

  // Sekarang coba hapus transaksi → harus 409
  const del = await call(env, '/api/transaksi/' + trx.data.id, { method: 'DELETE', token: adminToken, body: { deleted_reason: 'coba hapus yg sudah bayar' } });
  assert.equal(del.status, 409, `status=${del.status} data=${JSON.stringify(del.data)}`);
  assert.equal(del.data?.error?.code, 'bonus_sudah_dibayar');
});

test('bonus: validasi target tidak ditemukan', async () => {
  const { env } = setupEnv();
  const adminId = await createUserRaw(env, { nama: 'Admin8', username: 'adm8', password: 'adm81234', role: 'admin' });
  const adminToken = await login(env, 'adm8', 'adm81234');

  // Produk ID 9999 tidak ada
  const res = await call(env, '/api/bonus/aturan', { method: 'POST', token: adminToken, body: { nama: 'Salah', jenis_target: 'produk', target_id: 9999, jumlah: 1000 } });
  assert.equal(res.status, 400, `status=${res.status} data=${JSON.stringify(res.data)}`);
  assert.equal(res.data?.error?.code, 'invalid_target');
});

test('bonus: update aturan → aktif=0 tidak hapus akru lama', async () => {
  const { env } = setupEnv();
  const adminId = await createUserRaw(env, { nama: 'Admin9', username: 'adm9', password: 'adm91234', role: 'admin' });
  const karyawanId = await createUserRaw(env, { nama: 'Karyawan9', username: 'kry9', password: 'kry912345', role: 'karyawan' });
  await setPermission(env, karyawanId, 'kasir');
  await setPermission(env, karyawanId, 'transaksi');
  const adminToken = await login(env, 'adm9', 'adm91234');
  const karyawanToken = await login(env, 'kry9', 'kry912345');
  const today = todayWib();

  await call(env, '/api/kasir/opening', { method: 'POST', token: karyawanToken, body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 100000 }] } });

  const katId = await createKategoriRaw(env, 'NonKat');
  const prodId = await createProdukRaw(env, { kode: 'BNS-09', nama: 'NonBonus', kategori_id: katId, harga: 10000, harga_modal: 5000, stok: 10 });
  const aturan = await call(env, '/api/bonus/aturan', { method: 'POST', token: adminToken, body: { nama: 'Bonus Non', jenis_target: 'produk', target_id: prodId, jumlah: 1000 } });
  await call(env, '/api/transaksi', { method: 'POST', token: karyawanToken, headers: { 'Idempotency-Key': 'bonus-non-1' }, body: { jenis: 'penjualan', metode_bayar: 'tunai', items: [{ produk_id: prodId, qty: 2 }] } });

  // Nonaktifkan aturan
  await call(env, '/api/bonus/aturan/' + aturan.data.id, { method: 'DELETE', token: adminToken });

  // Akru lama tetap ada (hanya tidak bisa buat bonus BARU)
  const bonusList = await call(env, '/api/bonus?tanggal=' + today, { token: adminToken });
  const row = bonusList.data.items.find((b) => b.aturan_id === aturan.data.id);
  assert.ok(row && !row.deleted_at, 'akru lama tetap utuh saat aturan dinonaktifkan');
});

test('bonus: transaksi tetap bisa dibuat & dihapus walau tabel bonus belum ada (migrasi 0015 belum jalan)', async () => {
  const { env, sqliteDb } = setupEnv();
  await createUserRaw(env, { nama: 'Admin10', username: 'adm10', password: 'adm101234', role: 'admin' });
  const karyawanId = await createUserRaw(env, { nama: 'Karyawan10', username: 'kry10', password: 'kry1012345', role: 'karyawan' });
  await setPermission(env, karyawanId, 'kasir');
  await setPermission(env, karyawanId, 'transaksi');
  const karyawanToken = await login(env, 'kry10', 'kry1012345');

  // Simulasi produksi: migrasi 0015 belum diterapkan sama sekali
  sqliteDb.exec('DROP TABLE IF EXISTS bonus_penjualan');
  sqliteDb.exec('DROP TABLE IF EXISTS bonus_aturan');

  await call(env, '/api/kasir/opening', { method: 'POST', token: karyawanToken, body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 100000 }] } });
  const katId = await createKategoriRaw(env, 'TanpaBonus');
  const prodId = await createProdukRaw(env, { kode: 'NOB-01', nama: 'Tanpa Bonus', kategori_id: katId, harga: 10000, harga_modal: 5000, stok: 5 });

  const trx = await call(env, '/api/transaksi', {
    method: 'POST', token: karyawanToken, headers: { 'Idempotency-Key': 'no-bonus-1' },
    body: { jenis: 'penjualan', metode_bayar: 'tunai', items: [{ produk_id: prodId, qty: 1 }] },
  });
  assert.equal(trx.status, 200, JSON.stringify(trx.data));

  const del = await call(env, '/api/transaksi/' + trx.data.id, {
    method: 'DELETE', token: karyawanToken, headers: { 'Idempotency-Key': 'no-bonus-del-1' },
  });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(del.data.status, 'soft_deleted');
});