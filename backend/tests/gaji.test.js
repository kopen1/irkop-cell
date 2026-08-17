import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, setPermission } from './helpers.js';

// ITEM 12 — Gaji Auto + Manual: tidak boleh ada double-pay.
// Invariant inti: UNIQUE(user_id, tanggal) → per user per tanggal TEPAT SATU baris
// gaji_harian, apa pun urutan auto (kasir opening) vs manual (createGajiManual).

function wibNow() {
  return new Date(new Date().getTime() + 7 * 3600 * 1000);
}
function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function todayWib() {
  return ymd(wibNow());
}

async function setup() {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const karyawanId = await createUserRaw(env, { nama: 'Karyawan', username: 'kry', password: 'kry12345', role: 'karyawan' });
  await setPermission(env, karyawanId, 'kasir');
  const adminToken = await login(env, 'admin', 'admin1234');
  const karyawanToken = await login(env, 'kry', 'kry12345');
  return { env, adminToken, karyawanToken, karyawanId };
}

async function setRate(env, token, userId, rateFlat) {
  const r = await call(env, '/api/gaji/rate', {
    method: 'POST', token,
    body: { user_id: userId, tipe: 'flat', rate_flat: rateFlat },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r;
}

async function openKasir(env, token) {
  return call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 5000000 }] },
  });
}

async function gajiFor(env, token, tanggal, userId) {
  const r = await call(env, `/api/gaji?tanggal=${tanggal}`, { token });
  assert.equal(r.status, 200);
  const rows = (r.data.items || []).filter((x) => (userId ? x.user_id === userId : true));
  return rows;
}

test('GAJI auto: karyawan buka kasir -> tepat 1 baris sumber=auto sesuai rate', async () => {
  const { env, adminToken, karyawanToken, karyawanId } = await setup();
  const today = todayWib();
  await setRate(env, adminToken, karyawanId, 50000);

  const open = await openKasir(env, karyawanToken);
  assert.equal(open.status, 200, JSON.stringify(open.data));

  const rows = await gajiFor(env, adminToken, today, karyawanId);
  assert.equal(rows.length, 1, 'harus TEPAT 1 baris gaji untuk karyawan hari ini');
  assert.equal(rows[0].nominal, 50000);
  assert.equal(rows[0].sumber, 'auto');
});

test('GAJI no double-pay: manual dibuat DULU -> auto opening TIDAK menimpa/menduplikasi', async () => {
  const { env, adminToken, karyawanToken, karyawanId } = await setup();
  const today = todayWib();
  await setRate(env, adminToken, karyawanId, 50000);

  const manual = await call(env, '/api/gaji', {
    method: 'POST', token: adminToken,
    body: { user_id: karyawanId, tanggal: today, nominal: 70000, catatan: 'hari khusus' },
  });
  assert.equal(manual.status, 200, JSON.stringify(manual.data));

  const open = await openKasir(env, karyawanToken);
  assert.equal(open.status, 200, JSON.stringify(open.data));

  const rows = await gajiFor(env, adminToken, today, karyawanId);
  assert.equal(rows.length, 1, 'manual + auto tidak boleh menghasilkan 2 baris');
  assert.equal(rows[0].nominal, 70000, 'nominal manual dipertahankan');
  assert.equal(rows[0].sumber, 'manual_edit');
});

test('GAJI no double-pay: auto dibuat DULU -> manual setelahnya upsert, tetap 1 baris', async () => {
  const { env, adminToken, karyawanToken, karyawanId } = await setup();
  const today = todayWib();
  await setRate(env, adminToken, karyawanId, 50000);

  const open = await openKasir(env, karyawanToken);
  assert.equal(open.status, 200, JSON.stringify(open.data));

  const manual = await call(env, '/api/gaji', {
    method: 'POST', token: adminToken,
    body: { user_id: karyawanId, tanggal: today, nominal: 90000 },
  });
  assert.equal(manual.status, 200, JSON.stringify(manual.data));

  const rows = await gajiFor(env, adminToken, today, karyawanId);
  assert.equal(rows.length, 1, 'auto + manual tidak boleh menghasilkan 2 baris');
  assert.equal(rows[0].nominal, 90000);
  assert.equal(rows[0].sumber, 'manual_edit');
});

test('GAJI no double-pay: buka kasir dua kali ditolak (session_already_opened) -> 1 baris saja', async () => {
  const { env, adminToken, karyawanToken, karyawanId } = await setup();
  const today = todayWib();
  await setRate(env, adminToken, karyawanId, 50000);

  const open1 = await openKasir(env, karyawanToken);
  assert.equal(open1.status, 200, JSON.stringify(open1.data));

  const open2 = await openKasir(env, karyawanToken);
  assert.equal(open2.status, 409);
  assert.equal(open2.data.error.code, 'session_already_opened');

  const rows = await gajiFor(env, adminToken, today, karyawanId);
  assert.equal(rows.length, 1, 'opening berulang tidak boleh menggandakan gaji');
});

test('GAJI auto: admin buka kasir -> TIDAK dibuat baris gaji untuk admin', async () => {
  const { env, adminToken } = await setup();
  const today = todayWib();

  const open = await openKasir(env, adminToken);
  assert.equal(open.status, 200, JSON.stringify(open.data));

  const r = await call(env, `/api/gaji?tanggal=${today}`, { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.data.items.length, 0, 'admin tidak punya rate/baris gaji otomatis');
});