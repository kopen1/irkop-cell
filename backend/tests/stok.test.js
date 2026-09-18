import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, createKategoriRaw, createProdukRaw } from './helpers.js';

function wibNow() { return new Date(new Date().getTime() + 7 * 3600 * 1000); }
function currentBulan() {
  const d = wibNow();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function bootstrap() {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 0 }, { nama_akun: 'SeaBank', saldo: 0 }, { nama_akun: 'OrderKuota', saldo: 0 }] },
  });
  const kat = await createKategoriRaw(env, 'Aksesoris', 1);
  return { env, token, kat };
}

async function stok(env, produkId) {
  const r = await env.DB.prepare('SELECT stok, harga_modal FROM produk WHERE id = ?').bind(produkId).first();
  return { stok: Number(r.stok), modal: Number(r.harga_modal) };
}
async function sumMutasi(env, akun) {
  const r = await env.DB.prepare('SELECT COALESCE(SUM(jumlah),0) AS n FROM mutasi_saldo WHERE nama_akun = ?').bind(akun).first();
  return Number(r.n);
}

test('auto-kurang stok saat penjualan fisik, kembali saat dihapus', async () => {
  const { env, token, kat } = await bootstrap();
  const prod = await createProdukRaw(env, { kode: 'AC-1', nama: 'Kabel', kategori_id: kat, harga: 20000, harga_modal: 10000, stok: 10 });

  const r = await call(env, '/api/transaksi', {
    method: 'POST', token, body: { items: [{ produk_id: prod, qty: 3 }], metode_bayar: 'tunai' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await stok(env, prod)).stok, 7, 'stok 10 - 3 = 7');

  const del = await call(env, `/api/transaksi/${r.data.id}`, { method: 'DELETE', token });
  assert.equal(del.status, 200);
  assert.equal((await stok(env, prod)).stok, 10, 'stok kembali setelah hapus');
});

test('produk digital tidak menyentuh stok fisik', async () => {
  const { env, token, kat } = await bootstrap();
  const prod = await createProdukRaw(env, { kode: 'V-1', nama: 'Voucher', kategori_id: kat, harga: 11000, harga_modal: 10000, stok: 5 });

  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: {
      jenis: 'produkdigital',
      items: [{ produk_id: prod, qty: 1, harga_jual: 11000, harga_modal: 10000, admin_fee: 1000 }],
      metode_bayar: 'tunai', akun_sumber: 'OrderKuota', admin_fee: 1000,
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await stok(env, prod)).stok, 5, 'stok fisik tidak berubah untuk produk digital');
});

test('beli stok: akun sumber turun, stok naik, modal update, hapus = reversal', async () => {
  const { env, token, kat } = await bootstrap();
  const prod = await createProdukRaw(env, { kode: 'V-2', nama: 'Voucher X', kategori_id: kat, harga: 13000, harga_modal: 10000, stok: 0 });

  const r = await call(env, '/api/pembelian-stok', {
    method: 'POST', token,
    body: { akun_sumber: 'OrderKuota', items: [{ produk_id: prod, qty: 6, harga_modal_satuan: 12000 }] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await stok(env, prod)).stok, 6, 'stok 0 + 6');
  assert.equal((await stok(env, prod)).modal, 12000, 'harga_modal di-update');
  assert.equal(await sumMutasi(env, 'OrderKuota'), -72000, 'OrderKuota -72.000');

  const del = await call(env, `/api/pembelian-stok/${r.data.id}`, { method: 'DELETE', token });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal((await stok(env, prod)).stok, 0, 'stok balik');
  assert.equal(await sumMutasi(env, 'OrderKuota'), 0, 'akun balik');
});

test('nilai stok: total modal & jual sesuai stok', async () => {
  const { env, token, kat } = await bootstrap();
  await createProdukRaw(env, { kode: 'AC-N1', nama: 'Charger', kategori_id: kat, harga: 25000, harga_modal: 15000, stok: 4 });
  await createProdukRaw(env, { kode: 'AC-N2', nama: 'Anti Gores', kategori_id: kat, harga: 10000, harga_modal: 4000, stok: 10 });

  const r = await call(env, '/api/laporan/nilai-stok', { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.total.nilai_modal, 4 * 15000 + 10 * 4000, 'total modal');
  assert.equal(r.data.total.nilai_jual, 4 * 25000 + 10 * 10000, 'total jual');
  assert.equal(r.data.total.potensi_laba, r.data.total.nilai_jual - r.data.total.nilai_modal);
});

test('rekonsiliasi: jual fisik + beli stok tetap balance (selisih 0, aman)', async () => {
  const { env, token, kat } = await bootstrap();
  const prod = await createProdukRaw(env, { kode: 'AC-R1', nama: 'Headset', kategori_id: kat, harga: 25000, harga_modal: 15000, stok: 10 });

  await call(env, '/api/transaksi', {
    method: 'POST', token, body: { items: [{ produk_id: prod, qty: 2 }], metode_bayar: 'tunai' },
  });
  await call(env, '/api/pembelian-stok', {
    method: 'POST', token, body: { akun_sumber: 'SeaBank', items: [{ produk_id: prod, qty: 5, harga_modal_satuan: 15000 }] },
  });

  const r = await call(env, `/api/laporan/rekonsiliasi?bulan=${currentBulan()}`, { token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.laba, 20000, 'laba 2 × (25k-15k)');
  assert.equal(r.data.cogs_stok_fisik, 30000, 'cogs 2 × 15k');
  assert.equal(r.data.pembelian_stok, 75000, 'beli 5 × 15k');
  assert.equal(r.data.delta_stok, 45000, 'delta stok = 75k - 30k');
  assert.equal(r.data.delta_uang_aktual, -25000, 'kas +50k, bank -75k');
  assert.equal(r.data.selisih, 0, 'rekonsiliasi balance');
  assert.equal(r.data.status, 'aman');
});
