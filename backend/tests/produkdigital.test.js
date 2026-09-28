import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, createKategoriRaw, createProdukRaw } from './helpers.js';

async function bootstrap() {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  return { env, token };
}

async function sumMutasi(env, namaAkun) {
  const r = await env.DB.prepare('SELECT COALESCE(SUM(jumlah),0) AS n FROM mutasi_saldo WHERE nama_akun = ?').bind(namaAkun).first();
  return Number(r.n);
}

test('produkdigital: akun sumber (saldo digital) BERKURANG sebesar modal', async () => {
  const { env, token } = await bootstrap();
  const kat = await createKategoriRaw(env, 'Saldo', 0);
  const prod = await createProdukRaw(env, { kode: 'D50', nama: 'Dana 50k', kategori_id: kat, harga: 55000, harga_modal: 50000 });

  await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 0 }, { nama_akun: 'OrderKuota', saldo: 1000000 }] },
  });

  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: {
      jenis: 'produkdigital',
      items: [{ produk_id: prod, qty: 1, harga_jual: 55000, harga_modal: 50000, admin_fee: 5000 }],
      metode_bayar: 'tunai',
      akun_sumber: 'OrderKuota',
      admin_fee: 5000,
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  assert.equal(await sumMutasi(env, 'OrderKuota'), -50000, 'OrderKuota harus -50.000 (modal)');
  assert.equal(await sumMutasi(env, 'Tunai Laci'), 55000, 'Tunai Laci harus +55.000 (pembayaran)');
  assert.equal(await sumMutasi(env, 'Laba'), 5000, 'Laba harus +5.000 (admin fee)');
});

test('produkdigital: modal dari form dipakai walau beda dengan harga_modal master', async () => {
  const { env, token } = await bootstrap();
  const kat = await createKategoriRaw(env, 'Saldo', 0);
  // Master modal 0 (produk generik "Dana"), tapi form mengisi modal 200.000
  const prod = await createProdukRaw(env, { kode: 'DGN', nama: 'Dana Generik', kategori_id: kat, harga: 1, harga_modal: 0 });

  await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 0 }, { nama_akun: 'OrderKuota', saldo: 1000000 }] },
  });

  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: {
      jenis: 'produkdigital',
      items: [{ produk_id: prod, qty: 1, harga_jual: 205000, harga_modal: 200000, admin_fee: 5000 }],
      metode_bayar: 'tunai',
      akun_sumber: 'OrderKuota',
      admin_fee: 5000,
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  assert.equal(await sumMutasi(env, 'OrderKuota'), -200000, 'OrderKuota harus -200.000 (modal dari form, bukan master 0)');
  assert.equal(await sumMutasi(env, 'Tunai Laci'), 205000, 'Tunai Laci harus +205.000 (harga jual)');
  assert.equal(await sumMutasi(env, 'Laba'), 5000, 'Laba harus +5.000 (admin fee)');
});

test('produkdigital: laba admin_fee DIKALI qty (regresi qty > 1)', async () => {
  const { env, token } = await bootstrap();
  const kat = await createKategoriRaw(env, 'Saldo', 0);
  const prod = await createProdukRaw(env, { kode: 'D200', nama: 'Dana 200k', kategori_id: kat, harga: 205000, harga_modal: 200000 });

  await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 0 }, { nama_akun: 'OrderKuota', saldo: 5000000 }] },
  });

  // admin_fee 5.000 per-unit, qty 2 → laba harus 10.000 (bukan 5.000).
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: {
      jenis: 'produkdigital',
      items: [{ produk_id: prod, qty: 2, harga_jual: 205000, harga_modal: 200000, admin_fee: 5000 }],
      metode_bayar: 'tunai',
      akun_sumber: 'OrderKuota',
      admin_fee: 5000,
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  assert.equal(r.data.total, 410000, 'total harus 2 x 205.000');
  assert.equal(await sumMutasi(env, 'OrderKuota'), -400000, 'OrderKuota harus -400.000 (2 x modal)');
  assert.equal(await sumMutasi(env, 'Tunai Laci'), 410000, 'Tunai Laci harus +410.000 (2 x harga jual)');
  assert.equal(await sumMutasi(env, 'Laba'), 10000, 'akun Laba harus +10.000');
});

test('produkdigital: qty 3 → laba 3 x admin_fee, rekening dan laba tetap sinkron', async () => {
  const { env, token } = await bootstrap();
  const kat = await createKategoriRaw(env, 'Saldo', 0);
  const prod = await createProdukRaw(env, { kode: 'D100', nama: 'Dana 100k', kategori_id: kat, harga: 105000, harga_modal: 100000 });

  await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 0 }, { nama_akun: 'OrderKuota', saldo: 5000000 }] },
  });

  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: {
      jenis: 'produkdigital',
      items: [{ produk_id: prod, qty: 3, harga_jual: 105000, harga_modal: 100000, admin_fee: 5000 }],
      metode_bayar: 'tunai',
      akun_sumber: 'OrderKuota',
      admin_fee: 5000,
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  // Invariant: laba = total - modal yang dipotong = 3 x 5.000.
  assert.equal(await sumMutasi(env, 'Laba'), 15000, 'Laba harus 3 x 5.000 = 15.000');
  assert.equal(await sumMutasi(env, 'OrderKuota'), -300000, 'OrderKuota harus -300.000 (3 x modal)');
  assert.equal(await sumMutasi(env, 'Tunai Laci'), 315000, 'Tunai Laci harus +315.000 (3 x harga jual)');
});

test('tariktunai: admin_fee TIDAK dikali qty (per transaksi)', async () => {
  const { env, token } = await bootstrap();

  await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 0 }, { nama_akun: 'OrderKuota', saldo: 5000000 }] },
  });

  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: {
      jenis: 'tariktunai',
      admin_type: 'dalam',
      nominal: 100000,
      admin: 5000,
      mitra: 'OrderKuota',
      metode_pembayaran: 'Tunai Laci',
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // Tanpa filter jenis, laba tetap fee SEKALI (tidak ikut qty).
  assert.equal(await sumMutasi(env, 'Laba'), 5000, 'tarik tunai: laba = fee sekali = 5.000');
  assert.equal(await sumMutasi(env, 'Tunai Laci'), -95000, 'Tunai Laci keluar 95.000 (100.000 - fee)');
});

test('tanpa jenis produkdigital: akun sumber tidak disentuh (regresi)', async () => {
  const { env, token } = await bootstrap();
  const kat = await createKategoriRaw(env, 'Saldo', 0);
  const prod = await createProdukRaw(env, { kode: 'D50', nama: 'Dana 50k', kategori_id: kat, harga: 55000, harga_modal: 50000 });

  await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 0 }, { nama_akun: 'OrderKuota', saldo: 1000000 }] },
  });

  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { items: [{ produk_id: prod, qty: 1 }], metode_bayar: 'tunai', akun_sumber: 'OrderKuota' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await sumMutasi(env, 'OrderKuota'), 0, 'tanpa jenis produkdigital, akun sumber tidak berkurang');
});
