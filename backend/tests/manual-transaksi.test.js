import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, createKategoriRaw, createProdukRaw } from './helpers.js';

function wibNow() {
  return new Date(new Date().getTime() + 7 * 3600 * 1000);
}
function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function monthOf(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function currentBulan() {
  return monthOf(wibNow());
}
function prevBulan() {
  const d = wibNow();
  const pm = d.getUTCMonth() === 0 ? 11 : d.getUTCMonth() - 1;
  const py = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  return `${py}-${String(pm + 1).padStart(2, '0')}`;
}
function todayWib() {
  return ymd(wibNow());
}
function tomorrowWib() {
  return ymd(new Date(wibNow().getTime() + 24 * 3600 * 1000));
}

async function bootstrapManual() {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  const k1 = await createKategoriRaw(env, 'Fisik', 1);
  const p1 = await createProdukRaw(env, { kode: 'P-001', nama: 'Toner', kategori_id: k1, harga: 100000, harga_modal: 60000, stok: 50 });
  await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 500000 }] },
  });
  const pel = await call(env, '/api/pelanggan', { method: 'POST', token, body: { nama: 'Budi' } });
  return { env, token, p1, pel: pel.data.id };
}

test('Manual transaksi backdate: ID dari tanggal lampau + masuk laporan bulan tsb, bukan bulan sekarang', async () => {
  const { env, token, p1 } = await bootstrapManual();
  const day = `${prevBulan()}-15`;
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'tunai', manual_entry: true, tanggal_transaksi: day },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.id, `TX-${day.replace(/-/g, '')}-001`);

  const prevR = await call(env, `/api/laporan/bulan?bulan=${prevBulan()}`, { token });
  assert.equal(prevR.status, 200);
  assert.equal(prevR.data.jumlah_transaksi, 1);
  assert.equal(prevR.data.omzet, 100000);
  assert.equal(prevR.data.laba, 40000);

  const curR = await call(env, `/api/laporan/bulan?bulan=${currentBulan()}`, { token });
  assert.equal(curR.data.jumlah_transaksi, 0);

  const lst = await call(env, `/api/transaksi?date=${day}`, { token });
  assert.equal(lst.data.items.length, 1);
  assert.equal(lst.data.items[0].manual_entry, 1);
  assert.equal(lst.data.items[0].tanggal_transaksi, day);
});

test('Manual transaksi: tanggal_transaksi di masa depan ditolak', async () => {
  const { env, token, p1 } = await bootstrapManual();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'tunai', manual_entry: true, tanggal_transaksi: tomorrowWib() },
  });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, 'invalid_value');
});

test('PUT transaksi: pindah tanggal bisnis → ID baru & berpindah bulan laporan', async () => {
  const { env, token, p1 } = await bootstrapManual();
  const dayOld = `${prevBulan()}-15`;
  const created = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { items: [{ produk_id: p1, qty: 2 }], metode_bayar: 'tunai', manual_entry: true, tanggal_transaksi: dayOld },
  });
  assert.equal(created.data.id, `TX-${dayOld.replace(/-/g, '')}-001`);

  const updated = await call(env, `/api/transaksi/${created.data.id}`, {
    method: 'PUT', token,
    body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'tunai', tanggal_transaksi: todayWib() },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.id, `TX-${todayWib().replace(/-/g, '')}-001`);

  const prevR = await call(env, `/api/laporan/bulan?bulan=${prevBulan()}`, { token });
  assert.equal(prevR.data.jumlah_transaksi, 0);
  const curR = await call(env, `/api/laporan/bulan?bulan=${currentBulan()}`, { token });
  assert.equal(curR.data.jumlah_transaksi, 1);
});

test('Kasbon dari transaksi manual backdate: tanggal ikut tanggal_transaksi', async () => {
  const { env, token, p1, pel } = await bootstrapManual();
  const day = `${prevBulan()}-20`;
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'bon', pelanggan_id: pel, manual_entry: true, tanggal_transaksi: day },
  });
  assert.equal(r.status, 200);

  const kb = await call(env, '/api/kasbon', { token });
  assert.ok(kb.data.items.some((x) => x.tanggal === day), `kasbon harus bertanggal ${day}`);

  const prevR = await call(env, `/api/laporan/bulan?bulan=${prevBulan()}`, { token });
  assert.equal(prevR.data.kasbon.baru, 1);
  assert.equal(prevR.data.jumlah_transaksi, 1);
});