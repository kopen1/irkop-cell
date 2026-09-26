import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, createKategoriRaw, createProdukRaw } from './helpers.js';

async function bootstrap() {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  return { env, token };
}

test('GET /api/produk/:id mengembalikan satu produk + info kategori', async () => {
  const { env, token } = await bootstrap();
  const kat = await createKategoriRaw(env, 'Voucher', 1);
  const id = await createProdukRaw(env, { kode: 'VI7', nama: 'Indosat 7GB', kategori_id: kat, harga: 35000, harga_modal: 32000, stok: 4 });

  const r = await call(env, `/api/produk/${id}`, { token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.item.kode, 'VI7');
  assert.equal(r.data.item.nama, 'Indosat 7GB');
  assert.equal(r.data.item.kategori_nama, 'Voucher');
  assert.equal(r.data.item.kategori_lacak_stok, 1, 'flag lacak stok ikut untuk form produk');
});

test('GET /api/produk/:id 404 untuk id tidak ada / sudah soft-delete', async () => {
  const { env, token } = await bootstrap();
  const kat = await createKategoriRaw(env, 'Voucher', 1);
  const id = await createProdukRaw(env, { kode: 'VX7', nama: 'XL 7GB', kategori_id: kat, harga: 30000 });

  const missing = await call(env, '/api/produk/999999', { token });
  assert.equal(missing.status, 404);

  await call(env, `/api/produk/${id}`, { method: 'DELETE', token });
  const gone = await call(env, `/api/produk/${id}`, { token });
  assert.equal(gone.status, 404, 'produk soft-delete tidak boleh bisa diambil');
});

test('GET /api/produk/:id menolak id tidak valid', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/produk/abc', { token });
  assert.equal(r.status, 400);
});
