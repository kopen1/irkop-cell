import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, setPermission } from './helpers.js';

const SECRET = 's3cret-boot-prod-2026';

function freshEnv() {
  const { sqliteDb, env } = setupEnv();
  env.BOOTSTRAP_SECRET = SECRET;
  return { sqliteDb, env };
}

function bootCall(env, body = {}, secret = SECRET) {
  const headers = secret === null ? {} : { 'x-bootstrap-secret': secret };
  return call(env, '/api/auth/bootstrap', { method: 'POST', body, headers });
}

async function userCount(env) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').all();
  return r.results[0].n;
}

test('bootstrap: admin pertama dibuat, bisa login dengan permission penuh', async () => {
  const { env } = freshEnv();
  const r = await bootCall(env, { nama: 'Admin Utama', username: 'bos', password: 'bos12345' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'admin');
  assert.equal(r.data.user.username, 'bos');
  assert.ok(r.data.user.permissions.gaji_karyawan === true);
  assert.ok(r.data.user.permissions.pengaturan === true);
  assert.equal(await userCount(env), 1);

  const loginRes = await call(env, '/api/auth/login', { method: 'POST', body: { username: 'bos', password: 'bos12345' } });
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.data.user.role, 'admin');
  assert.ok(loginRes.data.user.permissions.gaji_karyawan === true);

  const logs = await call(env, '/api/logs', { token: loginRes.data.token });
  assert.equal(logs.status, 200);
});

test('bootstrap: hanya berhasil sekali; percobaan ulang -> 409 dan admin tetap valid', async () => {
  const { env } = freshEnv();
  const r1 = await bootCall(env, { nama: 'Admin', username: 'admin', password: 'admin1234' });
  assert.equal(r1.status, 200);

  const r2 = await bootCall(env, { nama: 'Penyusup', username: 'admin2', password: 'admin1234' });
  assert.equal(r2.status, 409);
  assert.equal(r2.data.error.code, 'bootstrap_done');
  assert.equal(await userCount(env), 1);

  const loginRes = await call(env, '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } });
  assert.equal(loginRes.status, 200);
});

test('bootstrap: tanpa header atau secret salah ditolak tanpa membuat user', async () => {
  const { env } = freshEnv();
  const bad = await bootCall(env, { nama: 'Admin', username: 'admin', password: 'admin1234' }, 'salah-secret');
  assert.equal(bad.status, 403);
  assert.equal(bad.data.error.code, 'invalid_bootstrap_secret');

  const none = await bootCall(env, { nama: 'Admin', username: 'admin', password: 'admin1234' }, null);
  assert.equal(none.status, 403);
  assert.equal(await userCount(env), 0);
});

test('bootstrap: BOOTSTRAP_SECRET belum dikonfigurasi -> 503, tidak ada user', async () => {
  const { env } = setupEnv();
  const r = await bootCall(env, { nama: 'Admin', username: 'admin', password: 'admin1234' });
  assert.equal(r.status, 503);
  assert.equal(r.data.error.code, 'bootstrap_not_configured');
  assert.equal(await userCount(env), 0);
});

test('bootstrap: validasi body (password pendek, username invalid, role bukan admin)', async () => {
  const { env } = freshEnv();
  const short = await bootCall(env, { nama: 'A', username: 'admin', password: '1234567' });
  assert.equal(short.status, 400);

  const badUser = await bootCall(env, { nama: 'A', username: 'admin!', password: 'admin1234' });
  assert.equal(badUser.status, 400);

  const kary = await bootCall(env, { nama: 'A', username: 'admin', password: 'admin1234', role: 'karyawan' });
  assert.equal(kary.status, 400);
  assert.equal(await userCount(env), 0);
});

test('bootstrap: tidak bisa eskalasi saat admin sudah ada; karyawan tetap tanpa gaji_karyawan', async () => {
  const { env } = freshEnv();
  const r = await bootCall(env, { nama: 'Boss', username: 'boss', password: 'boss12345' });
  assert.equal(r.status, 200);

  const karyId = await createUserRaw(env, { nama: 'Kasir', username: 'kasir', password: 'kasir1234', role: 'karyawan' });
  await setPermission(env, karyId, 'transaksi');
  const karyToken = await login(env, 'kasir', 'kasir1234');

  const me = await call(env, '/api/auth/me', { token: karyToken });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.permissions.gaji_karyawan, undefined);

  const gaji = await call(env, '/api/gaji', { token: karyToken });
  assert.equal(gaji.status, 403);

  const esc = await bootCall(env, { nama: 'Hacker', username: 'hacker', password: 'hacker1234' });
  assert.equal(esc.status, 409);
  assert.equal(await userCount(env), 2);
});
