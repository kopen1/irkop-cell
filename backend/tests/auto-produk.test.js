import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, createKategoriRaw, createProdukRaw } from './helpers.js';
import { adminFee } from '../src/financial/autoProduk.js';

test('adminFee sesuai aturan provider & nominal', () => {
  assert.equal(adminFee('Dana', 10000), 2000);
  assert.equal(adminFee('Dana', 30000), 2000);
  assert.equal(adminFee('Dana', 50000), 3000);
  assert.equal(adminFee('Dana', 95000), 5000);
  assert.equal(adminFee('Dana', 295000), 5000);
  assert.equal(adminFee('Gopay', 50000), 3000);
  assert.equal(adminFee('Ovo', 94000), 3000);
  assert.equal(adminFee('Bank', 100000), 5000);
  assert.equal(adminFee('Bank', 1000000), 10000);
  assert.equal(adminFee('Bank', 2000000), 10000);
  assert.equal(adminFee('Bank', 3000000), 15000);
});

async function bootstrap() {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  await call(env, '/api/kasir/opening', {
    method: 'POST', token, body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 0 }, { nama_akun: 'OrderKuota', saldo: 10000000 }] },
  });
  const kat = await createKategoriRaw(env, 'Saldo', 0);
  const dana = await createProdukRaw(env, { kode: 'DanaG', nama: 'Dana', kategori_id: kat, harga: 1, harga_modal: 0 });
  return { env, token, dana };
}

test('scan otomatis: DANA 295k muncul >=10x -> produk D295 dibuat (admin 5k)', async () => {
  const { env, token, dana } = await bootstrap();
  for (let i = 0; i < 10; i += 1) {
    const r = await call(env, '/api/transaksi', {
      method: 'POST', token, headers: { 'Idempotency-Key': `ap-d-${i}` },
      body: {
        jenis: 'produkdigital',
        items: [{ produk_id: dana, qty: 1, harga_jual: 300000, harga_modal: 295000, admin_fee: 5000 }],
        metode_bayar: 'tunai', akun_sumber: 'OrderKuota', admin_fee: 5000,
      },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }

  const scan = await call(env, '/api/produk/scan-otomatis', { method: 'POST', token, body: {} });
  assert.equal(scan.status, 200, JSON.stringify(scan.data));

  const d = await env.DB.prepare("SELECT * FROM produk WHERE kode = 'D295'").first();
  assert.ok(d, 'produk D295 dibuat');
  assert.equal(Number(d.harga_modal), 295000);
  assert.equal(Number(d.harga), 300000);
  assert.equal(d.nama, 'Dana 295k');
});

test('scan otomatis: transfer Bank 100k -> produk B100 (admin 5k); <3x tidak dibuat', async () => {
  const { env, token } = await bootstrap();
  for (let i = 0; i < 10; i += 1) {
    const r = await call(env, '/api/transaksi', {
      method: 'POST', token, headers: { 'Idempotency-Key': `ap-t-${i}` },
      body: { jenis: 'transfer', nominal: 100000, mitra: 'SeaBank', admin: 0 },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  // nominal jarang (2x, <3) tidak boleh dibuat
  for (let i = 0; i < 2; i += 1) {
    await call(env, '/api/transaksi', {
      method: 'POST', token, headers: { 'Idempotency-Key': `ap-rare-${i}` },
      body: { jenis: 'transfer', nominal: 777000, mitra: 'SeaBank', admin: 0 },
    });
  }

  await call(env, '/api/produk/scan-otomatis', { method: 'POST', token, body: {} });

  const b = await env.DB.prepare("SELECT * FROM produk WHERE kode = 'B100'").first();
  assert.ok(b, 'produk B100 dibuat');
  assert.equal(Number(b.harga_modal), 100000);
  assert.equal(Number(b.harga), 105000);

  const rare = await env.DB.prepare("SELECT * FROM produk WHERE kode = 'B777'").first();
  assert.equal(rare, null, 'nominal jarang (<3) tidak dibuat');
});

test('scan otomatis memakai setting min_count & mengenali produk Bank', async () => {
  const { env, token } = await bootstrap();
  const kat = await env.DB.prepare("SELECT id FROM kategori_produk WHERE nama = 'Saldo'").first();
  const dana = await env.DB.prepare("SELECT id FROM produk WHERE kode = 'DanaG'").first();
  const bank = await createProdukRaw(env, {
    kode: 'BankG', nama: 'Bank 100k', kategori_id: kat.id, harga: 105000, harga_modal: 100000,
  });

  // Masing-masing hanya 1x: dengan setting min_count=1 harus tetap dibuat.
  const d = await call(env, '/api/transaksi', {
    method: 'POST', token, headers: { 'Idempotency-Key': 'cfg-d' },
    body: {
      jenis: 'produkdigital',
      items: [{ produk_id: dana.id, qty: 1, harga_jual: 300000, harga_modal: 295000, admin_fee: 5000 }],
      metode_bayar: 'tunai', akun_sumber: 'OrderKuota', admin_fee: 5000,
    },
  });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  const b = await call(env, '/api/transaksi', {
    method: 'POST', token, headers: { 'Idempotency-Key': 'cfg-b' },
    body: {
      jenis: 'produkdigital',
      items: [{ produk_id: bank, qty: 1, harga_jual: 105000, harga_modal: 100000, admin_fee: 5000 }],
      metode_bayar: 'tunai', akun_sumber: 'OrderKuota', admin_fee: 5000,
    },
  });
  assert.equal(b.status, 200, JSON.stringify(b.data));

  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('auto_produk_min_count', '1', ?) " +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(new Date().toISOString()).run();

  const scan = await call(env, '/api/produk/scan-otomatis', { method: 'POST', token, body: {} });
  assert.equal(scan.status, 200, JSON.stringify(scan.data));
  assert.equal(scan.data.min_count, 1, 'setting min_count dipakai engine');

  const d295 = await env.DB.prepare("SELECT * FROM produk WHERE kode = 'D295'").first();
  assert.ok(d295, 'D295 dibuat dari 1 transaksi (min_count=1)');
  const b100 = await env.DB.prepare("SELECT * FROM produk WHERE kode = 'B100'").first();
  assert.ok(b100, 'B100 dibuat dari penjualan Bank 100k');
  assert.equal(Number(b100.harga_modal), 100000);
  assert.equal(Number(b100.harga), 105000);
});

test('GET settings mengembalikan digital_bank_map sebagai object', async () => {
  const { env, token } = await bootstrap();
  const map = { pulsa: 'OrderKuota', dana: 'DANA', transfer: 'SeaBank' };
  const put = await call(env, '/api/settings', { method: 'PUT', token, body: { digital_bank_map: map } });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  const get = await call(env, '/api/settings', { token });
  assert.equal(typeof get.data.digital_bank_map, 'object');
  assert.deepEqual(get.data.digital_bank_map, map);
});
