import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { setupEnv, createUserRaw, createKategoriRaw, createProdukRaw } from './helpers.js';

// BLOCKER-1 — kompatibilitas Pages Function proxy.
//
// Simulasi proxy: request di-rebuild dengan host domain Pages yang berbeda
// (https://app.irkop.pages.dev), lalu method/headers/body diteruskan persis
// seperti yang dikirim browser lewat frontend (src/lib/api.js):
//   - Accept: application/json
//   - Authorization: Bearer <token>
//   - Content-Type: application/json (saat ada body)
//   - Idempotency-Key (operasi finansial)
//
// Backend harus mem-proses berdasarkan pathname (/api/...) bukan host,
// sehingga host Pages Function yang berbeda tetap kompatibel.

async function bootstrap() {
  const { sqliteDb, env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const k1 = await createKategoriRaw(env, 'Fisik', 1);
  const p1 = await createProdukRaw(env, { kode: 'P-001', nama: 'Toner', kategori_id: k1, harga: 100000, harga_modal: 70000, stok: 50 });
  return { sqliteDb, env, p1 };
}

async function proxyFetch(env, path, { method = 'GET', token = null, body, rawBody, idempotencyKey, headers = {} } = {}) {
  const h = { Accept: 'application/json', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined || rawBody !== undefined) h['Content-Type'] = 'application/json';
  if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey;
  const payload = rawBody !== undefined ? rawBody : (body !== undefined ? JSON.stringify(body) : undefined);
  const req = new Request(`https://app.irkop.pages.dev${path}`, {
    method,
    headers: h,
    body: payload,
  });
  const res = await worker.fetch(req, env);
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  let data = null;
  try {
    data = isJson ? await res.json() : await res.text();
  } catch { /* non-JSON / kosong */ }
  return { status: res.status, isJson, contentType, data };
}

function assertErrorShape(r, status, code) {
  assert.equal(r.status, status);
  assert.ok(r.data && r.data.error, 'harus berbentuk {error:{code,message}}');
  assert.equal(r.data.error.code, code);
  assert.equal(typeof r.data.error.message, 'string');
}

async function login(env) {
  const r = await proxyFetch(env, '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } });
  assert.equal(r.status, 200);
  return r.data.token;
}

async function openKasir(env, token) {
  const r = await proxyFetch(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 500000 }] },
  });
  assert.equal(r.status, 200);
}

test('proxy: POST login & GET dengan Authorization melewati proxy', async () => {
  const { env } = await bootstrap();
  const token = await login(env);

  const cur = await proxyFetch(env, '/api/kasir/current', { token });
  assert.equal(cur.status, 200);
  assert.equal(cur.isJson, true);
  assert.equal(cur.data.status, 'belum_buka');
});

test('proxy: POST transaksi (body + Idempotency-Key) -> 1 mutasi, tidak diduplikasi', async () => {
  const { env, p1 } = await bootstrap();
  const token = await login(env);
  await openKasir(env, token);

  const r1 = await proxyFetch(env, '/api/transaksi', {
    method: 'POST', token, idempotencyKey: 'proxy-dup-001',
    body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'tunai' },
  });
  assert.equal(r1.status, 200);
  assert.equal(r1.isJson, true);
  assert.match(r1.data.id, /^TX-\d{8}-\d{3}$/);

  const r2 = await proxyFetch(env, '/api/transaksi', {
    method: 'POST', token, idempotencyKey: 'proxy-dup-001',
    body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'tunai' },
  });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.duplicate, true);

  const mut = await env.DB.prepare('SELECT COUNT(*) AS n FROM mutasi_saldo').all();
  assert.equal(mut.results[0].n, 2); // Tunai Laci + mutasi Laba (produk)
});

test('proxy: PUT /api/produk/:id (body) -> 200 JSON', async () => {
  const { env, p1 } = await bootstrap();
  const token = await login(env);
  const r = await proxyFetch(env, `/api/produk/${p1}`, {
    method: 'PUT', token, body: { nama: 'Toner X', harga: 110000 },
  });
  assert.equal(r.status, 200);
  assert.equal(r.isJson, true);
  const updated = await env.DB.prepare('SELECT nama, harga FROM produk WHERE id = ?').bind(p1).first();
  assert.equal(updated.nama, 'Toner X');
  assert.equal(updated.harga, 110000);
});

test('proxy: DELETE /api/transaksi/:id (dengan body) -> soft delete + reversal', async () => {
  const { env, p1 } = await bootstrap();
  const token = await login(env);
  await openKasir(env, token);

  const tx = await proxyFetch(env, '/api/transaksi', {
    method: 'POST', token,
    body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'tunai' },
  });
  const txId = tx.data.id;

  const del = await proxyFetch(env, `/api/transaksi/${txId}`, {
    method: 'DELETE', token, body: { deleted_reason: 'salah catat' },
  });
  assert.equal(del.status, 200);
  assert.equal(del.data.status, 'soft_deleted');

  const cur = await proxyFetch(env, '/api/kasir/current', { token });
  const tunai = cur.data.saldo.find((s) => s.nama_akun === 'Tunai Laci');
  assert.equal(tunai.saldo_sistem, 500000);
});

test('proxy: error shape konsisten ({error:{code,message}}) untuk 401, 400, 404', async () => {
  const { env, p1 } = await bootstrap();
  const token = await login(env);

  const noAuth = await proxyFetch(env, '/api/kasir/current');
  assertErrorShape(noAuth, 401, 'unauthorized');

  const badJson = await proxyFetch(env, '/api/auth/login', {
    method: 'POST', rawBody: '{invalid json',
  });
  assertErrorShape(badJson, 400, 'invalid_json');

  const patch = await proxyFetch(env, `/api/transaksi/${p1}`, { method: 'PATCH', token });
  assertErrorShape(patch, 404, 'not_found');
});

test('proxy: GET laporan/export -> non-JSON text/csv + content-disposition diteruskan', async () => {
  const { env, p1 } = await bootstrap();
  const token = await login(env);
  await openKasir(env, token);
  await proxyFetch(env, '/api/transaksi', {
    method: 'POST', token,
    body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'tunai' },
  });

  const r = await proxyFetch(env, '/api/laporan/export?cakupan=bulan', { token });
  assert.equal(r.status, 200);
  assert.equal(r.isJson, false);
  assert.match(r.contentType, /text\/csv/);
  assert.match(r.data, /TRANSAKSI/);
});
