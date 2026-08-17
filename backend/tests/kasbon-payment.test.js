import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw } from './helpers.js';

async function bootstrap() {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 5000000 }] },
  });
  const pel = await call(env, '/api/pelanggan', { method: 'POST', token, body: { nama: 'Budi', telepon: '0812' } });
  return { env, token, pelangganId: pel.data.id };
}

async function buatKasbon(env, token, pelangganId, nominal) {
  const r = await call(env, '/api/kasbon', {
    method: 'POST', token,
    body: { pelanggan_id: pelangganId, nominal },
  });
  assert.equal(r.status, 200);
  return r.data;
}

test('kasbon payment: create punya terbayar 0 & sisa = nominal', async () => {
  const { env, token, pelangganId } = await bootstrap();
  const kb = await buatKasbon(env, token, pelangganId, 100000);
  assert.equal(kb.terbayar, 0);
  assert.equal(kb.sisa, 100000);
  assert.equal(kb.status, 'belum_lunas');
});

test('kasbon payment: list berisi terbayar & sisa', async () => {
  const { env, token, pelangganId } = await bootstrap();
  await buatKasbon(env, token, pelangganId, 50000);
  const list = await call(env, '/api/kasbon', { token });
  assert.equal(list.status, 200);
  const item = list.data.items[0];
  assert.equal(item.terbayar, 0);
  assert.equal(item.sisa, 50000);
});

test('kasbon payment sebagian: terbayar bertambah, status tetap belum_lunas, hist tercatat', async () => {
  const { env, token, pelangganId } = await bootstrap();
  const kb = await buatKasbon(env, token, pelangganId, 100000);
  const p = await call(env, `/api/kasbon/${kb.id}/payment`, {
    method: 'POST', token,
    body: { nominal: 40000, metode: 'tunai' },
  });
  assert.equal(p.status, 200);
  assert.equal(p.data.terbayar, 40000);
  assert.equal(p.data.sisa, 60000);
  assert.equal(p.data.status, 'belum_lunas');

  const hist = await env.DB.prepare('SELECT * FROM kasbon_pembayaran').all();
  assert.equal(hist.results.length, 1);
  assert.equal(hist.results[0].nominal, 40000);
  assert.equal(hist.results[0].metode, 'tunai');

  const list = await call(env, '/api/kasbon', { token });
  const item = list.data.items.find((x) => x.id === kb.id);
  assert.equal(item.terbayar, 40000);
  assert.equal(item.sisa, 60000);
  assert.equal(item.status, 'belum_lunas');
});

test('kasbon payment pelunasan: terbayar >= nominal -> status lunas', async () => {
  const { env, token, pelangganId } = await bootstrap();
  const kb = await buatKasbon(env, token, pelangganId, 100000);
  const p1 = await call(env, `/api/kasbon/${kb.id}/payment`, { method: 'POST', token, body: { nominal: 40000 } });
  assert.equal(p1.data.status, 'belum_lunas');
  const p2 = await call(env, `/api/kasbon/${kb.id}/payment`, { method: 'POST', token, body: { nominal: 60000 } });
  assert.equal(p2.data.status, 'lunas');
  assert.equal(p2.data.sisa, 0);
  assert.equal(p2.data.terbayar, 100000);

  const list = await call(env, '/api/kasbon', { token });
  const item = list.data.items.find((x) => x.id === kb.id);
  assert.equal(item.status, 'lunas');
  assert.equal(item.terbayar, 100000);
  assert.equal(item.sisa, 0);
});

test('kasbon payment dengan akun_id -> mutasi kasbon_pelunasan tercatat', async () => {
  const { env, token, pelangganId } = await bootstrap();
  const kb = await buatKasbon(env, token, pelangganId, 100000);
  const p = await call(env, `/api/kasbon/${kb.id}/payment`, {
    method: 'POST', token,
    body: { nominal: 40000, akun_id: 'Tunai Laci' },
  });
  assert.equal(p.status, 200);
  const mut = await env.DB.prepare("SELECT * FROM mutasi_saldo WHERE sumber_tipe = 'kasbon_pelunasan'").all();
  assert.equal(mut.results.length, 1);
  assert.equal(Number(mut.results[0].jumlah), 40000);
  assert.equal(mut.results[0].nama_akun, 'Tunai Laci');
});

test('kasbon payment: nominal 0/negatif ditolak', async () => {
  const { env, token, pelangganId } = await bootstrap();
  const kb = await buatKasbon(env, token, pelangganId, 50000);
  const bad = await call(env, `/api/kasbon/${kb.id}/payment`, { method: 'POST', token, body: { nominal: 0 } });
  assert.equal(bad.status, 400);
});

test('kasbon payment overpayment (> sisa) ditolak', async () => {
  const { env, token, pelangganId } = await bootstrap();
  const kb = await buatKasbon(env, token, pelangganId, 50000);
  await call(env, `/api/kasbon/${kb.id}/payment`, { method: 'POST', token, body: { nominal: 30000 } });
  const over = await call(env, `/api/kasbon/${kb.id}/payment`, { method: 'POST', token, body: { nominal: 30000 } });
  assert.equal(over.status, 400);
  assert.equal(over.data.error.code, 'overpayment');
});

test('kasbon payment saat sudah lunas ditolak (409)', async () => {
  const { env, token, pelangganId } = await bootstrap();
  const kb = await buatKasbon(env, token, pelangganId, 50000);
  await call(env, `/api/kasbon/${kb.id}/payment`, { method: 'POST', token, body: { nominal: 50000 } });
  const again = await call(env, `/api/kasbon/${kb.id}/payment`, { method: 'POST', token, body: { nominal: 10000 } });
  assert.equal(again.status, 409);
  assert.equal(again.data.error.code, 'already_lunas');
});

test('kasbon payment kasbon tidak ada -> 404', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/kasbon/99999/payment', { method: 'POST', token, body: { nominal: 10000 } });
  assert.equal(r.status, 404);
});

test('kasbon payment akun_id tidak valid -> 400 invalid_account (tanpa insert)', async () => {
  const { env, token, pelangganId } = await bootstrap();
  const kb = await buatKasbon(env, token, pelangganId, 50000);
  const r = await call(env, `/api/kasbon/${kb.id}/payment`, {
    method: 'POST', token,
    body: { nominal: 10000, akun_id: 'Tidak Ada' },
  });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, 'invalid_account');
  const hist = await env.DB.prepare('SELECT COUNT(*) AS n FROM kasbon_pembayaran').first('n');
  assert.equal(Number(hist), 0);
});

test('kasbon payment akun_id dengan sesi kasir belum buka -> 409 session_not_open', async () => {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  const pel = await call(env, '/api/pelanggan', { method: 'POST', token, body: { nama: 'Budi' } });
  const kb = await buatKasbon(env, token, pel.data.id, 50000);
  const r = await call(env, `/api/kasbon/${kb.id}/payment`, {
    method: 'POST', token,
    body: { nominal: 10000, akun_id: 'Tunai Laci' },
  });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'session_not_open');
});

test('PUT lunas setelah pembayaran sebagian: mutasi hanya sisa & terbayar jadi nominal', async () => {
  const { env, token, pelangganId } = await bootstrap();
  const kb = await buatKasbon(env, token, pelangganId, 100000);
  await call(env, `/api/kasbon/${kb.id}/payment`, { method: 'POST', token, body: { nominal: 40000, akun_id: 'Tunai Laci' } });

  const lun = await call(env, `/api/kasbon/${kb.id}`, {
    method: 'PUT', token,
    body: { status: 'lunas', akun: 'Tunai Laci' },
  });
  assert.equal(lun.status, 200);
  assert.equal(lun.data.terbayar, 100000);
  assert.equal(lun.data.sisa, 0);

  const mut = await env.DB.prepare("SELECT * FROM mutasi_saldo WHERE sumber_tipe = 'kasbon_pelunasan'").all();
  assert.equal(mut.results.length, 2);
  const total = mut.results.reduce((s, m) => s + Number(m.jumlah), 0);
  assert.equal(total, 100000);
});

test('service-hp: create & update menerima harga_modal (nullable)', async () => {
  const { env, token, pelangganId } = await bootstrap();
  const c = await call(env, '/api/service-hp', {
    method: 'POST', token,
    body: { pelanggan_id: pelangganId, nama_device: 'iPhone 11', deskripsi_kerusakan: 'LCD pecah', estimasi_biaya: 250000, harga_modal: 100000 },
  });
  assert.equal(c.status, 200);

  const list = await call(env, '/api/service-hp', { token });
  const item = list.data.items.find((x) => x.id === c.data.id);
  assert.equal(item.harga_modal, 100000);

  const up = await call(env, `/api/service-hp/${c.data.id}`, {
    method: 'PUT', token,
    body: { harga_modal: 120000, biaya: 300000 },
  });
  assert.equal(up.status, 200);
  assert.equal(up.data.data.harga_modal, 120000);

  const nul = await call(env, `/api/service-hp/${c.data.id}`, {
    method: 'PUT', token,
    body: { harga_modal: '' },
  });
  assert.equal(nul.status, 200);
  assert.equal(nul.data.data.harga_modal, null);
});

test('service-hp: create tanpa harga_modal -> NULL (tidak dipaksa 0)', async () => {
  const { env, token, pelangganId } = await bootstrap();
  const c = await call(env, '/api/service-hp', {
    method: 'POST', token,
    body: { pelanggan_id: pelangganId, nama_device: 'Xiaomi', deskripsi_kerusakan: 'Ganti baterai' },
  });
  assert.equal(c.status, 200);
  const list = await call(env, '/api/service-hp', { token });
  const item = list.data.items.find((x) => x.id === c.data.id);
  assert.equal(item.harga_modal, null);
});
