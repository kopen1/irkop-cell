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

// 1. TRANSFER 100k admin 5k
test('R6 TRANSFER 100k admin 5k: saldo -100k, laci +105k, laba +5k', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'transfer', nominal: 100000, mitra: 'DANA' },
  });
  assert.equal(r.status, 200);
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  const m = mutasiMap(tx.data);
  assert.equal(m['DANA'], -100000);
  assert.equal(m['Saldo Akun'] ?? 0, 0);
  assert.equal(m['Tunai Laci'], 105000);
  assert.equal(m['Laba'], 5000);
  assert.equal(tx.data.admin_type, 'luar');
  assert.equal(tx.data.preview?.laba ?? r.data.admin, 5000);
});

// 2. TARIK TUNAI DALAM
test('R6 Tarik Tunai Admin Dalam 100k admin 5k: saldo +100k, laci -95k, laba +5k', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'tariktunai', nominal: 100000, mitra: 'DANA', admin_type: 'dalam' },
  });
  assert.equal(r.status, 200);
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  const m = mutasiMap(tx.data);
  assert.equal(m['DANA'], 100000);
  assert.equal(m['Saldo Akun'] ?? 0, 0);
  assert.equal(m['Tunai Laci'], -95000);
  assert.equal(m['Laba'], 5000);
});

// 3. TARIK TUNAI LUAR
test('R6 Tarik Tunai Admin Luar 100k admin 5k: saldo +105k, laci -100k, laba +5k', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'tariktunai', nominal: 100000, mitra: 'DANA', admin_type: 'luar' },
  });
  assert.equal(r.status, 200);
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  const m = mutasiMap(tx.data);
  assert.equal(m['DANA'], 105000);
  assert.equal(m['Saldo Akun'] ?? 0, 0);
  assert.equal(m['Tunai Laci'], -100000);
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

// 6. PULSA dibayar transfer (produk, bukan admin transfer)
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
test('R6 payment total mismatch -> 400 (overpay only)', async () => {
  const { env, token } = await bootstrap();
  const svc = await createService(env, token, 150000, 0);
  // Overpay: 200000 > 150000 should be rejected
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: {
      jenis: 'service',
      items: [{ produk_id: svc, qty: 1 }],
      metode_bayar: 'cash_tunai',
      payments: [{ metode: 'tunai', nominal: 200000 }],
    },
  });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, 'payment_mismatch');
});

// 8b. partial payment allowed (bayar kurang)
test('R6 partial payment allowed (bayar kurang)', async () => {
  const { env, token } = await bootstrap();
  const svc = await createService(env, token, 150000, 0);
  // Partial: 100000 < 150000 should be allowed
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: {
      jenis: 'service',
      items: [{ produk_id: svc, qty: 1 }],
      metode_bayar: 'cash_tunai',
      payments: [{ metode: 'tunai', nominal: 100000 }],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.sisa, 50000);
  assert.equal(r.data.status_bayar, 'sebagian');
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

// 10. Transfer Admin Dalam -> reject
test('R6 Transfer dengan admin_type dalam -> 400', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'transfer', nominal: 100000, mitra: 'DANA', admin_type: 'dalam' },
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
test('R6 admin calculation pada transaksi transfer', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'transfer', nominal: 2000000, mitra: 'DANA' },
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
    body: { jenis: 'transfer', nominal: 100000, mitra: 'DANA' },
  });
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  assert.equal(tx.data.mutasi_saldo.length, 3);
  const total = tx.data.mutasi_saldo.reduce((s, x) => s + Number(x.jumlah), 0);
  assert.equal(total, 10000); // -100k +105k +5k
});

// 14b. Selected account (DANA) is the one mutated; no fallback to 'Saldo Akun'
test('R6 TRANSFER mutates selected account DANA (as-is), never Saldo Akun', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'transfer', nominal: 250000, mitra: 'DANA' },
  });
  assert.equal(r.status, 200);
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  const m = mutasiMap(tx.data);
  // DANA is present with the exact selected-account name
  assert.ok('DANA' in m, 'DANA harus ada di mutasi');
  assert.equal(m['DANA'], -250000);
  // No Silent fallback to the legacy 'Saldo Akun' ledger account
  assert.equal(m['Saldo Akun'] ?? 0, 0);
  assert.equal(Object.keys(m).includes('Saldo Akun'), false);
  assert.equal(tx.data.mitra, 'DANA');
});

// 14c. Account name correctness for Tarik Tunai (DANA used verbatim)
test('R6 Tarik Tunai mutates DANA by exact name (no mapping/renaming)', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'tariktunai', nominal: 250000, mitra: 'DANA', admin_type: 'dalam' },
  });
  assert.equal(r.status, 200);
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  const m = mutasiMap(tx.data);
  assert.equal(m['DANA'], 250000); // nominal (admin dalam = fee dari tunai, bukan tambah ke akun)
  assert.equal(m['Saldo Akun'] ?? 0, 0);
});

// 14d. Invalid provider account -> clear 400 invalid_account, no partial mutation
test('R6 transfer with provider that has no account -> 400 invalid_account (no mutation)', async () => {
  const { env, token } = await bootstrap();
  // BANK normalizes but has NO akun_master account (only tarif_admin row)
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'transfer', nominal: 100000, mitra: 'BANK' },
  });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, 'invalid_account');
  // No partial/duplicate mutation: no transaksi created
  const list = await call(env, '/api/transaksi', { token });
  assert.equal(list.data.items.length, 0);
  const mut = await env.DB.prepare("SELECT COUNT(*) AS n FROM mutasi_saldo").first('n');
  assert.equal(Number(mut), 0);
});

// 14e. Non-existent provider (not in akun_master) -> 400
test('R6 transfer with unknown provider -> 400', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'transfer', nominal: 100000, mitra: 'SHOPEE' },
  });
  assert.equal(r.status, 400);
});

// 15. Idempotency retry (admin TRANSFER) -> duplicate:true, no phantom txn / 0-mutation txn
test('R6 TRANSFER idempotency: retry Idempotency-Key -> duplicate:true, no phantom txn', async () => {
  const { env, token } = await bootstrap();
  const headers = { 'Idempotency-Key': 'idem-transfer-001' };
  const body = { jenis: 'transfer', nominal: 100000, mitra: 'DANA' };
  const r1 = await call(env, '/api/transaksi', { method: 'POST', token, body, headers });
  const r2 = await call(env, '/api/transaksi', { method: 'POST', token, body, headers });
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r2.data.duplicate, true);
  assert.equal(r2.data.id, r1.data.id);
  const txCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM transaksi').first('n');
  assert.equal(Number(txCount), 1);
  const mutCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM mutasi_saldo WHERE sumber_tipe='transaksi'").first('n');
  assert.equal(Number(mutCount), 3); // mutasi asli saja; tidak ada txn hantu dg 0 mutasi
});

// 15b. Idempotency retry (admin Tarik Tunai luar) -> duplicate:true, no phantom txn
test('R6 Tarik Tunai idempotency: retry Idempotency-Key -> duplicate:true, no phantom txn', async () => {
  const { env, token } = await bootstrap();
  const headers = { 'Idempotency-Key': 'idem-tarik-001' };
  const body = { jenis: 'tariktunai', nominal: 100000, mitra: 'DANA', admin_type: 'luar' };
  const r1 = await call(env, '/api/transaksi', { method: 'POST', token, body, headers });
  const r2 = await call(env, '/api/transaksi', { method: 'POST', token, body, headers });
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r2.data.duplicate, true);
  assert.equal(r2.data.id, r1.data.id);
  const txCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM transaksi').first('n');
  assert.equal(Number(txCount), 1);
  const mutCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM mutasi_saldo WHERE sumber_tipe='transaksi'").first('n');
  assert.equal(Number(mutCount), 3);
});

// 16. Preview consistency matches actual mutations for all 3 admin types
test('R6 preview konsisten dengan mutasi aktual (transfer/dalam/luar)', async () => {
  const cases = [
    { jenis: 'transfer', admin_type: undefined, nominal: 100000, expectSaldo: -100000, expectLaci: 105000 },
    { jenis: 'tariktunai', admin_type: 'dalam', nominal: 100000, expectSaldo: 100000, expectLaci: -95000 },
    { jenis: 'tariktunai', admin_type: 'luar', nominal: 100000, expectSaldo: 105000, expectLaci: -100000 },
  ];
  for (const c of cases) {
    const { env, token } = await bootstrap();
    const body = { jenis: c.jenis, nominal: c.nominal, mitra: 'DANA' };
    if (c.admin_type) body.admin_type = c.admin_type;
    const r = await call(env, '/api/transaksi', { method: 'POST', token, body });
    assert.equal(r.status, 200);
    assert.equal(r.data.duplicate, false);
    const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
    const m = mutasiMap(tx.data);
    const accKey = Object.keys(m).find((k) => k !== 'Tunai Laci' && k !== 'Laba');
    assert.equal(r.data.preview.saldo_akun, m[accKey]);
    assert.equal(r.data.preview.saldo_akun, c.expectSaldo);
    assert.equal(r.data.preview.laci, m['Tunai Laci']);
    assert.equal(r.data.preview.laci, c.expectLaci);
    assert.equal(r.data.preview.laba, m['Laba']);
    assert.equal(r.data.preview.laba, 5000);
  }
});

// 17. Produk/Jasa edit (PUT) still works and re-mutates correctly
test('R6 Produk/Jasa edit (PUT) updates total & mutasi', async () => {
  const { env, token } = await bootstrap();
  const svc = await createService(env, token, 150000, 0);
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'service', items: [{ produk_id: svc, qty: 1 }], metode_bayar: 'tunai' },
  });
  assert.equal(r.status, 200);
  const edit = await call(env, `/api/transaksi/${r.data.id}`, {
    method: 'PUT', token,
    body: { jenis: 'service', items: [{ produk_id: svc, qty: 2 }], metode_bayar: 'tunai' },
  });
  assert.equal(edit.status, 200);
  assert.equal(edit.data.total, 300000);
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  assert.equal(Number(tx.data.total), 300000);
  const m = mutasiMap(tx.data);
  assert.equal(m['Tunai Laci'], 300000);
});

// 18. Atomicity: a forced mutation failure leaves NO transaksi / NO mutasi
test('R6 atomicity: forced mutation failure leaves NO transaksi', async () => {
  const { sqliteDb, env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 5000000 }] },
  });
  const origPrepare = sqliteDb.prepare.bind(sqliteDb);
  sqliteDb.prepare = (sql) => {
    const stmt = origPrepare(sql);
    if (String(sql).includes('mutasi_saldo')) {
      return {
        run: () => { throw new Error('forced mutation failure'); },
        get: (...a) => stmt.get(...a),
        all: (...a) => stmt.all(...a),
      };
    }
    return stmt;
  };
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'transfer', nominal: 100000, mitra: 'DANA' },
  });
  assert.equal(r.status, 500);
  const txCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM transaksi').first('n');
  assert.equal(Number(txCount), 0);
  const mutCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM mutasi_saldo").first('n');
  assert.equal(Number(mutCount), 0);
});

// 14. Laporan per akun
test('R6 laporan/akun merekap Tunai/Transfer/Admin/Laba', async () => {
  const { env, token } = await bootstrap();
  const day = todayWib();
  const bulan = bulanWib();
  await call(env, '/api/transaksi', { method: 'POST', token, body: { jenis: 'transfer', nominal: 100000, mitra: 'DANA', tanggal_transaksi: day } });
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
  assert.equal(rep.data.saldo_akun, 0); // R6 no longer uses Saldo Akun
  assert.equal(rep.data.admin, 15000); // 3x5k
  assert.equal(rep.data.transfer, 205000); // service transfer 100k + R6 DANA 105k
  assert.equal(rep.data.laba, 150000 + 15000); // service 150k + admin 15k
  assert.equal(rep.data.per_akun['DANA'], 205000);
});

// 19. TRANSFER dengan metode_pembayaran = akun uang dari akun_master (SeaBank)
test('R6 TRANSFER metode_pembayaran SeaBank: mutasi ke SeaBank, bukan Tunai Laci', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'transfer', nominal: 100000, mitra: 'DANA', metode_pembayaran: 'SeaBank' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.preview.pembayaran_akun, 'SeaBank');
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  const m = mutasiMap(tx.data);
  assert.equal(m['DANA'], -100000);
  assert.equal(m['SeaBank'], 105000);
  assert.equal(m['Tunai Laci'] ?? 0, 0);
  assert.equal(m['Laba'], 5000);
});

// 20. TRANSFER (R6, siklus PPOB) — struktur mutasi admin transfer
test('R6 TRANSFER 100k: DANA -100k, laci +105k, laba +5k, jenis transfer', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'transfer', nominal: 100000, mitra: 'DANA' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.jenis, 'transfer');
  assert.equal(r.data.admin_type, 'luar');
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  const m = mutasiMap(tx.data);
  assert.equal(m['DANA'], -100000);
  assert.equal(m['Tunai Laci'], 105000);
  assert.equal(m['Laba'], 5000);
  assert.equal(tx.data.jenis, 'transfer');
});

// 21. Metode pembayaran bukan akun uang (Laba) -> reject
test('R6 metode_pembayaran Laba (tipe lainnya) -> 400 invalid_payment_account', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'transfer', nominal: 100000, mitra: 'DANA', metode_pembayaran: 'Laba' },
  });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, 'invalid_payment_account');
});

// 22. Metode pembayaran sama dengan akun provider -> reject (cegah mutasi hilang)
test('R6 metode_pembayaran sama dengan provider (DANA) -> 400 invalid_payment_account', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'transfer', nominal: 100000, mitra: 'DANA', metode_pembayaran: 'DANA' },
  });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, 'invalid_payment_account');
});

// 23. Konfirmasi transfer menunggu -> ubah ke manual via PUT /konfirmasi
test('R6 transfer menunggu -> PUT konfirmasi manual', async () => {
  const { env, token } = await bootstrap();
  const svc = await createService(env, token, 150000, 0);
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: {
      jenis: 'service', items: [{ produk_id: svc, qty: 1 }], metode_bayar: 'transfer',
      payments: [{ metode: 'transfer', akun_id: 'DANA', nominal: 150000 }],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.konfirmasi_pembayaran, 'menunggu');
  const c = await call(env, `/api/transaksi/${r.data.id}/konfirmasi`, { method: 'PUT', token, body: { konfirmasi_pembayaran: 'manual' } });
  assert.equal(c.status, 200);
  assert.equal(c.data.konfirmasi_pembayaran, 'manual');
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  assert.equal(tx.data.konfirmasi_pembayaran, 'manual');
});

// 24. Ubah status konfirmasi hanya untuk transfer
test('R6 konfirmasi transaksi non-transfer -> bisa diubah (semua jenis)', async () => {
  const { env, token } = await bootstrap();
  const svc = await createService(env, token, 100000, 0);
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'service', items: [{ produk_id: svc, qty: 1 }], metode_bayar: 'tunai' },
  });
  assert.equal(r.status, 200);
  const c = await call(env, `/api/transaksi/${r.data.id}/konfirmasi`, { method: 'PUT', token, body: { konfirmasi_pembayaran: 'manual' } });
  assert.equal(c.status, 200);
  assert.equal(c.data.konfirmasi_pembayaran, 'manual');
});

// 25. Nilai valid; bisa diubah berkali-kali; set nilai sama -> 200 unchanged
test('R6 konfirmasi: nilai tidak valid -> 400; ubah nilai -> sukses; set sama -> unchanged', async () => {
  const { env, token } = await bootstrap();
  const svc = await createService(env, token, 150000, 0);
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: {
      jenis: 'service', items: [{ produk_id: svc, qty: 1 }], metode_bayar: 'transfer',
      payments: [{ metode: 'transfer', akun_id: 'DANA', nominal: 150000 }],
    },
  });
  assert.equal(r.status, 200);
  const bad = await call(env, `/api/transaksi/${r.data.id}/konfirmasi`, { method: 'PUT', token, body: { konfirmasi_pembayaran: 'bogus' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error.code, 'invalid_value');
  const c1 = await call(env, `/api/transaksi/${r.data.id}/konfirmasi`, { method: 'PUT', token, body: { konfirmasi_pembayaran: 'otomatis' } });
  assert.equal(c1.status, 200);
  assert.equal(c1.data.konfirmasi_pembayaran, 'otomatis');
  const c2 = await call(env, `/api/transaksi/${r.data.id}/konfirmasi`, { method: 'PUT', token, body: { konfirmasi_pembayaran: 'otomatis' } });
  assert.equal(c2.status, 200);
  assert.equal(c2.data.unchanged, true);
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  assert.equal(tx.data.konfirmasi_pembayaran, 'otomatis');
});

// 26. Ubah konfirmasi transaksi tidak ada -> 404
test('R6 konfirmasi transaksi tidak ditemukan -> 404', async () => {
  const { env, token } = await bootstrap();
  const c = await call(env, '/api/transaksi/TX-999999999-999/konfirmasi', { method: 'PUT', token, body: { konfirmasi_pembayaran: 'manual' } });
  assert.equal(c.status, 404);
});

// 28. Ubah konfirmasi juga berlaku untuk transaksi admin Transfer (jenis transfer)
test('R6 konfirmasi berlaku untuk transaksi admin Transfer (jenis transfer)', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'transfer', nominal: 100000, mitra: 'DANA' },
  });
  assert.equal(r.status, 200);
  const c = await call(env, `/api/transaksi/${r.data.id}/konfirmasi`, { method: 'PUT', token, body: { konfirmasi_pembayaran: 'menunggu' } });
  assert.equal(c.status, 200);
  assert.equal(c.data.konfirmasi_pembayaran, 'menunggu');
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  assert.equal(tx.data.konfirmasi_pembayaran, 'menunggu');
});

// 29. Ubah konfirmasi juga berlaku untuk transaksi admin Tarik Tunai (jenis tariktunai)
test('R6 konfirmasi berlaku untuk transaksi admin Tarik Tunai (jenis tariktunai)', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { jenis: 'tariktunai', nominal: 100000, mitra: 'DANA', admin_type: 'luar' },
  });
  assert.equal(r.status, 200);
  const c = await call(env, `/api/transaksi/${r.data.id}/konfirmasi`, { method: 'PUT', token, body: { konfirmasi_pembayaran: 'manual' } });
  assert.equal(c.status, 200);
  assert.equal(c.data.konfirmasi_pembayaran, 'manual');
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  assert.equal(tx.data.konfirmasi_pembayaran, 'manual');
});
// 27. Ubah konfirmasi juga berlaku untuk transaksi kirim uang (item nominal_referensi)
test('R6 konfirmasi berlaku untuk transaksi kirim uang (produk + nominal_referensi)', async () => {
  const { env, token } = await bootstrap();
  const svc = await createService(env, token, 5000, 0);
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: {
      jenis: 'service',
      items: [{ produk_id: svc, qty: 1, nominal_referensi: 500000, akun_sumber: 'DANA' }],
      metode_bayar: 'tunai',
    },
  });
  assert.equal(r.status, 200);
  const c = await call(env, `/api/transaksi/${r.data.id}/konfirmasi`, { method: 'PUT', token, body: { konfirmasi_pembayaran: 'menunggu' } });
  assert.equal(c.status, 200);
  assert.equal(c.data.konfirmasi_pembayaran, 'menunggu');
  const tx = await call(env, `/api/transaksi/${r.data.id}`, { token });
  assert.equal(tx.data.konfirmasi_pembayaran, 'menunggu');
});
