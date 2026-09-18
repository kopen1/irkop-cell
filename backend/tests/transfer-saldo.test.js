import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw } from './helpers.js';

async function bootstrap() {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'SeaBank', saldo: 10000000 }, { nama_akun: 'OrderKuota', saldo: 0 }] },
  });
  return { env, token };
}

async function sumMutasi(env, namaAkun) {
  const r = await env.DB.prepare('SELECT COALESCE(SUM(jumlah),0) AS n FROM mutasi_saldo WHERE nama_akun = ?').bind(namaAkun).first();
  return Number(r.n);
}

test('transfer saldo: asal -nominal, tujuan +nominal (net 0)', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transfer-saldo', {
    method: 'POST', token,
    body: { dari_akun: 'SeaBank', ke_akun: 'OrderKuota', nominal: 1000000, catatan: 'isi saldo' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await sumMutasi(env, 'SeaBank'), -1000000, 'SeaBank harus -1.000.000');
  assert.equal(await sumMutasi(env, 'OrderKuota'), 1000000, 'OrderKuota harus +1.000.000');
  assert.equal((await sumMutasi(env, 'SeaBank')) + (await sumMutasi(env, 'OrderKuota')), 0, 'total harus net 0');
});

test('transfer saldo: validasi akun sama / ledger / nominal', async () => {
  const { env, token } = await bootstrap();
  const same = await call(env, '/api/transfer-saldo', {
    method: 'POST', token, body: { dari_akun: 'SeaBank', ke_akun: 'SeaBank', nominal: 1000 },
  });
  assert.equal(same.status, 400);

  const ledger = await call(env, '/api/transfer-saldo', {
    method: 'POST', token, body: { dari_akun: 'Laba', ke_akun: 'OrderKuota', nominal: 1000 },
  });
  assert.equal(ledger.status, 400);
  assert.equal(ledger.data.error.code, 'invalid_account');

  const bad = await call(env, '/api/transfer-saldo', {
    method: 'POST', token, body: { dari_akun: 'SeaBank', ke_akun: 'OrderKuota', nominal: 0 },
  });
  assert.equal(bad.status, 400);
});

test('transfer saldo: hapus => reversal (saldo kembali)', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/transfer-saldo', {
    method: 'POST', token, body: { dari_akun: 'SeaBank', ke_akun: 'OrderKuota', nominal: 500000 },
  });
  assert.equal(r.status, 200);
  const del = await call(env, `/api/transfer-saldo/${r.data.id}`, { method: 'DELETE', token });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(await sumMutasi(env, 'SeaBank'), 0, 'reversal harus mengembalikan SeaBank');
  assert.equal(await sumMutasi(env, 'OrderKuota'), 0, 'reversal harus mengembalikan OrderKuota');
});

test('transfer saldo: idempotency key tidak menggandakan', async () => {
  const { env, token } = await bootstrap();
  const body = { dari_akun: 'SeaBank', ke_akun: 'OrderKuota', nominal: 250000 };
  const headers = { 'Idempotency-Key': 'tr-idem-1' };
  const a = await call(env, '/api/transfer-saldo', { method: 'POST', token, headers, body });
  const b = await call(env, '/api/transfer-saldo', { method: 'POST', token, headers, body });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.data.id, b.data.id, 'id harus sama (tidak dobel)');
  assert.equal(await sumMutasi(env, 'OrderKuota'), 250000, 'hanya sekali');
});

test('transfer saldo: ditolak saat sesi kasir belum dibuka', async () => {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin2', username: 'admin2', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin2', 'admin1234');
  const r = await call(env, '/api/transfer-saldo', {
    method: 'POST', token, body: { dari_akun: 'SeaBank', ke_akun: 'OrderKuota', nominal: 1000 },
  });
  assert.equal(r.status, 409);
});
