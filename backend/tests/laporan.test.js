import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { setupEnv, call, login, createUserRaw, createKategoriRaw, createProdukRaw } from './helpers.js';

function wibNow() {
  return new Date(new Date().getTime() + 7 * 3600 * 1000);
}
function currentBulan() {
  const d = wibNow();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function currentTahun() {
  return wibNow().getUTCFullYear();
}

async function bootstrapLaporan() {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  const k1 = await createKategoriRaw(env, 'Fisik', 1);
  const k2 = await createKategoriRaw(env, 'Pulsa & Saldo', 0);
  const p1 = await createProdukRaw(env, { kode: 'P-001', nama: 'Toner', kategori_id: k1, harga: 100000, harga_modal: 70000, stok: 50 });
  const p2 = await createProdukRaw(env, { kode: 'P-002', nama: 'Pulsa 10rb', kategori_id: k2, harga: 12000 });

  await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 500000 }, { nama_akun: 'SeaBank', saldo: 1000000 }] },
  });

  await call(env, '/api/transaksi', { method: 'POST', token, body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'tunai' } });
  await call(env, '/api/transaksi', { method: 'POST', token, body: { items: [{ produk_id: p2, qty: 2 }], metode_bayar: 'tunai' } });
  await call(env, '/api/pengeluaran', {
    method: 'POST', token,
    body: { deskripsi: 'Ongkir', nominal: 15000, metode_bayar: 'tunai', akun_sumber: 'Tunai Laci' },
  });

  const pel = await call(env, '/api/pelanggan', { method: 'POST', token, body: { nama: 'Budi' } });
  const kb1 = await call(env, '/api/kasbon', { method: 'POST', token, body: { pelanggan_id: pel.data.id, nominal: 50000 } });
  const kb2 = await call(env, '/api/kasbon', { method: 'POST', token, body: { pelanggan_id: pel.data.id, nominal: 30000 } });
  await call(env, `/api/kasbon/${kb2.data.id}`, { method: 'PUT', token, body: { status: 'lunas' } });

  return { env, token, k1, k2, p1, p2, kb1 };
}

test('Laporan Bulanan: omzet, laba, pengeluaran, net, kasbon, rekap kategori benar', async () => {
  const { env, token } = await bootstrapLaporan();
  const r = await call(env, `/api/laporan/bulan?bulan=${currentBulan()}`, { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.jumlah_transaksi, 2);
  assert.equal(r.data.omzet, 124000);
  assert.equal(r.data.laba, 54000);
  assert.equal(r.data.pengeluaran.total, 15000);
  assert.equal(r.data.net, 54000 - 15000);
  assert.equal(r.data.kasbon.baru, 2);
  assert.equal(r.data.kasbon.belum_lunas, 1);
  assert.equal(r.data.kasbon.nominal_belum_lunas, 50000);
  assert.ok(r.data.perbandingan_bulan_sebelumnya);

  const catMap = {};
  for (const c of r.data.rekap_kategori) catMap[c.nama_kategori] = c;
  assert.equal(catMap['Fisik'].omzet, 100000);
  assert.equal(catMap['Pulsa & Saldo'].omzet, 24000);
  assert.equal(catMap['Fisik'].qty, 1);
});

test('Laporan Tahunan: omzet + breakdown 12 bulan + ranking kategori', async () => {
  const { env, token } = await bootstrapLaporan();
  const r = await call(env, `/api/laporan/tahun?tahun=${currentTahun()}`, { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.omzet, 124000);
  assert.equal(r.data.jumlah_transaksi, 2);
  assert.equal(r.data.breakdown_12_bulan.length, 12);
  const month = Number(currentBulan().split('-')[1]) - 1;
  assert.equal(r.data.breakdown_12_bulan[month].omzet, 124000);
  assert.equal(r.data.ranking_kategori_terlaris[0].nama_kategori, 'Fisik');
});

test('Export laporan CSV bulanan: berisi header, transaksi, pengeluaran', async () => {
  const { env, token } = await bootstrapLaporan();
  const res = await worker.fetch(
    new Request(`https://irkop.local/api/laporan/export?cakupan=bulan&bulan=${currentBulan()}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    env
  );
  const text = await res.text();
  assert.match(text, /JENIS,ID,TANGGAL\/WAKTU/);
  assert.match(text, /TRANSAKSI,TX-/);
  assert.match(text, /PENGELUARAN/);
});

test('Laporan: karyawan tanpa permission laporan ditolak 403', async () => {
  const { env } = await bootstrapLaporan();
  const kid = await createUserRaw(env, { nama: 'Kary', username: 'kary', password: 'kary1234', role: 'karyawan' });
  void kid;
  const ktoken = await login(env, 'kary', 'kary1234');
  const r = await call(env, `/api/laporan/bulan?bulan=${currentBulan()}`, { token: ktoken });
  assert.equal(r.status, 403);
});