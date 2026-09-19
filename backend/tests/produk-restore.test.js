import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, createKategoriRaw, createProdukRaw } from './helpers.js';

async function bootstrap() {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  return { env, token };
}

test('create produk dengan kode yang sudah soft-deleted -> restore + update', async () => {
  const { env, token } = await bootstrap();
  const kat = await createKategoriRaw(env, 'Saldo', 0);
  const id = await createProdukRaw(env, { kode: 'D50', nama: 'Dana Lama', kategori_id: kat, harga: 50000, harga_modal: 48000, stok: 5 });

  const del = await call(env, `/api/produk/${id}`, { method: 'DELETE', token });
  assert.equal(del.status, 200);

  const list1 = await call(env, '/api/produk', { token });
  assert.ok(!list1.data.items.some((p) => p.kode === 'D50'), 'soft-deleted tidak tampil');

  const r = await call(env, '/api/produk', {
    method: 'POST', token,
    body: { kode: 'D50', nama: 'Dana Baru', kategori_id: kat, harga: 53000, harga_modal: 50000 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.restored, true);

  const list2 = await call(env, '/api/produk', { token });
  const row = list2.data.items.find((p) => p.kode === 'D50');
  assert.ok(row, 'produk kembali tampil setelah restore');
  assert.equal(row.nama, 'Dana Baru');
  assert.equal(Number(row.harga), 53000);
});

test('create produk dengan kode yang masih aktif -> tetap 409 duplikat', async () => {
  const { env, token } = await bootstrap();
  const kat = await createKategoriRaw(env, 'Saldo', 0);
  await createProdukRaw(env, { kode: 'D50', nama: 'Dana', kategori_id: kat, harga: 50000, harga_modal: 48000, stok: 0 });
  const r = await call(env, '/api/produk', { method: 'POST', token, body: { kode: 'D50', nama: 'X', kategori_id: kat, harga: 1 } });
  assert.equal(r.status, 409);
});
