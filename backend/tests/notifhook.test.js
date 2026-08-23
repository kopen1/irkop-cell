import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { setupEnv, call, login, createUserRaw, createKategoriRaw, createProdukRaw } from './helpers.js';

async function setSetting(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, value, new Date().toISOString()).run();
}

async function bootstrapNotif() {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  await setSetting(env, 'notifhook_auto_input', '1');
  await setSetting(env, 'notifhook_api_key_raw', 'irk_test_secret_123');
  const k1 = await createKategoriRaw(env, 'Fisik', 1);
  const p1 = await createProdukRaw(env, { kode: 'P-001', nama: 'Toner', kategori_id: k1, harga: 100000, stok: 50 });
  await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 500000 }, { nama_akun: 'SeaBank', saldo: 1000000 }] },
  });
  return { env, token, p1 };
}

function webhook(env, body, apiKey = 'irk_test_secret_123') {
  return call(env, '/api/notifhook', {
    method: 'POST',
    headers: { 'X-API-Key': apiKey },
    body,
  });
}

test('NotifHook: tanpa/API key salah → 401', async () => {
  const { env, token } = await bootstrapNotif();
  const noKey = await call(env, '/api/notifhook', { method: 'POST', body: { idempotency_key: 'abc' } });
  assert.equal(noKey.status, 401);
  assert.equal(noKey.data.error.code, 'invalid_api_key');
  const wrong = await webhook(env, { idempotency_key: 'abc' }, 'salah');
  assert.equal(wrong.status, 401);
});

test('NotifHook: idempotency_key wajib + body harus JSON', async () => {
  const { env } = await bootstrapNotif();
  const noIdem = await webhook(env, {});
  assert.equal(noIdem.status, 400);
  assert.equal(noIdem.data.error.code, 'missing_field');

  const res = await worker.fetch(new Request('https://irkop.local/api/notifhook', {
    method: 'POST',
    headers: { 'X-API-Key': 'irk_test_secret_123', 'content-type': 'application/json' },
    body: 'bukan-json',
  }), env);
  const bad = await res.json();
  assert.equal(res.status, 400);
  assert.equal(bad.error.code, 'invalid_json');
});

test('NotifHook: auto-confirm transaksi transfer + idempotensi tidak dobel', async () => {
  const { env, token, p1 } = await bootstrapNotif();
  const tx = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'transfer', akun_penerima: 'SeaBank' },
  });
  assert.equal(tx.data.konfirmasi_pembayaran, 'menunggu');

  const ok = await webhook(env, { idempotency_key: 'k-1', transaksi_kode: tx.data.id, source_app: 'SeaBank' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.status, 'diproses');
  assert.equal(ok.data.duplicate, false);

  const detail = await call(env, `/api/transaksi/${tx.data.id}`, { token });
  assert.equal(detail.data.konfirmasi_pembayaran, 'otomatis');

  const dup = await webhook(env, { idempotency_key: 'k-1', transaksi_kode: tx.data.id });
  assert.equal(dup.status, 200);
  assert.equal(dup.data.status, 'diabaikan');
  assert.equal(dup.data.duplicate, true);
});

test('NotifHook: transaksi non-transfer / tidak ditemukan → gagal, tidak mengubah status', async () => {
  const { env, token, p1 } = await bootstrapNotif();
  const cash = await call(env, '/api/transaksi', {
    method: 'POST', token,
    body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'tunai' },
  });
  const r1 = await webhook(env, { idempotency_key: 'k-2', transaksi_kode: cash.data.id });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.status, 'gagal');
  assert.match(r1.data.error_message, /bukan metode transfer/);
  const detail = await call(env, `/api/transaksi/${cash.data.id}`, { token });
  assert.equal(detail.data.konfirmasi_pembayaran, 'tidak_perlu');

  const r2 = await webhook(env, { idempotency_key: 'k-3', transaksi_kode: 'TX-99999999-999' });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.status, 'gagal');
  assert.match(r2.data.error_message, /tidak ditemukan/);
});

async function addSource(env, sourceName, matcherValue) {
  await env.DB.prepare(
    `INSERT INTO notifhook_source (source_name, enabled, matcher_type, matcher_value, created_at)
     VALUES (?, 1, 'package_name', ?, ?)`
  ).bind(sourceName, matcherValue, new Date().toISOString()).run();
}

async function dbOne(env, sql, id) {
  return env.DB.prepare(sql).bind(id).first();
}

async function dbCount(env, sql) {
  const r = await env.DB.prepare(sql).all();
  return Number(r.results ? r.results[0].n : r[0].n);
}

test('NotifHook: auto-input buat transaksi transfer baru dari notifikasi', async () => {
  const { env, token } = await bootstrapNotif();
  // SeaBank sudah ada sebagai akun (dibuka di bootstrap). Daftarkan sebagai sumber.
  await addSource(env, 'SeaBank', 'com.seabank');

  const res = await webhook(env, { idempotency_key: 'auto-1', source_app: 'SeaBank', amount: 150000 });
  assert.equal(res.status, 200);
  assert.equal(res.data.status, "diproses");
  assert.equal(res.data.duplicate, false);
  assert.ok(res.data.transaksi_id, 'transaksi harus terbuat');

  const tx = await dbOne(env, 'SELECT * FROM transaksi WHERE id = ?', res.data.transaksi_id);
  assert.equal(tx.jenis, 'transfer');
  assert.equal(tx.mitra, 'BANK'); // provider kategori (SeaBank = bank)
  assert.equal(tx.konfirmasi_pembayaran, 'otomatis');
  assert.ok(Number(tx.total) >= 150000, 'total = nominal + admin fee');
  assert.ok(Number(tx.laba) > 0, 'ada admin fee (laba)');

  // Mutasi: saldo akun SeaBank bertambah
  const mut = await dbOne(env, "SELECT * FROM mutasi_saldo WHERE sumber_id = ? AND nama_akun = 'SeaBank'", res.data.transaksi_id);
  assert.equal(Number(mut.jumlah), -150000); // transfer: akun provider keluar (lihat plan)

  // Idempotensi webhook: panggil lagi dengan key sama -> diabaikan (tidak bikin tx baru)
  const before = await dbCount(env, 'SELECT COUNT(*) AS n FROM transaksi');
  const dup = await webhook(env, { idempotency_key: 'auto-1', source_app: 'SeaBank', amount: 150000 });
  assert.equal(dup.data.status, 'diabaikan');
  assert.equal(dup.data.duplicate, true);
  const after = await dbCount(env, 'SELECT COUNT(*) AS n FROM transaksi');
  assert.equal(after, before);
});

test('NotifHook: auto-input sumber tidak dikenali -> gagal', async () => {
  const { env } = await bootstrapNotif();
  const res = await webhook(env, { idempotency_key: 'auto-2', source_app: 'UnknownApp', amount: 50000 });
  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'gagal');
  assert.match(res.data.error_message, /tidak dikenali/);
});

test('NotifHook: auto-input tanpa sesi kasir aktif -> gagal', async () => {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  await setSetting(env, 'notifhook_auto_input', '1');
  await setSetting(env, 'notifhook_api_key_raw', 'irk_test_secret_123');
  await addSource(env, 'SeaBank', 'com.seabank');
  // TIDAK membuka kasir -> requireOpenSession gagal
  const res = await webhook(env, { idempotency_key: 'auto-3', source_app: 'SeaBank', amount: 50000 });
  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'gagal');
  assert.match(res.data.error_message, /sesi|kasir/i);
});

test('NotifHook: auto-input OFF -> tidak membuat transaksi', async () => {
  const { env } = await bootstrapNotif();
  await env.DB.prepare("UPDATE settings SET value = '0' WHERE key = 'notifhook_auto_input'").run();
  await addSource(env, 'SeaBank', 'com.seabank');
  const before = await dbCount(env, 'SELECT COUNT(*) AS n FROM transaksi');
  const res = await webhook(env, { idempotency_key: 'auto-4', source_app: 'SeaBank', amount: 50000 });
  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'diterima'); // diterima tapi tidak diproses
  assert.equal(res.data.transaksi_id, null);
  const after = await dbCount(env, 'SELECT COUNT(*) AS n FROM transaksi');
  assert.equal(after, before);
});
