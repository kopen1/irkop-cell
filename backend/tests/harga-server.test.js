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
  assert.equal(naik.biaya, 500, 'Indosat biaya fisik 500');
  assert.equal(naik.harga_server_efektif, 18000);
  assert.equal(naik.selisih, 3000); // (17500 + 500) - 15000
});

test('perbandingan: biaya fisik beda per operator (Telkomsel 800, Three 600)', async () => {
  const { env, token } = await bootstrap();
  await seedProduk(env, { kode: 'Vs6', nama: 'Telkomsel', harga: 60000, harga_modal: 40000 });
  await seedProduk(env, { kode: 'Vt8', nama: 'Three', harga: 50000, harga_modal: 30000 });
  await call(env, '/api/harga-server', {
    method: 'POST', token,
    body: { items: [
      { kode: 'Vs6', nama: 'Telkomsel', kategori: 'cetak_voucher', harga: 50000 },
      { kode: 'Vt8', nama: 'Three', kategori: 'cetak_voucher', harga: 40000 },
    ] },
  });
  const r = await call(env, '/api/harga-server/perbandingan', { token });
  const vs = r.data.items.find((x) => x.kode_produk === 'Vs6');
  const vt = r.data.items.find((x) => x.kode_produk === 'Vt8');
  assert.equal(vs.biaya, 800);
  assert.equal(vs.harga_server_efektif, 50800);
  assert.equal(vt.biaya, 600);
  assert.equal(vt.harga_server_efektif, 40600);
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
  assert.equal(row.harga_modal, 18000); // 17500 (server) + 500 (biaya fisik Indosat)
  assert.equal(row.harga, 21000); // margin lama 3000 dipertahankan → 18000 + 3000
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

test('link harga server ke produk lokal (kode beda) + update-modal', async () => {
  const { env, token } = await bootstrap();
  await seedProduk(env, { kode: 'Vi7', nama: 'Indosat 7GB 28 Hari', harga: 35000, harga_modal: 32000 });
  await call(env, '/api/harga-server', {
    method: 'POST', token,
    body: { items: [{ kode: 'Vindosat7', nama: 'Freedom Internet 7GB 28Hari', kategori: 'cetak_voucher', operator: 'indosat', harga: 32500 }] },
  });
  const list = await call(env, '/api/harga-server', { token });
  const hs = list.data.items.find((x) => x.kode_produk === 'Vindosat7');

  const link = await call(env, '/api/harga-server/link', { method: 'POST', token, body: { id: hs.id, kode_lokal: 'Vi7' } });
  assert.equal(link.status, 200, JSON.stringify(link.data));

  const cmp = await call(env, '/api/harga-server/perbandingan', { token });
  const row = cmp.data.items.find((x) => x.kode_produk === 'Vindosat7');
  assert.equal(Number(row.modal_daftar), 32000, 'kena produk lokal Vi7');
  assert.equal(row.status, 'naik'); // (32500 + 500) - 32000

  const up = await call(env, '/api/harga-server/update-modal', { method: 'POST', token, body: { kode: 'Vindosat7' } });
  assert.equal(up.data.updated_count, 1);
  const p = await env.DB.prepare("SELECT harga_modal FROM produk WHERE kode = 'Vi7'").first();
  assert.equal(Number(p.harga_modal), 33000, 'modal Vi7 = 32500 + 500');
});

test('auto-link cocokkan server ke produk (operator+GB+hari)', async () => {
  const { env, token } = await bootstrap();
  await seedProduk(env, { kode: 'Vi7', nama: 'Indosat 7GB 28 Hari', harga: 35000, harga_modal: 32000 });
  await call(env, '/api/harga-server', {
    method: 'POST', token,
    body: { items: [{ kode: 'Vindosat7', nama: 'Freedom Internet 7GB 28Hari', kategori: 'cetak_voucher', operator: 'indosat', harga: 32500 }] },
  });
  const r = await call(env, '/api/harga-server/auto-link', { method: 'POST', token, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.linked, 1);
  const hs = await env.DB.prepare("SELECT kode_lokal FROM harga_server WHERE kode_produk = 'Vindosat7'").first();
  assert.equal(hs.kode_lokal, 'Vi7');
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

test('update-modal: harga jual di BAWAH modal setelah terapkan -> masuk perlu_perhatian', async () => {
  const { env, token } = await bootstrap();
  // Modal lama 15.000, harga jual 15.500 (margin 500) — tipis.
  await seedProduk(env, { kode: 'Vi2001', nama: 'Indosat 2GB 1Hari', harga: 15500, harga_modal: 15000 });
  await call(env, '/api/harga-server', {
    method: 'POST', token,
    body: { items: [{ kode: 'Vi2001', nama: 'Indosat 2GB 1Hari', kategori: 'cetak_voucher', harga: 15900 }] },
  });

  const r = await call(env, '/api/harga-server/update-modal', { method: 'POST', token, body: { kode: 'Vi2001' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.updated_count, 1);

  // Modal naik ke 16.400, margin 500 dipertahankan → harga jual 16.900 (masih untung).
  assert.equal(r.data.perlu_perhatian_count, 0, 'margin positif tidak perlu perhatian');

  const row = await env.DB.prepare('SELECT harga_modal, harga FROM produk WHERE kode = ?').bind('Vi2001').first();
  assert.equal(row.harga_modal, 16400);
  assert.equal(row.harga, 16900);
  assert.ok(row.harga > row.harga_modal, 'harga jual harus di atas modal');
});

test('update-modal: produk RUGI (harga jual <= modal) dilaporkan di perlu_perhatian', async () => {
  const { env, token } = await bootstrap();
  // Modal lama 15.000 tapi harga jual 14.000 → sudah rugi sejak awal.
  await seedProduk(env, { kode: 'Vi2002', nama: 'Indosat 2GB 2Hari', harga: 14000, harga_modal: 15000 });
  await call(env, '/api/harga-server', {
    method: 'POST', token,
    body: { items: [{ kode: 'Vi2002', nama: 'Indosat 2GB 2Hari', kategori: 'cetak_voucher', harga: 15000 }] },
  });

  const r = await call(env, '/api/harga-server/update-modal', { method: 'POST', token, body: { kode: 'Vi2002' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.updated_count, 1);
  assert.equal(r.data.perlu_perhatian_count, 1, 'harus dilaporkan perlu perhatian');

  const p = r.data.perlu_perhatian[0];
  assert.equal(p.nama, 'Indosat 2GB 2Hari');
  assert.ok(p.harga_jual <= p.modal_baru, 'harga jual harus <= modal');
  assert.ok(p.margin < 0, 'margin harus negatif');
});
