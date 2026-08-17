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

async function bootstrap() {
  const { env } = setupEnv();
  const adminId = await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  return { env, adminId, token };
}

// Sesi kemarin berstatus 'buka' dengan saldo awal + mutasi (belum closing).
async function seedPastOpenSession(env, adminId) {
  const res = await env.DB.prepare(
    "INSERT INTO kasir_sesi (tanggal, dibuka_oleh, dibuka_at, status) VALUES (?, ?, ?, 'buka')"
  ).bind(yesterdayWib(), adminId, new Date().toISOString()).run();
  const sesiId = res.meta.last_row_id;
  await env.DB.prepare(
    "INSERT INTO kasir_saldo (kasir_sesi_id, nama_akun, saldo_sistem, saldo_real, selisih, tipe, created_at) VALUES (?, 'Tunai Laci', 500000, 500000, 0, 'opening', ?)"
  ).bind(sesiId, new Date().toISOString()).run();
  await env.DB.prepare(
    "INSERT INTO mutasi_saldo (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, created_at) VALUES (?, 'Tunai Laci', 100000, 'penyesuaian', 1, ?, ?)"
  ).bind(sesiId, `adj:${sesiId}:1`, new Date().toISOString()).run();
  return sesiId;
}

test('GET /api/kasir/current?kasir_sesi_id=... mengembalikan data sesi lampau yang masih buka', async () => {
  const { env, adminId, token } = await bootstrap();
  const sesiId = await seedPastOpenSession(env, adminId);

  const r = await call(env, `/api/kasir/current?kasir_sesi_id=${sesiId}`, { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'buka');
  assert.equal(r.data.tanggal, yesterdayWib());
  assert.equal(r.data.kasir_sesi_id, sesiId);
  assert.equal(r.data.saldo.length, 1);
  assert.equal(r.data.saldo[0].saldo_sistem, 600000);
});

test('GET /api/kasir/current?tanggal=... (fallback date) mengembalikan status belum_buka bila tidak ada sesi', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, `/api/kasir/current?tanggal=${yesterdayWib()}`, { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'belum_buka');
  assert.equal(r.data.kasir_sesi_id, null);
});

test('Closing sesi lampau via kasir_sesi_id: rekonsiliasi + audit, tanpa mutasi baru', async () => {
  const { env, adminId, token } = await bootstrap();
  const sesiId = await seedPastOpenSession(env, adminId);

  const mutasiBefore = await env.DB.prepare('SELECT COUNT(*) AS n FROM mutasi_saldo').all();
  assert.equal(mutasiBefore.results[0].n, 1);

  const closeRes = await call(env, '/api/kasir/closing', {
    method: 'POST', token,
    body: { kasir_sesi_id: sesiId, saldo_real: [{ nama_akun: 'Tunai Laci', saldo_real: 610000 }], catatan_closing: 'koreksi sesi lampau' },
  });
  assert.equal(closeRes.status, 200);
  assert.equal(closeRes.data.status, 'tutup');
  assert.equal(closeRes.data.kasir_sesi_id, sesiId);
  assert.equal(closeRes.data.tanggal, yesterdayWib());
  const rec = closeRes.data.rekonsiliasi[0];
  assert.equal(rec.saldo_sistem, 600000);
  assert.equal(rec.saldo_real, 610000);
  assert.equal(rec.selisih, 10000);

  const mutasiAfter = await env.DB.prepare('SELECT COUNT(*) AS n FROM mutasi_saldo').all();
  assert.equal(mutasiAfter.results[0].n, 1, 'Closing sesi lampau TIDAK membuat mutasi baru');

  const sesi = await env.DB.prepare('SELECT * FROM kasir_sesi WHERE id = ?').bind(sesiId).first();
  assert.equal(sesi.status, 'tutup');
  assert.equal(sesi.catatan_closing, 'koreksi sesi lampau');

  const logs = await call(env, '/api/logs?aksi=closing', { token });
  assert.ok(logs.data.items.some((x) => x.aksi === 'closing' && String(x.record_id) === String(sesiId)));
});

test('Closing sesi lampau yang sudah tutup → 409, tanpa perubahan data', async () => {
  const { env, adminId, token } = await bootstrap();
  const sesiId = await seedPastOpenSession(env, adminId);
  await call(env, '/api/kasir/closing', {
    method: 'POST', token,
    body: { kasir_sesi_id: sesiId, saldo_real: [{ nama_akun: 'Tunai Laci', saldo_real: 600000 }] },
  });

  const r2 = await call(env, '/api/kasir/closing', {
    method: 'POST', token,
    body: { kasir_sesi_id: sesiId, saldo_real: [{ nama_akun: 'Tunai Laci', saldo_real: 500000 }] },
  });
  assert.equal(r2.status, 409);
  assert.equal(r2.data.error.code, 'session_closed');
});

test('Closing sesi tidak dikenal → 404; kasir_sesi_id tidak valid → 400', async () => {
  const { env, token } = await bootstrap();
  const r404 = await call(env, '/api/kasir/closing', {
    method: 'POST', token,
    body: { kasir_sesi_id: 999999, saldo_real: [{ nama_akun: 'Tunai Laci', saldo_real: 0 }] },
  });
  assert.equal(r404.status, 404);
  assert.equal(r404.data.error.code, 'session_not_found');

  const r400 = await call(env, '/api/kasir/closing', {
    method: 'POST', token,
    body: { kasir_sesi_id: 'abc', saldo_real: [{ nama_akun: 'Tunai Laci', saldo_real: 0 }] },
  });
  assert.equal(r400.status, 400);
});

test('Closing hari ini (tanpa kasir_sesi_id) tetap berjalan seperti biasa', async () => {
  const { env, token } = await bootstrap();
  const open = await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 500000 }] },
  });
  assert.equal(open.status, 200);

  const closeRes = await call(env, '/api/kasir/closing', {
    method: 'POST', token,
    body: { saldo_real: [{ nama_akun: 'Tunai Laci', saldo_real: 500000 }], catatan_closing: 'sesi hari ini' },
  });
  assert.equal(closeRes.status, 200);
  assert.equal(closeRes.data.status, 'tutup');
  assert.equal(closeRes.data.rekonsiliasi[0].selisih, 0);
});
