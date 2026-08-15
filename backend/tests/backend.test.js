import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, setPermission, createKategoriRaw, createProdukRaw } from './helpers.js';

async function bootstrap() {
  const { sqliteDb, env } = setupEnv();
  const adminId = await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const karyId = await createUserRaw(env, { nama: 'Karyawan A', username: 'karyawan', password: 'kary1234', role: 'karyawan' });
  const k1 = await createKategoriRaw(env, 'Fisik', 1);
  const k2 = await createKategoriRaw(env, 'Pulsa & Saldo', 0);
  const p1 = await createProdukRaw(env, { kode: 'P-001', nama: 'Toner', kategori_id: k1, harga: 100000, harga_modal: 70000, stok: 50 });
  const p2 = await createProdukRaw(env, { kode: 'P-002', nama: 'Pulsa 10rb', kategori_id: k2, harga: 12000 });
  const adminToken = await login(env, 'admin', 'admin1234');
  const karyToken = await login(env, 'karyawan', 'kary1234');
  return { sqliteDb, env, adminId, karyId, k1, k2, p1, p2, adminToken, karyToken };
}

async function openKasir(env, token, saldoAwal = [{ nama_akun: 'Tunai Laci', saldo: 500000 }, { nama_akun: 'SeaBank', saldo: 1000000 }]) {
  return call(env, '/api/kasir/opening', { method: 'POST', token, body: { saldo_awal: saldoAwal } });
}

test('login: admin & karyawan berhasil, password salah ditolak', async () => {
  const { env } = await bootstrap();
  const ok = await call(env, '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);
  assert.equal(ok.data.user.role, 'admin');

  const bad = await call(env, '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'salah' } });
  assert.equal(bad.status, 401);

  const noAuth = await call(env, '/api/kasir/current');
  assert.equal(noAuth.status, 401);
});

test('auth: token malformed (base64 length invalid) ditolak 401 bukan 500', async () => {
  const { env } = await bootstrap();
  const res = await call(env, '/api/kasir/current', { token: 'not.a.token' });
  assert.equal(res.status, 401);
  const res2 = await call(env, '/api/auth/me', { token: 'aaaa.bbbb.zzzzz' });
  assert.equal(res2.status, 401);
});

test('permission: karyawan default tidak boleh akses laporan/pengaturan, admin boleh', async () => {
  const { env, karyToken, adminToken } = await bootstrap();
  const k = await call(env, '/api/logs', { token: karyToken });
  assert.equal(k.status, 403);
  const a = await call(env, '/api/logs', { token: adminToken });
  assert.equal(a.status, 200);
});

test('permission: memberi halaman gaji_karyawan ke karyawan ditolak (hard rule)', async () => {
  const { env, adminToken, karyId } = await bootstrap();
  const r = await call(env, `/api/users/${karyId}/permissions`, {
    method: 'PUT', token: adminToken, body: { halaman: ['transaksi', 'gaji_karyawan'] },
  });
  assert.equal(r.status, 403);
});

test('kasir opening: sekali per hari, saldo awal tercatat, opening ganda ditolak', async () => {
  const { env, adminToken } = await bootstrap();
  const o1 = await openKasir(env, adminToken);
  assert.equal(o1.status, 200);
  assert.equal(o1.data.status, 'buka');

  const cur = await call(env, '/api/kasir/current', { token: adminToken });
  assert.equal(cur.data.status, 'buka');
  assert.equal(cur.data.saldo.length, 2);

  const o2 = await openKasir(env, adminToken);
  assert.equal(o2.status, 409);
});

test('Transaksi Tunai -> 1 transaksi + 1 mutasi +100000 ke Tunai Laci', async () => {
  const { env, adminToken, p1 } = await bootstrap();
  await openKasir(env, adminToken);
  const tx = await call(env, '/api/transaksi', {
    method: 'POST', token: adminToken,
    body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'tunai' },
  });
  assert.equal(tx.status, 200);
  assert.match(tx.data.id, /^TX-\d{8}-\d{3}$/);
  assert.equal(tx.data.total, 100000);

  const mut = await env.DB.prepare("SELECT * FROM mutasi_saldo WHERE sumber_tipe = 'transaksi'").all();
  assert.equal(mut.results.length, 1);
  assert.equal(mut.results[0].nama_akun, 'Tunai Laci');
  assert.equal(mut.results[0].jumlah, 100000);
});

test('Transaksi Transfer -> 1 mutasi +200000 ke akun penerima', async () => {
  const { env, adminToken, p1 } = await bootstrap();
  await openKasir(env, adminToken);
  const tx = await call(env, '/api/transaksi', {
    method: 'POST', token: adminToken,
    body: { items: [{ produk_id: p1, qty: 2 }], metode_bayar: 'transfer', akun_penerima: 'SeaBank' },
  });
  assert.equal(tx.status, 200);
  assert.equal(tx.data.konfirmasi_pembayaran, 'menunggu');
  const mut = await env.DB.prepare("SELECT * FROM mutasi_saldo WHERE sumber_tipe = 'transaksi'").all();
  assert.equal(mut.results.length, 1);
  assert.equal(mut.results[0].nama_akun, 'SeaBank');
  assert.equal(mut.results[0].jumlah, 200000);
});

test('Pengeluaran Transfer -> 1 mutasi -50000 SeaBank', async () => {
  const { env, adminToken } = await bootstrap();
  await openKasir(env, adminToken);
  const r = await call(env, '/api/pengeluaran', {
    method: 'POST', token: adminToken,
    body: { deskripsi: 'Beli sparepart LCD', nominal: 50000, metode_bayar: 'transfer', akun_sumber: 'SeaBank' },
  });
  assert.equal(r.status, 200);
  const mut = await env.DB.prepare("SELECT * FROM mutasi_saldo WHERE sumber_tipe = 'pengeluaran'").all();
  assert.equal(mut.results.length, 1);
  assert.equal(mut.results[0].jumlah, -50000);
  assert.equal(mut.results[0].nama_akun, 'SeaBank');
});

test('Pengeluaran Tunai -> 1 mutasi -15000 Tunai Laci', async () => {
  const { env, adminToken } = await bootstrap();
  await openKasir(env, adminToken);
  const r = await call(env, '/api/pengeluaran', {
    method: 'POST', token: adminToken,
    body: { deskripsi: 'Ongkir', nominal: 15000, metode_bayar: 'tunai', akun_sumber: 'Tunai Laci' },
  });
  assert.equal(r.status, 200);
  const mut = await env.DB.prepare("SELECT * FROM mutasi_saldo WHERE sumber_tipe = 'pengeluaran'").all();
  assert.equal(mut.results.length, 1);
  assert.equal(mut.results[0].jumlah, -15000);
});

test('Idempotensi: request sama dua kali (Idempotency-Key) -> 1 transaksi + 1 mutasi', async () => {
  const { env, adminToken, p1 } = await bootstrap();
  await openKasir(env, adminToken);
  const headers = { 'Idempotency-Key': 'dup-test-001' };
  const r1 = await call(env, '/api/transaksi', {
    method: 'POST', token: adminToken, headers,
    body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'tunai' },
  });
  const r2 = await call(env, '/api/transaksi', {
    method: 'POST', token: adminToken, headers,
    body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'tunai' },
  });
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r2.data.duplicate, true);
  const txCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM transaksi').all();
  assert.equal(txCount.results[0].n, 1);
  const mutCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM mutasi_saldo').all();
  assert.equal(mutCount.results[0].n, 1);
});

test('Closing: saldo_sistem = opening + mutasi, tidak ada mutasi kedua', async () => {
  const { env, adminToken, p1 } = await bootstrap();
  const openRes = await openKasir(env, adminToken, [{ nama_akun: 'Tunai Laci', saldo: 500000 }]);
  assert.equal(openRes.status, 200);

  await call(env, '/api/transaksi', {
    method: 'POST', token: adminToken,
    body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'tunai' },
  });
  await call(env, '/api/pengeluaran', {
    method: 'POST', token: adminToken,
    body: { deskripsi: 'Ongkir', nominal: 15000, metode_bayar: 'tunai', akun_sumber: 'Tunai Laci' },
  });

  const mutBefore = await env.DB.prepare('SELECT COUNT(*) AS n FROM mutasi_saldo').all();
  assert.equal(mutBefore.results[0].n, 2);

  const closeRes = await call(env, '/api/kasir/closing', {
    method: 'POST', token: adminToken,
    body: { saldo_real: [{ nama_akun: 'Tunai Laci', saldo_real: 500000 + 100000 - 15000 }], catatan_closing: 'ok' },
  });
  assert.equal(closeRes.status, 200);
  assert.equal(closeRes.data.status, 'tutup');
  const rec = closeRes.data.rekonsiliasi[0];
  assert.equal(rec.saldo_sistem, 500000 + 100000 - 15000);

  const mutAfter = await env.DB.prepare('SELECT COUNT(*) AS n FROM mutasi_saldo').all();
  assert.equal(mutAfter.results[0].n, 2, 'Closing TIDAK boleh membuat mutasi kedua');

  const cur = await call(env, '/api/kasir/current', { token: adminToken });
  assert.equal(cur.data.status, 'tutup');
});

test('Soft-delete transaksi -> reversal, saldo kembali ke posisi awal', async () => {
  const { env, adminToken, p1 } = await bootstrap();
  await openKasir(env, adminToken);
  const tx = await call(env, '/api/transaksi', {
    method: 'POST', token: adminToken,
    body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'tunai' },
  });
  const txId = tx.data.id;
  const orig = await env.DB.prepare("SELECT * FROM mutasi_saldo WHERE sumber_tipe = 'transaksi'").all();

  const del = await call(env, `/api/transaksi/${txId}`, {
    method: 'DELETE', token: adminToken, body: { deleted_reason: 'salah catat' },
  });
  assert.equal(del.status, 200);
  assert.equal(del.data.status, 'soft_deleted');

  const cur = await call(env, '/api/kasir/current', { token: adminToken });
  const tunai = cur.data.saldo.find((s) => s.nama_akun === 'Tunai Laci');
  assert.equal(tunai.saldo_sistem, 500000, 'setelah reversal saldo sistem kembali 500000');
  assert.ok(orig.results[0].mutation_key);
});

test('Filter transaksi per tanggal (WIB): total_nilai benar', async () => {
  const { env, adminToken, p1 } = await bootstrap();
  await openKasir(env, adminToken);
  await call(env, '/api/transaksi', {
    method: 'POST', token: adminToken,
    body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'tunai' },
  });
  await call(env, '/api/transaksi', {
    method: 'POST', token: adminToken,
    body: { items: [{ produk_id: p1, qty: 2 }], metode_bayar: 'tunai' },
  });

  const date = new Date().toISOString().slice(0, 10);
  const todayWib = new Date(new Date().getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const r = await call(env, `/api/transaksi?date=${todayWib}`, { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.data.total_items, 2);
  assert.equal(r.data.total_nilai, 300000);
  assert.ok(r.data.items.length === 2);
});

test('Kasbon lunas -> 1 mutasi pelunasan', async () => {
  const { env, adminToken, p1 } = await bootstrap();
  await openKasir(env, adminToken);
  const pel = await call(env, '/api/pelanggan', { method: 'POST', token: adminToken, body: { nama: 'Budi' } });
  const kb = await call(env, '/api/kasbon', {
    method: 'POST', token: adminToken,
    body: { pelanggan_id: pel.data.id, nominal: 50000 },
  });
  const lun = await call(env, `/api/kasbon/${kb.data.id}`, {
    method: 'PUT', token: adminToken, body: { status: 'lunas' },
  });
  assert.equal(lun.status, 200);
  const mut = await env.DB.prepare("SELECT * FROM mutasi_saldo WHERE sumber_tipe = 'kasbon_pelunasan'").all();
  assert.equal(mut.results.length, 1);
  assert.equal(mut.results[0].jumlah, 50000);
});

test('Audit log tercatat untuk aksi finansial', async () => {
  const { env, adminToken, p1 } = await bootstrap();
  await openKasir(env, adminToken);
  await call(env, '/api/transaksi', {
    method: 'POST', token: adminToken,
    body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'tunai' },
  });
  const logs = await call(env, '/api/logs', { token: adminToken });
  assert.equal(logs.status, 200);
  assert.ok(logs.data.items.length >= 1);
  assert.ok(logs.data.items.some((l) => l.tabel_terkait === 'transaksi' && l.aksi === 'create'));
});

test('Gaji karyawan: admin only; nominal tidak bocor ke karyawan', async () => {
  const { env, adminToken, karyToken, karyId } = await bootstrap();
  const r1 = await call(env, '/api/gaji', { token: karyToken });
  assert.equal(r1.status, 403);

  await call(env, '/api/gaji/rate', {
    method: 'POST', token: adminToken,
    body: { user_id: karyId, tipe: 'flat', rate_flat: 75000 },
  });
  const g = await call(env, '/api/gaji', { token: adminToken });
  assert.equal(g.status, 200);
});

test('R1: createGajiManual buat baru (user+tanggal belum ada)', async () => {
  const { env, adminToken, karyId } = await bootstrap();
  const r = await call(env, '/api/gaji', {
    method: 'POST', token: adminToken,
    body: { user_id: karyId, tanggal: '2026-08-14', nominal: 80000 },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.sumber, 'manual_edit');
  assert.equal(r.data.nominal, 80000);

  const list = await call(env, `/api/gaji?user_id=${karyId}&tanggal=2026-08-14`, { token: adminToken });
  assert.equal(list.status, 200);
  assert.equal(list.data.items.length, 1);
});

test('R1: createGajiManual conflict dengan auto-input tidak 500 (UPSERT)', async () => {
  const { env, adminToken, karyId } = await bootstrap();
  await env.DB.prepare(
    `INSERT INTO gaji_harian (user_id, tanggal, nominal, sumber, created_at)
     VALUES (?, ?, ?, 'auto', ?)`
  ).bind(karyId, '2026-08-14', 75000, new Date().toISOString()).run();

  const r = await call(env, '/api/gaji', {
    method: 'POST', token: adminToken,
    body: { user_id: karyId, tanggal: '2026-08-14', nominal: 95000, catatan: 'lembur' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.sumber, 'manual_edit');
  assert.equal(r.data.nominal, 95000);

  const rows = await env.DB.prepare(
    'SELECT id, nominal, sumber, catatan, diedit_oleh FROM gaji_harian WHERE user_id = ? AND tanggal = ?'
  ).bind(karyId, '2026-08-14').all();
  assert.equal(rows.results.length, 1);
  const row = rows.results[0];
  assert.equal(row.nominal, 95000);
  assert.equal(row.sumber, 'manual_edit');
  assert.equal(row.catatan, 'lembur');
  assert.ok(row.diedit_oleh != null);
});

test('R1: createGajiManual non-admin ditolak 403', async () => {
  const { env, karyToken, karyId } = await bootstrap();
  const r = await call(env, '/api/gaji', {
    method: 'POST', token: karyToken,
    body: { user_id: karyId, tanggal: '2026-08-14', nominal: 80000 },
  });
  assert.equal(r.status, 403);
});

test('R1: createGajiManual target user bukan karyawan ditolak 400', async () => {
  const { env, adminToken, adminId } = await bootstrap();
  const r = await call(env, '/api/gaji', {
    method: 'POST', token: adminToken,
    body: { user_id: adminId, tanggal: '2026-08-14', nominal: 80000 },
  });
  assert.equal(r.status, 400);
});

async function makeKirimUangSvc(env, kategoriId, harga = 5000) {
  return createProdukRaw(env, { kode: `S-KIRIM-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, nama: 'Kirim Uang', kategori_id: kategoriId, harga });
}

async function netKirimUangMutasi(env, kode) {
  const res = await env.DB.prepare(
    `SELECT nama_akun, SUM(jumlah) AS net FROM mutasi_saldo
      WHERE (sumber_tipe='transaksi' OR sumber_tipe='reversal')
        AND sumber_id=(SELECT id FROM transaksi WHERE kode_transaksi=?)
      GROUP BY nama_akun`
  ).bind(kode).all();
  return res.results;
}

test('R2: kirim uang tunai — fee tidak double-count ke Tunai Laci', async () => {
  const { env, adminToken, k2 } = await bootstrap();
  await openKasir(env, adminToken);
  const svc = await makeKirimUangSvc(env, k2, 5000);
  const nominal = 100000;
  const fee = 5000;
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token: adminToken,
    body: { items: [{ produk_id: svc, qty: 1, nominal_referensi: nominal, akun_sumber: 'SeaBank' }], metode_bayar: 'tunai' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.total, fee);

  const rows = await netKirimUangMutasi(env, r.data.id);
  const tunai = rows.find((m) => m.nama_akun === 'Tunai Laci');
  const dest = rows.find((m) => m.nama_akun === 'SeaBank');
  assert.ok(tunai, 'Tunai Laci harus ada');
  assert.equal(tunai.net, nominal + fee);
  assert.ok(dest, 'akun_sumber harus ada');
  assert.equal(dest.net, -nominal);
});

test('R2: kirim uang cash_tunai — fee tidak double-count', async () => {
  const { env, adminToken, k2 } = await bootstrap();
  await openKasir(env, adminToken);
  const svc = await makeKirimUangSvc(env, k2, 5000);
  const nominal = 100000;
  const fee = 5000;
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token: adminToken,
    body: { items: [{ produk_id: svc, qty: 1, nominal_referensi: nominal, akun_sumber: 'SeaBank' }], metode_bayar: 'cash_tunai' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.total, fee);

  const rows = await netKirimUangMutasi(env, r.data.id);
  const tunai = rows.find((m) => m.nama_akun === 'Tunai Laci');
  const dest = rows.find((m) => m.nama_akun === 'SeaBank');
  assert.equal(tunai.net, nominal + fee);
  assert.equal(dest.net, -nominal);
});

test('R2: kirim uang idempotency — retry tidak menambah mutasi', async () => {
  const { env, adminToken, k2 } = await bootstrap();
  await openKasir(env, adminToken);
  const svc = await makeKirimUangSvc(env, k2, 5000);
  const key = 'rk-r2-idem-001';
  const body = { items: [{ produk_id: svc, qty: 1, nominal_referensi: 100000, akun_sumber: 'SeaBank' }], metode_bayar: 'tunai' };
  const r1 = await call(env, '/api/transaksi', { method: 'POST', token: adminToken, body, headers: { 'Idempotency-Key': key } });
  assert.equal(r1.status, 200);
  const cnt1 = await env.DB.prepare("SELECT COUNT(*) AS n FROM mutasi_saldo WHERE sumber_tipe='transaksi'").all();
  const r2 = await call(env, '/api/transaksi', { method: 'POST', token: adminToken, body, headers: { 'Idempotency-Key': key } });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.duplicate, true);
  assert.equal(r2.data.id, r1.data.id);
  const cnt2 = await env.DB.prepare("SELECT COUNT(*) AS n FROM mutasi_saldo WHERE sumber_tipe='transaksi'").all();
  assert.equal(cnt2.results[0].n, cnt1.results[0].n);
});

test('R2: update transaksi kirim uang — fee tidak double-count', async () => {
  const { env, adminToken, k2 } = await bootstrap();
  await openKasir(env, adminToken);
  const svc = await makeKirimUangSvc(env, k2, 5000);
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token: adminToken,
    body: { items: [{ produk_id: svc, qty: 1, nominal_referensi: 100000, akun_sumber: 'SeaBank' }], metode_bayar: 'tunai' },
  });
  assert.equal(r.status, 200);

  const u = await call(env, `/api/transaksi/${r.data.id}`, {
    method: 'PUT', token: adminToken,
    body: { items: [{ produk_id: svc, qty: 1, nominal_referensi: 200000, akun_sumber: 'SeaBank' }], metode_bayar: 'tunai' },
  });
  assert.equal(u.status, 200);
  assert.equal(u.data.total, 5000);

  const rows = await netKirimUangMutasi(env, r.data.id);
  const tunai = rows.find((m) => m.nama_akun === 'Tunai Laci');
  const dest = rows.find((m) => m.nama_akun === 'SeaBank');
  assert.equal(tunai.net, 200000 + 5000);
  assert.equal(dest.net, -200000);
});

async function getKasbonForTx(env, kode) {
  const res = await env.DB.prepare(
    `SELECT k.* FROM kasbon k JOIN transaksi t ON t.id = k.transaksi_id WHERE t.kode_transaksi = ?`
  ).bind(kode).all();
  return res.results;
}

async function createBonTx(env, adminToken, pel, produkId, qty, tanggal = undefined) {
  const body = { items: [{ produk_id: produkId, qty }], metode_bayar: 'bon', pelanggan_id: pel };
  if (tanggal !== undefined) body.tanggal_transaksi = tanggal;
  return call(env, '/api/transaksi', { method: 'POST', token: adminToken, body });
}

async function updateBonTx(env, adminToken, kode, produkId, qty, tanggal = undefined) {
  const body = { items: [{ produk_id: produkId, qty }], metode_bayar: 'bon' };
  if (tanggal !== undefined) body.tanggal_transaksi = tanggal;
  return call(env, `/api/transaksi/${kode}`, { method: 'PUT', token: adminToken, body });
}

test('R3: create bon -> kasbon nominal = total, status belum_lunas', async () => {
  const { env, adminToken, p1 } = await bootstrap();
  await openKasir(env, adminToken);
  const pel = await call(env, '/api/pelanggan', { method: 'POST', token: adminToken, body: { nama: 'Budi R3' } });
  const r = await createBonTx(env, adminToken, pel.data.id, p1, 1); // harga p1 = 100000
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 100000);

  const kb = await getKasbonForTx(env, r.data.id);
  assert.equal(kb.length, 1);
  assert.equal(kb[0].nominal, 100000);
  assert.equal(kb[0].status, 'belum_lunas');
});

test('R3: update bon 100k -> 150k, nominal kasbon ikut', async () => {
  const { env, adminToken, p1, k1 } = await bootstrap();
  await openKasir(env, adminToken);
  const pel = await call(env, '/api/pelanggan', { method: 'POST', token: adminToken, body: { nama: 'Budi R3b' } });
  const p150 = await createProdukRaw(env, { kode: `P-150-${Date.now()}`, nama: 'Item 150k', kategori_id: k1, harga: 150000 });
  const r = await createBonTx(env, adminToken, pel.data.id, p1, 1); // total 100000
  const u = await updateBonTx(env, adminToken, r.data.id, p150, 1); // total 150000
  assert.equal(u.status, 200);
  assert.equal(u.data.total, 150000);
  const kb = await getKasbonForTx(env, r.data.id);
  assert.equal(kb.length, 1);
  assert.equal(kb[0].nominal, 150000);
  assert.equal(kb[0].status, 'belum_lunas');
});

test('R3: update bon 100k -> 50k, nominal kasbon turun', async () => {
  const { env, adminToken, p1, k1 } = await bootstrap();
  await openKasir(env, adminToken);
  const pel = await call(env, '/api/pelanggan', { method: 'POST', token: adminToken, body: { nama: 'Budi R3c' } });
  const p50 = await createProdukRaw(env, { kode: `P-50-${Date.now()}`, nama: 'Item 50k', kategori_id: k1, harga: 50000 });
  const r = await createBonTx(env, adminToken, pel.data.id, p1, 1); // total 100000
  const u = await updateBonTx(env, adminToken, r.data.id, p50, 1); // total 50000
  assert.equal(u.status, 200);
  assert.equal(u.data.total, 50000);
  const kb = await getKasbonForTx(env, r.data.id);
  assert.equal(kb.length, 1);
  assert.equal(kb[0].nominal, 50000);
});

test('R3: update tanggal saja -> tanggal kasbon ikut, nominal tetap', async () => {
  const { env, adminToken, p1 } = await bootstrap();
  await openKasir(env, adminToken);
  const pel = await call(env, '/api/pelanggan', { method: 'POST', token: adminToken, body: { nama: 'Budi R3d' } });
  const r = await createBonTx(env, adminToken, pel.data.id, p1, 1);
  const oldDate = (await getKasbonForTx(env, r.data.id))[0].tanggal;
  const newDate = '2026-08-01';
  const u = await updateBonTx(env, adminToken, r.data.id, p1, 1, newDate);
  assert.equal(u.status, 200);
  assert.notEqual(newDate, oldDate);
  const kb = await getKasbonForTx(env, u.data.id);
  assert.equal(kb.length, 1);
  assert.equal(kb[0].tanggal, newDate);
  assert.equal(kb[0].nominal, 100000);
});

test('R3: update nominal + tanggal -> keduanya sinkron', async () => {
  const { env, adminToken, p1, k1 } = await bootstrap();
  await openKasir(env, adminToken);
  const pel = await call(env, '/api/pelanggan', { method: 'POST', token: adminToken, body: { nama: 'Budi R3e' } });
  const p150 = await createProdukRaw(env, { kode: `P-150-${Date.now()}`, nama: 'Item 150k', kategori_id: k1, harga: 150000 });
  const r = await createBonTx(env, adminToken, pel.data.id, p1, 1); // total 100000
  const newDate = '2026-08-01';
  const u = await updateBonTx(env, adminToken, r.data.id, p150, 1, newDate); // total 150000 + tanggal baru
  assert.equal(u.status, 200);
  assert.equal(u.data.total, 150000);
  const kb = await getKasbonForTx(env, u.data.id);
  assert.equal(kb.length, 1);
  assert.equal(kb[0].nominal, 150000);
  assert.equal(kb[0].tanggal, newDate);
});

test('R3: update transaksi non-bon tidak membuat kasbon', async () => {
  const { env, adminToken, p1 } = await bootstrap();
  await openKasir(env, adminToken);
  const r = await call(env, '/api/transaksi', {
    method: 'POST', token: adminToken,
    body: { items: [{ produk_id: p1, qty: 1 }], metode_bayar: 'tunai' },
  });
  assert.equal(r.status, 200);
  const u = await call(env, `/api/transaksi/${r.data.id}`, {
    method: 'PUT', token: adminToken,
    body: { items: [{ produk_id: p1, qty: 2 }], metode_bayar: 'tunai' },
  });
  assert.equal(u.status, 200);
  const kb = await getKasbonForTx(env, r.data.id);
  assert.equal(kb.length, 0);
});

test('R3: update bon status lunas -> nominal kasbon tidak berubah', async () => {
  const { env, adminToken, p1 } = await bootstrap();
  await openKasir(env, adminToken);
  const pel = await call(env, '/api/pelanggan', { method: 'POST', token: adminToken, body: { nama: 'Budi R3f' } });
  const r = await createBonTx(env, adminToken, pel.data.id, p1, 1);
  const kb0 = await getKasbonForTx(env, r.data.id);
  await call(env, `/api/kasbon/${kb0[0].id}`, { method: 'PUT', token: adminToken, body: { status: 'lunas' } });

  const u = await updateBonTx(env, adminToken, r.data.id, p1, 4); // total jadi 400000
  assert.equal(u.status, 200);
  assert.equal(u.data.total, 400000);
  const kb = await getKasbonForTx(env, r.data.id);
  assert.equal(kb.length, 1);
  assert.equal(kb[0].status, 'lunas');
  assert.equal(kb[0].nominal, 100000);
});