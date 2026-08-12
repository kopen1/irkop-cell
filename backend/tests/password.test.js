import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword, randomToken } from '../src/lib/password.js';

const b64encode = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

test('hash: format tetap pbkdf2$v1$iterations$salt$hash dengan 12000 iterasi', async () => {
  const stored = await hashPassword('secret1234');
  const parts = stored.split('$');
  assert.equal(parts.length, 5);
  assert.equal(parts[0], 'pbkdf2');
  assert.equal(parts[1], 'v1');
  assert.equal(parts[2], '12000');
  assert.equal(b64decode(parts[3]).length, 16, 'salt 16 byte');
  assert.equal(b64decode(parts[4]).length, 32, 'hash 32 byte');
});

test('verify: password benar diterima, salah ditolak', async () => {
  const stored = await hashPassword('secret1234');
  assert.equal(await verifyPassword('secret1234', stored), true);
  assert.equal(await verifyPassword('secret1235', stored), false);
  assert.equal(await verifyPassword('SECRET1234', stored), false);
});

test('verify: hash rusak / format tak dikenal -> false (tanpa throw)', async () => {
  assert.equal(await verifyPassword('secret1234', 'garbage'), false);
  assert.equal(await verifyPassword('secret1234', 'pbkdf2$v2$210000$AA==$BB=='), false);
  assert.equal(await verifyPassword('secret1234', 'pbkdf2$v1$abc$AA==$BB=='), false);
  assert.equal(await verifyPassword('secret1234', 'pbkdf2$v1$210000$!!!$!!!'), false);
  assert.equal(await verifyPassword('secret1234', null), false);
  assert.equal(await verifyPassword('secret1234', undefined), false);
});

test('konsistensi lintas-runtime: hash legacy 210000 (era lama, >100k) tetap valid via fallback pure-JS', async () => {
  const salt = randomBytes(16);
  const dk = pbkdf2Sync('secret1234', salt, 210000, 32, 'sha256');
  const stored = `pbkdf2$v1$210000$${b64encode(salt)}$${b64encode(new Uint8Array(dk))}`;
  assert.equal(await verifyPassword('secret1234', stored), true);
  assert.equal(await verifyPassword('wrong-pass', stored), false);
});

test('verify: hash 12000 (era baru) & hash legacy 210000 keduanya diterima', async () => {
  const stored = await hashPassword('secret1234');
  const salt = randomBytes(16);
  const dk = pbkdf2Sync('secret1234', salt, 210000, 32, 'sha256');
  const legacy = `pbkdf2$v1$210000$${b64encode(salt)}$${b64encode(new Uint8Array(dk))}`;
  assert.equal(await verifyPassword('secret1234', stored), true);
  assert.equal(await verifyPassword('secret1234', legacy), true);
  assert.equal(await verifyPassword('salah12345', stored), false);
  assert.equal(await verifyPassword('salah12345', legacy), false);
});

test('hashPassword: hash yang dibuat sama dengan PBKDF2 standar utk salt yg sama', async () => {
  const stored = await hashPassword('secret1234');
  const parts = stored.split('$');
  const salt = b64decode(parts[3]);
  const dk = pbkdf2Sync('secret1234', salt, Number(parts[2]), 32, 'sha256');
  assert.equal(parts[4], b64encode(new Uint8Array(dk)));
});

test('salt acak: password sama dua kali menghasilkan hash berbeda', async () => {
  const a = await hashPassword('secret1234');
  const b = await hashPassword('secret1234');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('secret1234', a), true);
  assert.equal(await verifyPassword('secret1234', b), true);
});

test('password < 8 karakter ditolak; iterasi 12000 selesai dalam batas wajar', async () => {
  await assert.rejects(hashPassword('short'), /PASSWORD_TOO_SHORT/);
  const t0 = Date.now();
  const stored = await hashPassword('longenough123');
  const elapsed = Date.now() - t0;
  assert.equal(await verifyPassword('longenough123', stored), true);
  assert.ok(elapsed < 5000, `12000 iterasi terlalu lama: ${elapsed}ms`);
});

test('randomToken: base64url tanpa padding, panjang default 43 char (32 byte)', () => {
  const t = randomToken();
  assert.equal(t.length, 43);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(t));
  assert.notEqual(t, randomToken());
});
