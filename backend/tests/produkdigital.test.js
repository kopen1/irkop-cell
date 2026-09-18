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
