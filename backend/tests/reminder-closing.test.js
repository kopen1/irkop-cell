import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw } from './helpers.js';

function wibNow() {
  return new Date(new Date().getTime() + 7 * 3600 * 1000);
}
function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function yesterdayWib() {
  return ymd(new Date(wibNow().getTime() - 24 * 3600 * 1000));
}
function twoDaysAgoWib() {
  return ymd(new Date(wibNow().getTime() - 48 * 3600 * 1000));
}

async function bootstrapReminder() {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  return { env, token };
}

test('Reminder: ada sesi buka hari lampau → perlu_diingatkan + audit', async () => {
  const { env, token } = await bootstrapReminder();
  const admin = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind('admin').first('id');
  await env.DB.prepare(
    "INSERT INTO kasir_sesi (tanggal, dibuka_oleh, dibuka_at, status) VALUES (?, ?, ?, 'buka')"
  ).bind(yesterdayWib(), admin, new Date().toISOString()).run();

  const r = await call(env, '/api/kasir/reminder-closing', { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.tanggal, ymd(wibNow()));
  assert.equal(r.data.perlu_diingatkan, true);
  assert.ok(r.data.sesi_buka_lampau.some((s) => s.tanggal === yesterdayWib()));

  const logs = await call(env, '/api/logs?aksi=reminder_closing', { token });
  assert.ok(logs.data.items.some((x) => x.aksi === 'reminder_closing'));
});

test('Reminder: semua sesi sudah closing / tidak ada sesi lampau → false, tanpa audit', async () => {
  const { env, token } = await bootstrapReminder();
  const r = await call(env, '/api/kasir/reminder-closing', { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.perlu_diingatkan, false);
  assert.equal(r.data.sesi_buka_lampau.length, 0);
});

test('Reminder: sesi yang sudah tutup tidak diingatkan', async () => {
  const { env, token } = await bootstrapReminder();
  const admin = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind('admin').first('id');
  await env.DB.prepare(
    "INSERT INTO kasir_sesi (tanggal, dibuka_oleh, dibuka_at, ditutup_oleh, ditutup_at, status, catatan_closing) VALUES (?, ?, ?, ?, ?, 'tutup', ?)"
  ).bind(twoDaysAgoWib(), admin, new Date().toISOString(), admin, new Date().toISOString(), 'ok').run();

  const r = await call(env, '/api/kasir/reminder-closing', { token });
  assert.equal(r.data.perlu_diingatkan, false);
});