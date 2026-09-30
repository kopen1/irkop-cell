import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, setPermission, sisipSesiTanggal } from './helpers.js';

function todayWib() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

async function setup() {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  return { env, token, adminId: 1 };
}

const buat = (env, nama, username, role = 'karyawan') =>
  createUserRaw(env, { nama, username, password: `${username}1234`, role });

test('Users: user tanpa riwayat bisa dihapus permanen', async () => {
  const { env, token } = await setup();
  const id = await buat(env, 'User Sampah', 'sampah');

  const r = await call(env, `/api/users/${id}`, { method: 'DELETE', token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.message, /dihapus/);

  const list = await call(env, '/api/users', { token });
  assert.equal(list.data.items.length, 1, 'hanya admin yang tersisa');
});

test('Users: konfigurasi saja (porsi + rate + permission) tidak menghalangi hapus', async () => {
  const { env, token } = await setup();
  const id = await buat(env, 'Belum Kerja', 'belumkerja');
  await call(env, '/api/gaji/bagi-hasil', { method: 'POST', token, body: { user_id: id, persen: 30 } });
  await call(env, `/api/permissions/${id}`, { method: 'PUT', token, body: { halaman: ['transaksi'] } });

  const r = await call(env, `/api/users/${id}`, { method: 'DELETE', token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test('Users: user yang sudah buka kasir tidak bisa dihapus (riwayat harus utuh)', async () => {
  const { env, token, adminId } = await setup();
  const id = await buat(env, 'Yang Buka Kasir', 'bukakasir');
  void adminId;
  await sisipSesiTanggal(env, id, todayWib(), { status: 'tutup', saldo: 500000 });

  const r = await call(env, `/api/users/${id}`, { method: 'DELETE', token });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.error.code, 'user_has_history');
  assert.match(r.data.error.message, /kasir_sesi/);
  assert.match(r.data.error.message, /Nonaktifkan/);
});

test('Users: user yang sudah buat transaksi tidak bisa dihapus', async () => {
  const { env, token } = await setup();
  const id = await buat(env, 'Kasir Transaksi', 'kasirtrx');
  await setPermission(env, id, 'kasir');
  await setPermission(env, id, 'transaksi');
  await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 5000000 }] },
  });

  // Karyawan ini yang mencatat transaksi -> transaksi.dibuat_oleh = id
  const kToken = await login(env, 'kasirtrx', 'kasirtrx1234');
  const trx = await call(env, '/api/transaksi', {
    method: 'POST', token: kToken, headers: { 'Idempotency-Key': 'trx-user-histori' },
    body: {
      jenis: 'service', metode_bayar: 'tunai', items: [],
      service: {
        nama_device: 'iPhone', deskripsi_kerusakan: 'Ganti LCD', biaya: 300000,
        harga_modal: 100000, tanggal_masuk: todayWib(),
      },
    },
  });
  assert.equal(trx.status, 200, JSON.stringify(trx.data));
  const dibuat = await env.DB.prepare('SELECT dibuat_oleh FROM transaksi ORDER BY id DESC').first();
  assert.equal(Number(dibuat.dibuat_oleh), id, 'transaksi tercatat atas nama user ini');

  const r = await call(env, `/api/users/${id}`, { method: 'DELETE', token });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.error.code, 'user_has_history');
  assert.match(r.data.error.message, /transaksi/);
  assert.match(r.data.error.message, /Nonaktifkan/);
});

test('Users: tidak bisa menghapus akun sendiri', async () => {
  const { env, token } = await setup();
  const r = await call(env, '/api/users/1', { method: 'DELETE', token });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.error.code, 'cannot_delete_self');
});

test('Users: admin aktif terakhir tidak bisa dinonaktifkan (anti terkunci dari sistem)', async () => {
  const { env, token } = await setup();

  // Hanya ada satu admin aktif: tidak boleh dimatikan.
  const diri = await call(env, '/api/users/1', { method: 'PUT', token, body: { aktif: false } });
  assert.equal(diri.status, 400, JSON.stringify(diri.data));
  assert.equal(diri.data.error.code, 'last_admin');

  // Ada admin lain -> yang ini boleh dinonaktifkan.
  const admin2 = await buat(env, 'Admin Dua', 'admindua', 'admin');
  const ok = await call(env, `/api/users/${admin2}`, { method: 'PUT', token, body: { aktif: false } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));

  // Setelah admin2 nonaktif, admin utama jadi satu-satunya -> terkunci lagi.
  const terkunci = await call(env, '/api/users/1', { method: 'PUT', token, body: { aktif: false } });
  assert.equal(terkunci.status, 400, JSON.stringify(terkunci.data));
  assert.equal(terkunci.data.error.code, 'last_admin');
});

test('Users: admin aktif terakhir tidak bisa dihapus', async () => {
  const { env, token } = await setup();
  const admin2 = await buat(env, 'Admin Dua', 'admindua', 'admin');
  await call(env, `/api/users/${admin2}`, { method: 'PUT', token, body: { aktif: false } });

  const r = await call(env, `/api/users/${admin2}`, { method: 'DELETE', token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.message, /dihapus/);
});

test('Users: nonaktifkan lewat PUT, dan hilang dari daftar teknisi', async () => {
  const { env, token } = await setup();
  const id = await buat(env, 'Teknisi Pensiun', 'teknisipensiun');

  const before = await call(env, '/api/gaji/teknisi', { token });
  assert.ok(before.data.items.some((u) => u.id === id), 'masuk daftar teknisi saat aktif');

  const upd = await call(env, `/api/users/${id}`, { method: 'PUT', token, body: { aktif: false } });
  assert.equal(upd.status, 200, JSON.stringify(upd.data));

  const after = await call(env, '/api/gaji/teknisi', { token });
  assert.ok(!after.data.items.some((u) => u.id === id), 'hilang dari daftar teknisi setelah dinonaktifkan');

  const list = await call(env, '/api/users', { token });
  const row = list.data.items.find((u) => u.id === id);
  assert.ok(row, 'masih ada di daftar user (riwayat tersimpan)');
  assert.equal(Number(row.aktif), 0);
});

test('Users: hanya admin boleh menghapus user', async () => {
  const { env, token } = await setup();
  const id = await buat(env, 'Karyawan Biasa', 'karyawanbiasa');
  const kToken = await login(env, 'karyawanbiasa', 'karyawanbiasa1234');

  const r = await call(env, `/api/users/${id}`, { method: 'DELETE', token: kToken });
  assert.equal(r.status, 403, JSON.stringify(r.data));
});
