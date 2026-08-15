import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, createUserRaw } from './helpers.js';

const ADMIN_IP = '203.0.113.10';

async function bootstrap() {
  const { sqliteDb, env } = setupEnv();
  const adminId = await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  return { sqliteDb, env, adminId };
}

function failedLogin(env, username, password = 'salah') {
  return call(env, '/api/auth/login', { method: 'POST', body: { username, password }, headers: { 'CF-Connecting-IP': ADMIN_IP } });
}

test('rate limit: 5+ failed login username sama -> 429, sebelum itu tetap 401', async () => {
  const { env } = await bootstrap();
  for (let i = 1; i <= 5; i += 1) {
    const res = await failedLogin(env, 'admin');
    assert.equal(res.status, 401, `attempt ${i} harus 401`);
    assert.equal(res.data.error.code, 'invalid_credentials');
  }
  const blocked = await failedLogin(env, 'admin');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.error.code, 'rate_limited');
  assert.ok(blocked.data.error.message.length > 0);
});

test('rate limit: 20+ failed login dari IP sama (username beda) -> 429', async () => {
  const { env } = await bootstrap();
  for (let i = 1; i <= 20; i += 1) {
    const res = await failedLogin(env, `unknown_user_${i}`);
    assert.equal(res.status, 401, `attempt ${i} harus 401`);
  }
  const blocked = await failedLogin(env, 'another_user');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.error.code, 'rate_limited');
});

test('rate limit: failed lalu sukses sebelum limit -> 200 dan counter username reset', async () => {
  const { env } = await bootstrap();
  for (let i = 1; i <= 3; i += 1) {
    assert.equal((await failedLogin(env, 'admin')).status, 401);
  }
  const ok = await call(env, '/api/auth/login', {
    method: 'POST', body: { username: 'admin', password: 'admin1234' }, headers: { 'CF-Connecting-IP': ADMIN_IP },
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);
  for (let i = 1; i <= 4; i += 1) {
    const res = await failedLogin(env, 'admin');
    assert.equal(res.status, 401, `post-reset attempt ${i} harus 401 (counter sudah reset)`);
  }
  const fifth = await failedLogin(env, 'admin');
  assert.equal(fifth.status, 401, 'attempt ke-5 setelah reset ikut dihitung, masih 401');
  assert.equal((await failedLogin(env, 'admin')).status, 429, 'limit 5 tercapai lagi setelah reset');
});

test('rate limit: counter expired -> attempt baru dihitung dari 1, bukan 429', async () => {
  const { sqliteDb, env } = await bootstrap();
  for (let i = 1; i <= 5; i += 1) {
    assert.equal((await failedLogin(env, 'admin')).status, 401);
  }
  assert.equal((await failedLogin(env, 'admin')).status, 429, 'harus kena limit sebelum window expire');

  sqliteDb.prepare(
    "UPDATE login_attempt SET window_start = '2000-01-01T00:00:00.000Z' WHERE bucket = 'user:admin'"
  ).run();

  const afterExpire = await failedLogin(env, 'admin');
  assert.equal(afterExpire.status, 401, 'counter expired tidak boleh 429');
  const row = sqliteDb.prepare("SELECT count FROM login_attempt WHERE bucket = 'user:admin'").get();
  assert.equal(row.count, 1, 'attempt baru mulai dari 1');
});

test('rate limit: login normal tetap 200 & credential salah tetap 401 (regression)', async () => {
  const { env } = await bootstrap();
  const ok = await call(env, '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);
  assert.equal(ok.data.user.role, 'admin');
  const bad = await call(env, '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'salah' } });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.error.code, 'invalid_credentials');
});