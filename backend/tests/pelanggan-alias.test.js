import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, createKategoriRaw, createProdukRaw } from './helpers.js';

async function bootstrap() {
  const { env } = setupEnv();
  const adminId = await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  return { env, adminId, token };
}

async function createPelanggan(env, token, nama) {
  const r = await call(env, '/api/pelanggan', { method: 'POST', token, body: { nama } });
  return r.data.id;
}

test('alias pelanggan: tambah, list di detail, update, hapus', async () => {
  const { env, token } = await bootstrap();
  const pid = await createPelanggan(env, token, 'Budi');

  const add = await call(env, `/api/pelanggan/${pid}/alias`, {
    method: 'POST', token, body: { tipe: 'no_rekening', nilai: '1234567890' },
  });
  assert.equal(add.status, 200);
  assert.ok(add.data.id);

  let detail = await call(env, `/api/pelanggan/${pid}`, { token });
  assert.equal(detail.status, 200);
  const alias = detail.data.alias.find((a) => a.id === add.data.id);
  assert.equal(alias.tipe, 'no_rekening');
  assert.equal(alias.nilai, '1234567890');

  const upd = await call(env, `/api/pelanggan/alias/${add.data.id}`, {
    method: 'PUT', token, body: { nilai: '9999999999' },
  });
  assert.equal(upd.status, 200);
  assert.equal(upd.data.nilai, '9999999999');

  detail = await call(env, `/api/pelanggan/${pid}`, { token });
  assert.equal(detail.data.alias.find((a) => a.id === add.data.id).nilai, '9999999999');

  const del = await call(env, `/api/pelanggan/alias/${add.data.id}`, { method: 'DELETE', token });
  assert.equal(del.status, 200);

  detail = await call(env, `/api/pelanggan/${pid}`, { token });
  assert.equal(detail.data.alias.find((a) => a.id === add.data.id), undefined);
});

test('merge pelanggan: nomor HP & alias sumber ikut pindah ke tujuan', async () => {
  const { env, token } = await bootstrap();
  const sumber = (await call(env, '/api/pelanggan', {
    method: 'POST', token, body: { nama: 'Iqbal', telepon: '08123456789' },
  })).data.id;
  const tujuan = (await call(env, '/api/pelanggan', {
    method: 'POST', token, body: { nama: 'Bri', telepon: '123456789' },
  })).data.id;

  await call(env, `/api/pelanggan/${sumber}/alias`, {
    method: 'POST', token, body: { tipe: 'no_rekening', nilai: '99887766' },
  });

  const r = await call(env, '/api/pelanggan/merge', {
    method: 'POST', token, body: { id_gabung: sumber, id_utama: tujuan },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  const detail = (await call(env, `/api/pelanggan/${tujuan}`, { token })).data;
  const alias = detail.alias.map((a) => `${a.tipe}:${a.nilai}`);

  assert.ok(
    alias.includes('nama:Iqbal — 08123456789'),
    `nama & nomor sumber harus jadi satu alias, dapat: ${alias.join(', ')}`
  );
  assert.ok(alias.includes('no_rekening:99887766'), `alias no_rekening sumber harus ikut, dapat: ${alias.join(', ')}`);
  assert.ok(
    !alias.some((x) => x.startsWith('no_hp:08123456789')),
    `nomor sumber tidak boleh jadi alias terpisah, dapat: ${alias.join(', ')}`
  );

  // Alias sumber tidak boleh tertinggal (yatim) di record yang sudah di-merge.
  const sisa = await env.DB.prepare('SELECT COUNT(*) AS n FROM pelanggan_alias WHERE pelanggan_id = ?').bind(sumber).first();
  assert.equal(Number(sisa.n), 0, 'alias pelanggan sumber harus dipindah, bukan disalin');
});

test('list/detail pelanggan: total belanja & frekuensi mengikuti transaksi', async () => {
  const { env, token } = await bootstrap();
  const pid = await createPelanggan(env, token, 'Iqbal');
  await call(env, '/api/kasir/opening', {
    method: 'POST', token, body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 0 }] },
  });
  const kat = await createKategoriRaw(env, 'Aksesoris', 1);
  const prod = await createProdukRaw(env, { kode: 'AK1', nama: 'Anti Gores', kategori_id: kat, harga: 15000, harga_modal: 5000 });

  const tx = await call(env, '/api/transaksi', {
    method: 'POST', token, headers: { 'Idempotency-Key': 'plg-stat-1' },
    body: { items: [{ produk_id: prod, qty: 1 }], metode_bayar: 'tunai', pelanggan_id: pid },
  });
  assert.equal(tx.status, 200, JSON.stringify(tx.data));

  const detail = (await call(env, `/api/pelanggan/${pid}`, { token })).data;
  assert.equal(Number(detail.frekuensi_transaksi), 1, 'detail frekuensi harus 1');
  assert.equal(Number(detail.total_belanja), 15000, 'detail total belanja harus 15.000');
  assert.equal(detail.riwayat_transaksi.length, 1, 'detail harus menampilkan riwayat transaksi');

  const list = (await call(env, '/api/pelanggan', { token })).data.items;
  const row = list.find((r) => r.id === pid);
  assert.equal(Number(row.frekuensi_transaksi), 1, 'list frekuensi harus 1');
  assert.equal(Number(row.total_belanja), 15000, 'list total belanja harus 15.000');
});

test('alias pelanggan: tipe tidak valid ditolak', async () => {
  const { env, token } = await bootstrap();
  const pid = await createPelanggan(env, token, 'Siti');
  const r = await call(env, `/api/pelanggan/${pid}/alias`, {
    method: 'POST', token, body: { tipe: 'email', nilai: 'x' },
  });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, 'invalid_value');
});

test('alias pelanggan: duplikat ditolak', async () => {
  const { env, token } = await bootstrap();
  const pid = await createPelanggan(env, token, 'Andi');
  await call(env, `/api/pelanggan/${pid}/alias`, { method: 'POST', token, body: { tipe: 'no_hp', nilai: '0812' } });
  const dup = await call(env, `/api/pelanggan/${pid}/alias`, { method: 'POST', token, body: { tipe: 'no_hp', nilai: '0812' } });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.error.code, 'duplicate_alias');
});

test('alias pelanggan: butuh permission pelanggan', async () => {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Kasir', username: 'kasir', password: 'kasir1234', role: 'karyawan' });
  const token = await login(env, 'kasir', 'kasir1234');
  const r = await call(env, '/api/pelanggan/1/alias', { method: 'POST', token, body: { tipe: 'nama', nilai: 'x' } });
  assert.equal(r.status, 403);
});
