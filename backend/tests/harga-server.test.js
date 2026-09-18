import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, createKategoriRaw, createProdukRaw } from './helpers.js';

async function bootstrap() {
  const { env } = setupEnv();
  const adminId = await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  return { env, adminId, token };
}

async function seedProduk(env, { kode, nama, harga, harga_modal }) {
  const katId = await createKategoriRaw(env, `Kat-${kode}`, 0);
  return createProdukRaw(env, { kode, nama, kategori_id: katId, harga, harga_modal, stok: 0 });
}

test('POST /api/harga-server import membuat baris harga server', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/harga-server', {
    method: 'POST',
    token,
    body: {
      items: [
        { kode: 'Vi1005', nama: 'Indosat 10GB 5Hari', kategori: 'cetak_voucher', operator: 'indosat', harga: 17500 },
        { kode: 'pi10', nama: 'Pulsa Indosat 10k', kategori: 'pulsa', operator: 'indosat', harga: 9750 },
      ],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.imported, 2);
  assert.equal(r.data.updated, 0);

  const list = await call(env, '/api/harga-server', { token });
  assert.equal(list.data.items.length, 2);
});

test('GET /api/harga-server/perbandingan: status naik / sama / baru', async () => {
  const { env, token } = await bootstrap();
  // Produk: modal 15000, jual 18000 (margin 3000)
  await seedProduk(env, { kode: 'Vi1005', nama: 'Indosat 10GB 5Hari', harga: 18000, harga_modal: 15000 });
  // Produk dengan modal sama
  await seedProduk(env, { kode: 'pi10', nama: 'Pulsa Indosat 10k', harga: 12000, harga_modal: 9750 });

  await call(env, '/api/harga-server', {
    method: 'POST',
    token,
    body: {
      items: [
        { kode: 'Vi1005', nama: 'Indosat 10GB 5Hari', kategori: 'cetak_voucher', harga: 17500 }, // naik +2500
        { kode: 'pi10', nama: 'Pulsa Indosat 10k', kategori: 'pulsa', harga: 9750 }, // sama
        { kode: 'baru1', nama: 'Produk Baru', kategori: 'pulsa', harga: 5000 }, // baru
      ],
    },
  });

  const r = await call(env, '/api/harga-server/perbandingan', { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.summary.naik, 1);
  assert.equal(r.data.summary.sama, 1);
  assert.equal(r.data.summary.baru, 1);

  const naik = r.data.items.find((x) => x.kode_produk === 'Vi1005');
  assert.equal(naik.status, 'naik');
  assert.equal(naik.selisih, 2500);
});

test('POST /api/harga-server/update-modal: modal berubah, margin jual dipertahankan', async () => {
  const { env, token } = await bootstrap();
  const produkId = await seedProduk(env, { kode: 'Vi1005', nama: 'Indosat 10GB 5Hari', harga: 18000, harga_modal: 15000 });

  await call(env, '/api/harga-server', {
    method: 'POST',
    token,
    body: { items: [{ kode: 'Vi1005', nama: 'Indosat 10GB 5Hari', kategori: 'cetak_voucher', harga: 17500 }] },
  });

  const r = await call(env, '/api/harga-server/update-modal', {
    method: 'POST',
    token,
    body: { kode: 'Vi1005' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.updated_count, 1);

  const row = await env.DB.prepare('SELECT harga_modal, harga FROM produk WHERE id = ?').bind(produkId).first();
  assert.equal(row.harga_modal, 17500); // modal ikut server
  assert.equal(row.harga, 20500); // margin lama 3000 dipertahankan → 17500 + 3000
});

test('POST /api/harga-server/update-modal all_naik: hanya update yang naik', async () => {
  const { env, token } = await bootstrap();
  await seedProduk(env, { kode: 'A1', nama: 'Naik', harga: 20000, harga_modal: 15000 });
  await seedProduk(env, { kode: 'A2', nama: 'Turun', harga: 12000, harga_modal: 10000 });

  await call(env, '/api/harga-server', {
    method: 'POST',
    token,
    body: {
      items: [
        { kode: 'A1', nama: 'Naik', kategori: 'cetak_voucher', harga: 17000 }, // naik
        { kode: 'A2', nama: 'Turun', kategori: 'cetak_voucher', harga: 8000 }, // turun
      ],
    },
  });

  const r = await call(env, '/api/harga-server/update-modal', {
    method: 'POST',
    token,
    body: { all_naik: true },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.updated_count, 1);
  assert.equal(r.data.updated[0].kode, 'A1');

  const a2 = await env.DB.prepare('SELECT harga_modal FROM produk WHERE kode = ?').bind('A2').first();
  assert.equal(a2.harga_modal, 10000); // tidak berubah
});

test('POST /api/harga-server/update-modal: kode tanpa produk dilewati', async () => {
  const { env, token } = await bootstrap();
  await call(env, '/api/harga-server', {
    method: 'POST',
    token,
    body: { items: [{ kode: 'X9', nama: 'Tidak Ada', kategori: 'pulsa', harga: 5000 }] },
  });

  const r = await call(env, '/api/harga-server/update-modal', {
    method: 'POST',
    token,
    body: { kode: 'X9' },
  });
  assert.equal(r.data.updated_count, 0);
  assert.equal(r.data.skipped_count, 1);
});
