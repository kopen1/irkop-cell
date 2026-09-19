import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, createKategoriRaw, createProdukRaw } from './helpers.js';

async function bootstrap() {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  await call(env, '/api/kasir/opening', {
    method: 'POST', token, body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 0 }] },
  });
  return { env, token };
}

async function stok(env, id) {
  const r = await env.DB.prepare('SELECT stok FROM produk WHERE id = ?').bind(id).first();
  return Number(r.stok);
}

test('service pakai sparepart: stok turun, modal & laba dari sparepart', async () => {
  const { env, token } = await bootstrap();
  const kat = await createKategoriRaw(env, 'Sparepart', 1);
  const part = await createProdukRaw(env, { kode: 'LCD1', nama: 'LCD', kategori_id: kat, harga: 0, harga_modal: 50000, stok: 5 });

  const r = await call(env, '/api/transaksi', {
    method: 'POST', token, headers: { 'Idempotency-Key': 'svc-part-1' },
    body: {
      jenis: 'service', metode_bayar: 'tunai', items: [],
      service: { nama_device: 'iPhone', deskripsi_kerusakan: 'LCD', biaya: 200000, parts: [{ produk_id: part, qty: 1 }] },
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  assert.equal(await stok(env, part), 4, 'stok sparepart 5 - 1 = 4');

  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  assert.equal(tx.data.laba, 150000, 'laba = 200k - 50k modal');

  const svc = await env.DB.prepare('SELECT harga_modal FROM service_hp ORDER BY id DESC LIMIT 1').first();
  assert.equal(Number(svc.harga_modal), 50000, 'modal service = modal sparepart');
});

test('service tanpa sparepart: modal manual dipakai, stok tidak tersentuh', async () => {
  const { env, token } = await bootstrap();
  const kat = await createKategoriRaw(env, 'Sparepart', 1);
  const part = await createProdukRaw(env, { kode: 'BAT1', nama: 'Baterai', kategori_id: kat, harga: 0, harga_modal: 30000, stok: 3 });

  const r = await call(env, '/api/transaksi', {
    method: 'POST', token, headers: { 'Idempotency-Key': 'svc-part-2' },
    body: {
      jenis: 'service', metode_bayar: 'tunai', items: [],
      service: { nama_device: 'Samsung', deskripsi_kerusakan: 'Baterai', biaya: 150000, harga_modal: 30000 },
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await stok(env, part), 3, 'stok tidak berubah tanpa parts');
});
