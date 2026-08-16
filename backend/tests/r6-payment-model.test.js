import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, createKategoriRaw, createProdukRaw } from './helpers.js';

function wibNow() {
  return new Date(new Date().getTime() + 7 * 3600 * 1000);
}
function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function todayWib() {
  return ymd(wibNow());
}
function bulanWib() {
  const d = wibNow();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function bootstrap() {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 5000000 }] },
  });
  return { env, token };
}

async function createService(env, token, harga, modal = 0) {
  const k = await createKategoriRaw(env, 'Service', 0);
  return createProdukRaw(env, { kode: `SVC-${harga}`, nama: 'Service X', kategori_id: k, harga, harga_modal: modal, stok: 0 });
}

function mutasiMap(tx) {
  const m = {};
  for (const r of tx.mutasi_saldo) m[r.nama_akun] = Number(r.jumlah);
  return m;
}

// 1. TOP UP 100k admin 5k
test('R6 TOP UP 100k admin 5k: saldo -100k, laci +105k, laba +5k', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'topup', nominal: 100000, mitra: 'DANA' },
  });
  assert.equal(r.status, 200);
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  const m = mutasiMap(tx.data);
  assert.equal(m['Saldo Akun'], -100000);
  assert.equal(m['Tunai Laci'], 105000);
  assert.equal(m['Laba'], 5000);
  assert.equal(tx.data.admin_type, 'luar');
  assert.equal(tx.data.preview?.laba ?? r.data.admin, 5000);
});

// 2. TARIK TUNAI DALAM
test('R6 Tarik Tunai Admin Dalam 100k admin 5k: saldo +105k, laci -100k, laba +5k', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'tariktunai', nominal: 100000, mitra: 'DANA', admin_type: 'dalam' },
  });
  assert.equal(r.status, 200);
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  const m = mutasiMap(tx.data);
  assert.equal(m['Saldo Akun'], 105000);
  assert.equal(m['Tunai Laci'], -100000);
  assert.equal(m['Laba'], 5000);
});

// 3. TARIK TUNAI LUAR
test('R6 Tarik Tunai Admin Luar 100k admin 5k: saldo +100k, laci -95k, laba +5k', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'tariktunai', nominal: 100000, mitra: 'DANA', admin_type: 'luar' },
  });
  assert.equal(r.status, 200);
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  const m = mutasiMap(tx.data);
  assert.equal(m['Saldo Akun'], 100000);
  assert.equal(m['Tunai Laci'], -95000);
  assert.equal(m['Laba'], 5000);
});

// 4. SERVICE split 150k = tunai 50k + transfer 100k
test('R6 Service split: Tunai 50k + Transfer 100k', async () => {
  const { env, token } = await bootstrap();
  const svc = await createService(env, token, 150000, 0);
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: {
      jenis: 'service',
      items: [{ produk_id: svc, qty: 1 }],
      metode_bayar: 'cash_tunai',
      payments: [
        { metode: 'tunai', nominal: 50000 },
        { metode: 'transfer', akun_id: 'DANA', nominal: 100000 },
      ],
    },
  });
  assert.equal(r.status, 200);
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  const m = mutasiMap(tx.data);
  assert.equal(m['Tunai Laci'], 50000);
  assert.equal(m['DANA'], 100000);
  assert.equal(tx.data.pembayaran.length, 2);
  assert.equal(tx.data.laba, 150000);
  assert.equal(tx.data.metode_bayar, 'cash_tunai');
});

// 5. SERVICE transfer-only
test('R6 Service transfer-only 150k', async () => {
  const { env, token } = await bootstrap();
  const svc = await createService(env, token, 150000, 0);
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: {
      jenis: 'service',
      items: [{ produk_id: svc, qty: 1 }],
      metode_bayar: 'transfer',
      payments: [{ metode: 'transfer', akun_id: 'DANA', nominal: 150000 }],
    },
  });
  assert.equal(r.status, 200);
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  const m = mutasiMap(tx.data);
  assert.equal(m['DANA'], 150000);
  assert.equal(m['Tunai Laci'] ?? 0, 0);
  assert.equal(tx.data.metode_bayar, 'transfer');
});

// 6. PULSA transfer (bukan Top Up)
test('R6 Pulsa dibayar transfer -> mutasi ke DANA, bukan Saldo Akun', async () => {
  const { env, token } = await bootstrap();
  const k = await createKategoriRaw(env, 'Pulsa', 0);
  const p = await createProdukRaw(env, { kode: 'PL-1', nama: 'Pulsa 50k', kategori_id: k, harga: 50000, harga_modal: 48000, stok: 0 });
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: {
      jenis: 'pulsa',
      items: [{ produk_id: p, qty: 1 }],
      metode_bayar: 'transfer',
      payments: [{ metode: 'transfer', akun_id: 'DANA', nominal: 50000 }],
    },
  });
  assert.equal(r.status, 200);
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  const m = mutasiMap(tx.data);
  assert.equal(m['DANA'], 50000);
  assert.equal(m['Saldo Akun'] ?? 0, 0);
});

// 7. payment total mismatch -> reject
test('R6 payment total mismatch -> 400', async () => {
  const { env, token } = await bootstrap();
  const svc = await createService(env, token, 150000, 0);
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: {
      jenis: 'service',
      items: [{ produk_id: svc, qty: 1 }],
      metode_bayar: 'cash_tunai',
      payments: [{ metode: 'tunai', nominal: 50000 }, { metode: 'transfer', akun_id: 'DANA', nominal: 90000 }],
    },
  });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, 'payment_mismatch');
});

// 8. payment zero/negative -> reject
test('R6 payment zero/negative -> 400', async () => {
  const { env, token } = await bootstrap();
  const svc = await createService(env, token, 150000, 0);
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: {
      jenis: 'service',
      items: [{ produk_id: svc, qty: 1 }],
      metode_bayar: 'cash_tunai',
      payments: [{ metode: 'tunai', nominal: 0 }],
    },
  });
  assert.equal(r.status, 400);
});

// 9. unknown payment method -> reject
test('R6 unknown payment method -> 400', async () => {
  const { env, token } = await bootstrap();
  const svc = await createService(env, token, 150000, 0);
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: {
      jenis: 'service',
      items: [{ produk_id: svc, qty: 1 }],
      metode_bayar: 'cash_tunai',
      payments: [{ metode: 'kripto', nominal: 150000 }],
    },
  });
  assert.equal(r.status, 400);
});

// 10. Top Up Admin Dalam -> reject
test('R6 Top Up dengan admin_type dalam -> 400', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'topup', nominal: 100000, mitra: 'DANA', admin_type: 'dalam' },
  });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, 'invalid_admin_type');
});

// 11. Tarif boundaries
test('R6 tarif admin boundaries', async () => {
  const { env, token } = await bootstrap();
  const cases = [
    ['DANA', 30000, 2000],
    ['DANA', 31000, 3000],
    ['DANA', 94000, 3000],
    ['DANA', 95000, 5000],
    ['DANA', 900000, 5000],
    ['DANA', 901000, 10000],
    ['DANA', 1990000, 10000],
    ['DANA', 2000000, 15000],
    ['BANK', 10000, 5000],
    ['OVO', 50000, 3000],
    ['GOPAY', 94000, 3000],
  ];
  for (const [provider, nominal, expected] of cases) {
    const r = await call(env, `/api/tarif?provider=${provider}&nominal=${nominal}`, { token });
    assert.equal(r.status, 200, `${provider} ${nominal}`);
    assert.equal(r.data.admin, expected, `${provider} ${nominal} expected ${expected} got ${r.data.admin}`);
  }
  // bawah batas -> 400
  const bad = await call(env, '/api/tarif?provider=BANK&nominal=5000', { token });
  assert.equal(bad.status, 400);
  const badProv = await call(env, '/api/tarif?provider=SHOPEE&nominal=50000', { token });
  assert.equal(badProv.status, 400);
});

// 12. Admin calculation correctness
test('R6 admin calculation pada transaksi topup', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'topup', nominal: 2000000, mitra: 'DANA' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.admin, 15000);
  assert.equal(r.data.total, 2000000 + 15000);
});

// 13. Mutation balance / no orphan
test('R6 admin transaksi punya tepat 3 mutasi (no orphan)', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'topup', nominal: 100000, mitra: 'DANA' },
  });
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  assert.equal(tx.data.mutasi_saldo.length, 3);
  const total = tx.data.mutasi_saldo.reduce((s, x) => s + Number(x.jumlah), 0);
  assert.equal(total, 10000); // -100k +105k +5k
});

// 14. Laporan per akun
test('R6 laporan/akun merekap Tunai/Transfer/Admin/Laba', async () => {
  const { env, token } = await bootstrap();
  const day = todayWib();
  const bulan = bulanWib();
  await call(env, '/api/transaksi', { method: 'POST', token, body: { jenis: 'topup', nominal: 100000, mitra: 'DANA', tanggal_transaksi: day } });
  await call(env, '/api/transaksi', { method: 'POST', token, body: { jenis: 'tariktunai', nominal: 100000, mitra: 'DANA', admin_type: 'dalam', tanggal_transaksi: day } });
  await call(env, '/api/transaksi', { method: 'POST', token, body: { jenis: 'tariktunai', nominal: 100000, mitra: 'DANA', admin_type: 'luar', tanggal_transaksi: day } });
  const svc = await createService(env, token, 150000, 0);
  await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: {
      jenis: 'service', items: [{ produk_id: svc, qty: 1 }], metode_bayar: 'cash_tunai',
      payments: [{ metode: 'tunai', nominal: 50000 }, { metode: 'transfer', akun_id: 'DANA', nominal: 100000 }],
      tanggal_transaksi: day,
    },
  });

  const rep = await call(env, `/api/laporan/akun?bulan=${bulan}`, { token });
  assert.equal(rep.status, 200);
  assert.equal(rep.data.tunai, 105000 - 100000 - 95000 + 50000); // -40000
  assert.equal(rep.data.saldo_akun, -100000 + 105000 + 100000); // 105000
  assert.equal(rep.data.admin, 15000); // 3x5k
  assert.equal(rep.data.transfer, 100000); // service transfer
  assert.equal(rep.data.laba, 150000 + 15000); // service 150k + admin 15k
});
