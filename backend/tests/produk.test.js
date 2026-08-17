import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, createKategoriRaw, createProdukRaw } from './helpers.js';

async function bootstrap() {
  const { sqliteDb, env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const k1 = await createKategoriRaw(env, 'Fisik', 1);
  const k2 = await createKategoriRaw(env, 'Digital', 0);
  const p1 = await createProdukRaw(env, { kode: 'P-001', nama: 'Toner', kategori_id: k1, harga: 100000, stok: 50 });
  const p2 = await createProdukRaw(env, { kode: 'P-002', nama: 'Pulsa', kategori_id: k2, harga: 12000 });
  const p3 = await createProdukRaw(env, { kode: 'P-003', nama: 'Tanpa Kategori', kategori_id: null, harga: 5000 });
  const token = await login(env, 'admin', 'admin1234');
  return { env, token, k1, k2, p1, p2, p3 };
}

test('GET /produk: default mengembalikan semua produk + kategori_nama', async () => {
  const { env, token } = await bootstrap();
  const res = await call(env, '/api/produk', { token });
  assert.equal(res.status, 200);
  assert.equal(res.data.items.length, 3);
  const byKode = Object.fromEntries(res.data.items.map((p) => [p.kode, p]));
  assert.equal(byKode['P-001'].kategori_nama, 'Fisik');
  assert.equal(byKode['P-002'].kategori_nama, 'Digital');
  assert.equal(byKode['P-003'].kategori_id, null);
});

test('GET /produk?kategori_id: filter per kategori (backward compatible)', async () => {
  const { env, token, k1, k2 } = await bootstrap();

  const fisik = await call(env, `/api/produk?kategori_id=${k1}`, { token });
  assert.equal(fisik.status, 200);
  assert.deepEqual(fisik.data.items.map((p) => p.kode), ['P-001']);

  const digital = await call(env, `/api/produk?kategori_id=${k2}`, { token });
  assert.deepEqual(digital.data.items.map((p) => p.kode), ['P-002']);

  const takAda = await call(env, '/api/produk?kategori_id=999999', { token });
  assert.equal(takAda.status, 200);
  assert.equal(takAda.data.items.length, 0);

  const denganQ = await call(env, `/api/produk?kategori_id=${k1}&q=toner`, { token });
  assert.deepEqual(denganQ.data.items.map((p) => p.kode), ['P-001']);
});

test('GET /produk?q: pencarian kode/nama tetap jalan tanpa filter kategori', async () => {
  const { env, token } = await bootstrap();
  const res = await call(env, '/api/produk?q=P-00', { token });
  assert.equal(res.status, 200);
  assert.equal(res.data.items.length, 3);
  const kodes = res.data.items.map((p) => p.kode).sort();
  assert.deepEqual(kodes, ['P-001', 'P-002', 'P-003']);
});
