import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import worker from '../src/index.js';
import { setupEnv } from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const passwordSrc = readFileSync(join(__dirname, '../src/lib/password.js'), 'utf8');

const b64encode = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

// Meniru limit workerd: crypto.subtle.deriveBits(PBKDF2) dengan iterasi
// > 100000 menolak dengan NotSupportedError. Implementasi baru tidak boleh
// bergantung pada crypto.subtle PBKDF2 sama sekali.
// Node mengekspos crypto.subtle sebagai getter-only, jadi patch dilakukan
// lewat prototipe SubtleCrypto dan dikembalikan setelah selesai.
function applyWorkerdPbkdf2Cap() {
  const proto = Object.getPrototypeOf(crypto.subtle);
  const orig = proto.deriveBits;
  proto.deriveBits = function deriveBitsCapped(algorithm, key, length) {
    if (algorithm?.name === 'PBKDF2' && algorithm.iterations > 100000) {
      return Promise.reject(new DOMException(
        `iteration counts above 100000 are not supported (requested ${algorithm.iterations}).`,
        'NotSupportedError'
      ));
    }
    return orig.call(this, algorithm, key, length);
  };
  return () => { proto.deriveBits = orig; };
}

test('statis: jalur utama crypto.subtle native @12000 (Free-safe); fallback pure-JS utk legacy >100k', () => {
  assert.ok(passwordSrc.includes('crypto.subtle'), 'jalur utama memakai crypto.subtle native');
  assert.ok(passwordSrc.includes('12000'), 'iterasi default = 12000 (<= cap workerd)');
  assert.ok(passwordSrc.includes('MAX_NATIVE_ITER = 100000'), 'cap native 100000 didefinisikan');
  assert.ok(passwordSrc.includes('pbkdf2Js'), 'fallback pure-JS tersedia utk legacy >100k');
});

test('workerd cap: simulasi deriveBits PBKDF2 >100k benar-benar ditolak (stub valid)', async () => {
  const restore = applyWorkerdPbkdf2Cap();
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('pw'), 'PBKDF2', false, ['deriveBits']);
    await assert.rejects(
      crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new Uint8Array(16), iterations: 210000, hash: 'SHA-256' }, key, 256),
      (e) => e.name === 'NotSupportedError' && /100000/.test(e.message)
    );
  } finally {
    restore();
  }
});

test('workerd cap: hashPassword & verifyPassword tetap bekerja (iterasi native 12000)', async () => {
  const restore = applyWorkerdPbkdf2Cap();
  try {
    const stored = await hashPassword('secret1234');
    assert.equal(stored.split('$')[2], '12000');
    assert.equal(await verifyPassword('secret1234', stored), true);
    assert.equal(await verifyPassword('wrong-pass', stored), false);
  } finally {
    restore();
  }
});

test('workerd cap: verify hash legacy 210000 (>100k) tetap jalan via fallback pure-JS', async () => {
  const restore = applyWorkerdPbkdf2Cap();
  try {
    const salt = randomBytes(16);
    const dk = pbkdf2Sync('secret1234', salt, 210000, 32, 'sha256');
    const stored = `pbkdf2$v1$210000$${b64encode(salt)}$${b64encode(new Uint8Array(dk))}`;
    assert.equal(await verifyPassword('secret1234', stored), true);
    assert.equal(await verifyPassword('wrong-pass', stored), false);
  } finally {
    restore();
  }
});

test('workerd cap: bootstrap + login + me tetap jalan (auth utuh)', async () => {
  const restore = applyWorkerdPbkdf2Cap();
  try {
    const { env } = setupEnv();
    env.BOOTSTRAP_SECRET = 'workers-compat-secret';

    const boot = await call(env, '/api/auth/bootstrap', {
      method: 'POST',
      headers: { 'x-bootstrap-secret': 'workers-compat-secret' },
      body: { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' },
    });
    assert.equal(boot.status, 200);

    const login = await call(env, '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } });
    assert.equal(login.status, 200);
    assert.ok(login.data.token);

    const me = await call(env, '/api/auth/me', { token: login.data.token });
    assert.equal(me.status, 200);
    assert.equal(me.data.user.role, 'admin');

    const bad = await call(env, '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'salah1234' } });
    assert.equal(bad.status, 401);
  } finally {
    restore();
  }
});

async function call(env, path, { method = 'GET', token = null, body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (token) init.headers.Authorization = `Bearer ${token}`;
  const req = new Request(`https://irkop.local${path}`, init);
  const res = await worker.fetch(req, env);
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}
