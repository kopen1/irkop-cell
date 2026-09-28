import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, setPermission, createKategoriRaw, createProdukRaw } from './helpers.js';

function wibNow() { return new Date(new Date().getTime() + 7 * 3600 * 1000); }
function currentBulan() {
  const d = wibNow();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function bootstrap() {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 2000000 }, { nama_akun: 'SeaBank', saldo: 5000000 }] },
  });
  return { env, token };
}

async function closeKasir(env, token) {
  const cur = await call(env, '/api/kasir/current', { token });
  const saldoReal = cur.data.saldo
    .filter((x) => x.nama_akun !== 'Total Saldo')
    .map((x) => ({ nama_akun: x.nama_akun, saldo_real: x.saldo_sistem }));
  const r = await call(env, '/api/kasir/closing', { method: 'POST', token, body: { saldo_real: saldoReal } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r;
}

test('Isi Saldo (transfer) tetap bisa setelah kasir ditutup (setoran pasca-closing)', async () => {
  const { env, token } = await bootstrap();
  await closeKasir(env, token);

  const status = await call(env, '/api/kasir/current', { token });
  assert.equal(status.data.status, 'tutup');

  const r = await call(env, '/api/transfer-saldo', {
    method: 'POST', token,
    body: { dari_akun: 'Tunai Laci', ke_akun: 'SeaBank', nominal: 1500000, catatan: 'setor ATM setelah tutup' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  const cur = await call(env, '/api/kasir/current', { token });
  const laci = cur.data.saldo.find((x) => x.nama_akun === 'Tunai Laci');
  const bank = cur.data.saldo.find((x) => x.nama_akun === 'SeaBank');
  assert.equal(laci.saldo_sistem, 500000, 'laci sisa 500k');
  assert.equal(bank.saldo_sistem, 6500000, 'bank +1.5jt');
});

test('Buka ulang sesi yang sudah ditutup: status buka & hasil closing lama dihapus', async () => {
  const { env, token } = await bootstrap();
  await closeKasir(env, token);
  let cur = await call(env, '/api/kasir/current', { token });
  assert.equal(cur.data.status, 'tutup');

  const r = await call(env, '/api/kasir/reopen', { method: 'POST', token, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'buka');

  cur = await call(env, '/api/kasir/current', { token });
  assert.equal(cur.data.status, 'buka');
  assert.equal((cur.data.closing || []).length, 0, 'hasil closing lama dibersihkan');

  // Bisa closing ulang tanpa dobel.
  await closeKasir(env, token);
  cur = await call(env, '/api/kasir/current', { token });
  assert.equal(cur.data.status, 'tutup');
});

test('Opening menyarankan saldo awal dari sesi terakhir', async () => {
  const { env, token } = await bootstrap();
  await closeKasir(env, token);

  const r = await call(env, '/api/kasir/current?tanggal=2099-01-01', { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'belum_buka');
  const map = Object.fromEntries((r.data.saldo_awal_saran || []).map((s) => [s.nama_akun, s.saldo]));
  assert.equal(map['Tunai Laci'], 2000000, 'saran laci dari closing terakhir');
  assert.equal(map['SeaBank'], 5000000, 'saran bank dari closing terakhir');
});

test('Buku Kas: memuat semua pergerakan (jual, pengeluaran, beli stok, transfer)', async () => {
  const { env, token } = await bootstrap();
  const kat = await createKategoriRaw(env, 'Aksesoris', 1);
  const prod = await createProdukRaw(env, { kode: 'AC-BK1', nama: 'Kabel', kategori_id: kat, harga: 20000, harga_modal: 10000, stok: 10 });

  await call(env, '/api/transaksi', { method: 'POST', token, body: { items: [{ produk_id: prod, qty: 1 }], metode_bayar: 'tunai' } });
  await call(env, '/api/pengeluaran', { method: 'POST', token, body: { deskripsi: 'Listrik', nominal: 50000, metode_bayar: 'transfer', akun_sumber: 'SeaBank' } });
  await call(env, '/api/pembelian-stok', { method: 'POST', token, body: { akun_sumber: 'SeaBank', items: [{ produk_id: prod, qty: 5, harga_modal_satuan: 10000 }] } });
  await call(env, '/api/transfer-saldo', { method: 'POST', token, body: { dari_akun: 'Tunai Laci', ke_akun: 'SeaBank', nominal: 100000 } });

  const r = await call(env, `/api/laporan/buku-kas?bulan=${currentBulan()}`, { token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const jenis = r.data.per_jenis.map((j) => j.jenis);
  assert.ok(jenis.includes('Penjualan/Transaksi'), `ada penjualan: ${jenis}`);
  assert.ok(jenis.includes('Pengeluaran'), `ada pengeluaran: ${jenis}`);
  assert.ok(jenis.includes('Beli Stok'), `ada beli stok: ${jenis}`);
  assert.ok(jenis.includes('Transfer antar akun'), `ada transfer: ${jenis}`);
  assert.ok(r.data.detail.length >= 5, 'detail memuat semua mutasi');
});

test('Export CSV memuat baris BELI_STOK & TRANSFER_SALDO', async () => {
  const { env, token } = await bootstrap();
  const kat = await createKategoriRaw(env, 'Aksesoris', 1);
  const prod = await createProdukRaw(env, { kode: 'AC-BK2', nama: 'Headset', kategori_id: kat, harga: 30000, harga_modal: 20000, stok: 0 });
  await call(env, '/api/pembelian-stok', { method: 'POST', token, body: { akun_sumber: 'SeaBank', items: [{ produk_id: prod, qty: 2, harga_modal_satuan: 20000 }] } });
  await call(env, '/api/transfer-saldo', { method: 'POST', token, body: { dari_akun: 'Tunai Laci', ke_akun: 'SeaBank', nominal: 50000 } });

  const res = await (await import('../src/index.js')).default.fetch(
    new Request(`https://irkop.local/api/laporan/export?cakupan=bulan&bulan=${currentBulan()}`, { headers: { Authorization: `Bearer ${token}` } }),
    env
  );
  const text = await res.text();
  assert.match(text, /BELI_STOK/);
  assert.match(text, /TRANSFER_SALDO/);
});

test('kasir/reopen: karyawan DITOLAK (admin only)', async () => {
  const { env } = await bootstrap();
  const idKar = await createUserRaw(env, { nama: 'Kar', username: 'kar', password: 'kar12345', role: 'karyawan' });
  await setPermission(env, idKar, 'kasir');
  const tokenKar = await login(env, 'kar', 'kar12345');

  const r = await call(env, '/api/kasir/reopen', { method: 'POST', token: tokenKar, body: {} });
  assert.equal(r.status, 403, `harus 403, dapat ${r.status}: ${JSON.stringify(r.data)}`);
  assert.equal(r.data?.error?.code, 'forbidden');
});

test('kasir/reopen: karyawan DITOLAK walau body menyertakan tanggal lampau', async () => {
  const { env } = await bootstrap();
  const idKar = await createUserRaw(env, { nama: 'Kar', username: 'kar', password: 'kar12345', role: 'karyawan' });
  await setPermission(env, idKar, 'kasir');
  const tokenKar = await login(env, 'kar', 'kar12345');

  const r = await call(env, '/api/kasir/reopen', { method: 'POST', token: tokenKar, body: { tanggal: '2026-09-20' } });
  assert.equal(r.status, 403, 'harus 403 walau body punya tanggal');
});

test('kasir/reopen: admin bisa buka ulang sesi lampau lewat { tanggal }', async () => {
  const { env, token } = await bootstrap();
  const day = '2026-09-20';

  // Buat sesi pada tanggal lampau lalu tutup.
  const idSesi = await env.DB.prepare(
    `INSERT INTO kasir_sesi (tanggal, status, dibuka_oleh, dibuka_at, ditutup_at, ditutup_oleh)
     VALUES (?, 'tutup', 1, ?, ?, 1)`
  ).bind(day, new Date().toISOString(), new Date().toISOString()).run();
  await env.DB.prepare(
    `INSERT INTO kasir_saldo (kasir_sesi_id, nama_akun, tipe, saldo_sistem, saldo_real)
     VALUES (?, 'Tunai Laci', 'closing', 500000, 500000)`
  ).bind(idSesi.meta.last_row_id).run();

  const sebelum = await call(env, '/api/kasir/current?tanggal=' + day, { token });
  assert.equal(sebelum.data.status, 'tutup');

  const r = await call(env, '/api/kasir/reopen', { method: 'POST', token, body: { tanggal: day } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.tanggal, day);
  assert.equal(r.data.status, 'buka');

  // Closing lama dihapus, sesi kembali bisa dipakai.
  const sesudah = await call(env, '/api/kasir/current?tanggal=' + day, { token });
  assert.equal(sesudah.data.status, 'buka');
  const closing = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM kasir_saldo WHERE kasir_sesi_id = ? AND tipe = 'closing'`
  ).bind(idSesi.meta.last_row_id).first();
  assert.equal(Number(closing.n), 0, 'closing lama harus terhapus');
});
