// Sesi kasir untuk sebuah transaksi harus mengikuti TANGGAL TRANSAKSI, bukan
// tanggal hari ini. Kalau tidak, mutasi/reversal masuk ke buku kasir yang salah.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, createKategoriRaw, createProdukRaw } from './helpers.js';

const HARI_INI = new Date().toISOString().slice(0, 10);
const KEMARIN = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

async function bootstrap() {
  const { env } = setupEnv();
  const adminId = await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  const kategori = await createKategoriRaw(env, 'Voucher', 0);
  const produkId = await createProdukRaw(env, { kode: 'P1', nama: 'Voucher', kategori_id: kategori, harga: 10000, harga_modal: 9000, stok: 0 });
  return { env, token, produkId, adminId };
}

// POST /kasir/opening hanya membuka sesi HARI INI, jadi untuk tanggal lain
// sesi disisipkan langsung (skenario "kemarin" tidak bisa dibentuk via API).
async function sisipSesi(env, adminId, tanggal, status = 'buka', saldoAwal = 0) {
  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO kasir_sesi (tanggal, dibuka_oleh, dibuka_at, ditutup_oleh, ditutup_at, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(tanggal, adminId, now, status === 'tutup' ? adminId : null, status === 'tutup' ? now : null, status)
    .run();
  const sesi = await env.DB.prepare('SELECT id FROM kasir_sesi WHERE tanggal = ?').bind(tanggal).first();
  if (saldoAwal > 0) {
    await env.DB
      .prepare(`INSERT INTO kasir_saldo (kasir_sesi_id, nama_akun, saldo_sistem, tipe) VALUES (?, 'Tunai Laci', ?, 'opening')`)
      .bind(sesi.id, saldoAwal)
      .run();
  }
  return sesi.id;
}

const buka = (env, token, saldo) =>
  call(env, '/api/kasir/opening', { method: 'POST', token, body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo }] } });

const item = (produkId, qty = 1) => [{ produk_id: produkId, qty, harga: 10000, harga_modal: 9000 }];

async function sesiId(env, tanggal) {
  const row = await env.DB.prepare('SELECT id FROM kasir_sesi WHERE tanggal = ?').bind(tanggal).first();
  return row ? row.id : null;
}

async function hitungMutasi(env, sesiIdBaru, sumberTipe) {
  const r = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM mutasi_saldo WHERE kasir_sesi_id = ? AND sumber_tipe = ?')
    .bind(sesiIdBaru, sumberTipe)
    .first();
  return r.n;
}

test('create transaksi bertanggal kemarin: butuh & memakai sesi kemarin, bukan sesi hari ini', async () => {
  const { env, token, produkId, adminId } = await bootstrap();
  await sisipSesi(env, adminId, KEMARIN, 'buka', 500000); // hanya sesi KEMARIN

  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { items: item(produkId), metode_bayar: 'tunai', tanggal_transaksi: KEMARIN },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  assert.equal(await hitungMutasi(env, await sesiId(env, KEMARIN), 'transaksi'), 2,
    'mutasi (tunai + laba) harus di sesi tanggal transaksi');
  assert.equal(await sesiId(env, HARI_INI), null, 'sesi hari ini tidak boleh ikut dibuat');
});

test('create transaksi bertanggal tanpa sesi: ditolak 409, tidak masuk buku kasir lain', async () => {
  const { env, token, produkId } = await bootstrap();
  await buka(env, token, 100000); // hanya sesi HARI INI

  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { items: item(produkId), metode_bayar: 'tunai', tanggal_transaksi: KEMARIN },
  });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'session_not_open');
  assert.match(r.data.error.message, new RegExp(KEMARIN), 'pesan menyebut tanggal yang bermasalah');
});

test('edit transaksi kemarin: reversal + mutasi baru tetap di sesi kemarin', async () => {
  const { env, token, produkId, adminId } = await bootstrap();
  await sisipSesi(env, adminId, KEMARIN, 'buka', 500000);
  await buka(env, token, 100000); // sesi HARI INI juga dibuka — inilah yang dulu membocorkan mutasi

  const create = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { items: item(produkId), metode_bayar: 'tunai', tanggal_transaksi: KEMARIN },
  });
  assert.equal(create.status, 200, JSON.stringify(create.data));

  const upd = await call(env, `/api/transaksi/${create.data.id}`, {
    method: 'PUT', token, body: { items: item(produkId, 2) },
  });
  assert.equal(upd.status, 200, JSON.stringify(upd.data));

  assert.equal(await hitungMutasi(env, await sesiId(env, HARI_INI), 'transaksi'), 0,
    'tidak boleh ada mutasi transaksi yang bocor ke sesi hari ini');
  assert.equal(await hitungMutasi(env, await sesiId(env, HARI_INI), 'reversal'), 0,
    'tidak boleh ada reversal yang bocor ke sesi hari ini');
  assert.ok(await hitungMutasi(env, await sesiId(env, KEMARIN), 'transaksi') >= 2,
    'mutasi tetap tercatat di sesi kemarin');
});

test('hapus transaksi kemarin: reversal tetap di sesi kemarin', async () => {
  const { env, token, produkId, adminId } = await bootstrap();
  await sisipSesi(env, adminId, KEMARIN, 'buka', 500000);
  await buka(env, token, 100000);

  const create = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { items: item(produkId), metode_bayar: 'tunai', tanggal_transaksi: KEMARIN },
  });
  assert.equal(create.status, 200, JSON.stringify(create.data));

  const del = await call(env, `/api/transaksi/${create.data.id}`, {
    method: 'DELETE', token, body: { deleted_reason: 'salah input' },
  });
  assert.equal(del.status, 200, JSON.stringify(del.data));

  assert.equal(await hitungMutasi(env, await sesiId(env, HARI_INI), 'reversal'), 0,
    'reversal tidak boleh masuk sesi hari ini');
  assert.ok(await hitungMutasi(env, await sesiId(env, KEMARIN), 'reversal') >= 2,
    'reversal masuk sesi kemarin');
});

test('sesi yang sudah ditutup: edit ditolak dengan pesan yang menyebut tanggal', async () => {
  const { env, token, produkId, adminId } = await bootstrap();
  await sisipSesi(env, adminId, KEMARIN, 'tutup', 500000);

  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { items: item(produkId), metode_bayar: 'tunai', tanggal_transaksi: KEMARIN },
  });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'session_closed');
  assert.match(r.data.error.message, new RegExp(KEMARIN));
});
