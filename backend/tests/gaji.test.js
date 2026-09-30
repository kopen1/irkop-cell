import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw, setPermission } from './helpers.js';

// ITEM 12 — Gaji Auto + Manual: tidak boleh ada double-pay.
// Invariant inti: UNIQUE(user_id, tanggal) → per user per tanggal TEPAT SATU baris
// gaji_harian, apa pun urutan auto (kasir opening) vs manual (createGajiManual).

function wibNow() {
  return new Date(new Date().getTime() + 7 * 3600 * 1000);
}
function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function todayWib() {
  return ymd(wibNow());
}

async function setup() {
  const { env } = setupEnv();
  const adminId = await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const karyawanId = await createUserRaw(env, { nama: 'Karyawan', username: 'kry', password: 'kry12345', role: 'karyawan' });
  await setPermission(env, karyawanId, 'kasir');
  const adminToken = await login(env, 'admin', 'admin1234');
  const karyawanToken = await login(env, 'kry', 'kry12345');
  return { env, adminToken, karyawanToken, adminId, karyawanId };
}

async function closeKasir(env, token) {
  const cur = await call(env, '/api/kasir/current', { token });
  const saldoReal = cur.data.saldo
    .filter((x) => x.nama_akun !== 'Total Saldo')
    .map((x) => ({ nama_akun: x.nama_akun, saldo_real: x.saldo_sistem }));
  return call(env, '/api/kasir/closing', { method: 'POST', token, body: { saldo_real: saldoReal } });
}

function wibHourNow() {
  return new Date(Date.now() + 7 * 3600 * 1000).getUTCHours();
}

async function setRate(env, token, userId, rateFlat) {
  const r = await call(env, '/api/gaji/rate', {
    method: 'POST', token,
    body: { user_id: userId, tipe: 'flat', rate_flat: rateFlat },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r;
}

async function openKasir(env, token) {
  return call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 5000000 }] },
  });
}

async function gajiFor(env, token, tanggal, userId) {
  const r = await call(env, `/api/gaji?tanggal=${tanggal}`, { token });
  assert.equal(r.status, 200);
  const rows = (r.data.items || []).filter((x) => (userId ? x.user_id === userId : true));
  return rows;
}

test('GAJI auto: karyawan buka kasir -> tepat 1 baris sumber=auto sesuai rate', async () => {
  const { env, adminToken, karyawanToken, karyawanId } = await setup();
  const today = todayWib();
  await setRate(env, adminToken, karyawanId, 50000);

  const open = await openKasir(env, karyawanToken);
  assert.equal(open.status, 200, JSON.stringify(open.data));

  const rows = await gajiFor(env, adminToken, today, karyawanId);
  assert.equal(rows.length, 1, 'harus TEPAT 1 baris gaji untuk karyawan hari ini');
  assert.equal(rows[0].nominal, 50000);
  assert.equal(rows[0].sumber, 'auto');
});

test('GAJI no double-pay: manual dibuat DULU -> auto opening TIDAK menimpa/menduplikasi', async () => {
  const { env, adminToken, karyawanToken, karyawanId } = await setup();
  const today = todayWib();
  await setRate(env, adminToken, karyawanId, 50000);

  const manual = await call(env, '/api/gaji', {
    method: 'POST', token: adminToken,
    body: { user_id: karyawanId, tanggal: today, nominal: 70000, catatan: 'hari khusus' },
  });
  assert.equal(manual.status, 200, JSON.stringify(manual.data));

  const open = await openKasir(env, karyawanToken);
  assert.equal(open.status, 200, JSON.stringify(open.data));

  const rows = await gajiFor(env, adminToken, today, karyawanId);
  assert.equal(rows.length, 1, 'manual + auto tidak boleh menghasilkan 2 baris');
  assert.equal(rows[0].nominal, 70000, 'nominal manual dipertahankan');
  assert.equal(rows[0].sumber, 'manual_edit');
});

test('GAJI no double-pay: auto dibuat DULU -> manual setelahnya upsert, tetap 1 baris', async () => {
  const { env, adminToken, karyawanToken, karyawanId } = await setup();
  const today = todayWib();
  await setRate(env, adminToken, karyawanId, 50000);

  const open = await openKasir(env, karyawanToken);
  assert.equal(open.status, 200, JSON.stringify(open.data));

  const manual = await call(env, '/api/gaji', {
    method: 'POST', token: adminToken,
    body: { user_id: karyawanId, tanggal: today, nominal: 90000 },
  });
  assert.equal(manual.status, 200, JSON.stringify(manual.data));

  const rows = await gajiFor(env, adminToken, today, karyawanId);
  assert.equal(rows.length, 1, 'auto + manual tidak boleh menghasilkan 2 baris');
  assert.equal(rows[0].nominal, 90000);
  assert.equal(rows[0].sumber, 'manual_edit');
});

test('GAJI no double-pay: buka kasir dua kali ditolak (session_already_opened) -> 1 baris saja', async () => {
  const { env, adminToken, karyawanToken, karyawanId } = await setup();
  const today = todayWib();
  await setRate(env, adminToken, karyawanId, 50000);

  const open1 = await openKasir(env, karyawanToken);
  assert.equal(open1.status, 200, JSON.stringify(open1.data));

  const open2 = await openKasir(env, karyawanToken);
  assert.equal(open2.status, 409);
  assert.equal(open2.data.error.code, 'session_already_opened');

  const rows = await gajiFor(env, adminToken, today, karyawanId);
  assert.equal(rows.length, 1, 'opening berulang tidak boleh menggandakan gaji');
});

test('GAJI shift: karyawan tanpa rate -> nominal sesuai jam buka (60k/45k)', async () => {
  const { env, adminToken, karyawanToken, karyawanId } = await setup();
  const today = todayWib();
  const open = await openKasir(env, karyawanToken);
  assert.equal(open.status, 200, JSON.stringify(open.data));
  const wibHour = new Date(Date.now() + 7 * 3600 * 1000).getUTCHours();
  const expected = wibHour < 16 ? 60000 : 45000;
  const rows = await gajiFor(env, adminToken, today, karyawanId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nominal, expected);
  assert.equal(rows[0].sumber, 'auto');
});

test('GAJI owner: akru otomatis saat Closing (upah 50k + bagi hasil servis SENDIRI)', async () => {
  const { env, adminToken, adminId } = await setup();
  const today = todayWib();
  await openKasir(env, adminToken);
  await call(env, '/api/gaji/bagi-hasil', {
    method: 'POST', token: adminToken, body: { user_id: adminId, persen: 50 },
  });

  // service: biaya 200k, modal 120k -> laba 80k. Dikerjakan owner -> share 50% = 40k
  const svc = await call(env, '/api/transaksi', {
    method: 'POST', token: adminToken, headers: { 'Idempotency-Key': 'svc-owner-1' },
    body: {
      jenis: 'service', metode_bayar: 'tunai', items: [],
      service: { nama_device: 'iPhone', deskripsi_kerusakan: 'Ganti LCD', biaya: 200000, harga_modal: 120000, tanggal_masuk: today, technisi_id: adminId },
    },
  });
  assert.equal(svc.status, 200, JSON.stringify(svc.data));

  const upah = 50000; // upah owner tetap, tidak ikut shift
  const close = await closeKasir(env, adminToken);
  assert.equal(close.status, 200, JSON.stringify(close.data));

  const rows = await gajiFor(env, adminToken, today, adminId);
  assert.equal(rows.length, 1, 'owner akru 1 baris saat closing');
  assert.equal(rows[0].nominal, upah + 40000);

  const unpaid = await call(env, '/api/gaji/unpaid', { token: adminToken });
  assert.equal(unpaid.status, 200);
  const ownerUnpaid = unpaid.data.items.find((x) => x.user_id === adminId);
  assert.equal(ownerUnpaid.total, upah + 40000);

  const pay = await call(env, '/api/gaji/bayar', { method: 'POST', token: adminToken, body: { user_id: adminId } });
  assert.equal(pay.status, 200, JSON.stringify(pay.data));
  assert.equal(pay.data.total, upah + 40000);

  const pend = await call(env, `/api/pengeluaran?tanggal=${today}`, { token: adminToken });
  assert.ok(pend.data.items.some((x) => x.deskripsi.includes('Bayar gaji')), 'pengeluaran gaji tercatat');

  const again = await call(env, '/api/gaji/bayar', { method: 'POST', token: adminToken, body: { user_id: adminId } });
  assert.equal(again.status, 400, 'tidak ada lagi yang belum dibayar');
});

test('GAJI list: filter month hanya menampilkan bulan itu', async () => {
  const { env, adminToken, karyawanId } = await setup();
  const today = todayWib();
  const bulan = today.slice(0, 7);
  await call(env, '/api/gaji', { method: 'POST', token: adminToken, body: { user_id: karyawanId, tanggal: today, nominal: 50000 } });
  await call(env, '/api/gaji', { method: 'POST', token: adminToken, body: { user_id: karyawanId, tanggal: '2020-01-15', nominal: 40000 } });

  const thisMonth = await call(env, `/api/gaji?month=${bulan}`, { token: adminToken });
  assert.equal(thisMonth.status, 200);
  assert.ok(thisMonth.data.items.every((g) => g.tanggal.startsWith(bulan)), 'hanya bulan ini');
  assert.ok(thisMonth.data.items.some((g) => g.tanggal === today));

  const other = await call(env, '/api/gaji?month=2020-01', { token: adminToken });
  assert.equal(other.data.items.length, 1);
  assert.equal(other.data.items[0].tanggal, '2020-01-15');
});

test('GAJI auto: admin buka kasir -> TIDAK dibuat baris gaji untuk admin', async () => {
  const { env, adminToken } = await setup();
  const today = todayWib();

  const open = await openKasir(env, adminToken);
  assert.equal(open.status, 200, JSON.stringify(open.data));

  const r = await call(env, `/api/gaji?tanggal=${today}`, { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.data.items.length, 0, 'admin tidak punya rate/baris gaji otomatis');
});
test('GAJI owner: upah TETAP 50.000 walaupun jam buka >= 16 (tidak ikut shift)', async () => {
  const { env, adminToken, adminId } = await setup();
  await call(env, '/api/gaji/bagi-hasil', {
    method: 'POST', token: adminToken, body: { user_id: adminId, persen: 50 },
  });
  const today = todayWib();
  await openKasir(env, adminToken);

  const svc = await call(env, '/api/transaksi', {
    method: 'POST', token: adminToken, headers: { 'Idempotency-Key': 'svc-flat-owner' },
    body: {
      jenis: 'service', metode_bayar: 'tunai', items: [],
      service: { nama_device: 'iPhone', deskripsi_kerusakan: 'Ganti LCD', biaya: 300000, harga_modal: 100000, tanggal_masuk: today, technisi_id: adminId },
    },
  });
  assert.equal(svc.status, 200, JSON.stringify(svc.data));

  // Tanpa user_id -> global: jumlah semua admin, rincian per orang di .owners
  const r = await call(env, `/api/gaji/owner?tanggal=${today}`, { token: adminToken });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.total, 150000, 'total global = 50.000 upah + 100.000 bagi hasil');
  assert.equal(r.data.owners.length, 1);
  assert.equal(r.data.owners[0].nama, 'Admin', 'rincian menyebut nama owner');
  assert.equal(r.data.owners[0].upah, 50000, 'upah owner tetap 50.000');
  assert.equal(r.data.owners[0].service_laba, 200000);
  assert.equal(r.data.owners[0].service_share, 100000);
});

test('GAJI: admin (owner) boleh set rate & buat gaji manual', async () => {
  const { env, adminToken, adminId } = await setup();

  const rate = await call(env, '/api/gaji/rate', {
    method: 'POST', token: adminToken,
    body: { user_id: adminId, tipe: 'flat', rate_flat: 50000 },
  });
  assert.equal(rate.status, 200, `admin harus bisa set rate: ${JSON.stringify(rate.data)}`);

  const manual = await call(env, '/api/gaji', {
    method: 'POST', token: adminToken,
    body: { user_id: adminId, tanggal: '2026-09-20', nominal: 120000, catatan: 'bagi hasil' },
  });
  assert.equal(manual.status, 200, `admin harus bisa buat gaji manual: ${JSON.stringify(manual.data)}`);
  assert.equal(manual.data.nominal, 120000);
});

test('Bagi hasil service: porsi per teknisi, hanya servis yang dikerjakan', async () => {
  const { env, adminToken, karyawanId } = await setup();
  const today = todayWib();
  await openKasir(env, adminToken);

  // Servis 1: modal 120k, biaya 200k -> laba 80k, dikerjakan karyawan
  const s1 = await call(env, '/api/transaksi', {
    method: 'POST', token: adminToken, headers: { 'Idempotency-Key': 'svc-tek-1' },
    body: {
      jenis: 'service', metode_bayar: 'tunai', items: [],
      service: { nama_device: 'iPhone', deskripsi_kerusakan: 'LCD', biaya: 200000, harga_modal: 120000, tanggal_masuk: today, technisi_id: karyawanId },
    },
  });
  assert.equal(s1.status, 200, JSON.stringify(s1.data));

  // Set porsi 20% untuk karyawan
  const set = await call(env, '/api/gaji/bagi-hasil', {
    method: 'POST', token: adminToken, body: { user_id: karyawanId, persen: 20 },
  });
  assert.equal(set.status, 200, JSON.stringify(set.data));

  const r = await call(env, `/api/gaji/bagi-hasil?tanggal=${today}`, { token: adminToken });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const kar = r.data.items.find((x) => x.user_id === karyawanId);
  assert.ok(kar, 'karyawan harus ada di daftar');
  assert.equal(kar.service_laba, 80000, 'laba servis yang dikerjakannya');
  assert.equal(kar.share, 16000, '20% dari 80.000');
  assert.equal(r.data.total_service_laba, 80000);
  assert.equal(r.data.sisa_toko, 64000, 'sisa 80% untuk toko');
  assert.equal(r.data.service_tanpa_teknisi, 0);
});

test('Bagi hasil service: servis tanpa teknisi tidak dibagi ke siapa pun', async () => {
  const { env, adminToken, karyawanId } = await setup();
  const today = todayWib();
  await openKasir(env, adminToken);
  await call(env, '/api/transaksi', {
    method: 'POST', token: adminToken, headers: { 'Idempotency-Key': 'svc-tek-2' },
    body: {
      jenis: 'service', metode_bayar: 'tunai', items: [],
      service: { nama_device: 'Redmi', deskripsi_kerusakan: 'Baterai', biaya: 100000, harga_modal: 60000, tanggal_masuk: today },
    },
  });
  await call(env, '/api/gaji/bagi-hasil', {
    method: 'POST', token: adminToken, body: { user_id: karyawanId, persen: 50 },
  });
  const r = await call(env, `/api/gaji/bagi-hasil?tanggal=${today}`, { token: adminToken });
  const kar = r.data.items.find((x) => x.user_id === karyawanId);
  assert.equal(kar.service_laba, 0, 'tanpa teknisi tidak dapat bagian');
  assert.equal(kar.share, 0);
  assert.equal(r.data.service_tanpa_teknisi, 40000, 'laba servis tanpa teknisi dilaporkan terpisah');
  assert.equal(r.data.total_service_laba, 40000);
  assert.equal(r.data.sisa_toko, 40000);
});

test('Bagi hasil service: porsi 0 berarti tidak dapat bagian', async () => {
  const { env, adminToken, karyawanId } = await setup();
  await call(env, '/api/gaji/bagi-hasil', { method: 'POST', token: adminToken, body: { user_id: karyawanId, persen: 0 } });
  const hapus = await call(env, `/api/gaji/bagi-hasil-${karyawanId}`, { method: 'DELETE', token: adminToken });
  assert.equal(hapus.status, 200, JSON.stringify(hapus.data));
  const cek = await call(env, `/api/gaji/bagi-hasil?tanggal=${todayWib()}`, { token: adminToken });
  assert.equal(cek.data.items.length, 0, 'setelah dihapus tidak ada porsi');
});

test('Owner: upah harian dari settings (bisa diubah tanpa sentuh kode)', async () => {
  const { env, adminToken, adminId } = await setup();
  const today = todayWib();
  const set = await call(env, '/api/gaji/owner-upah', { method: 'PUT', token: adminToken, body: { nominal: 75000 } });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  const r = await call(env, `/api/gaji/owner?tanggal=${today}`, { token: adminToken });
  assert.equal(r.data.upah, 75000, 'upah mengikuti settings, bukan konstanta kode');
  // Porsi owner dari DB
  await call(env, '/api/gaji/bagi-hasil', { method: 'POST', token: adminToken, body: { user_id: adminId, persen: 30 } });
  const r2 = await call(env, `/api/gaji/owner?tanggal=${today}&user_id=${adminId}`, { token: adminToken });
  assert.equal(r2.data.service_pct, 30, 'porsi owner dari DB');
  assert.ok(adminId, 'bootstrap punya admin');
});

test('Gaji owner: GLOBAL untuk semua admin, tidak dikunci ke satu akun', async () => {
  const { env, adminToken, adminId } = await setup();
  const admin2 = await createUserRaw(env, { nama: 'Admin Kedua', username: 'adm2', password: 'adm21234', role: 'admin' });
  const today = todayWib();
  await openKasir(env, adminToken);
  await call(env, '/api/gaji/bagi-hasil', { method: 'POST', token: adminToken, body: { user_id: adminId, persen: 50 } });

  const svc = await call(env, '/api/transaksi', {
    method: 'POST', token: adminToken, headers: { 'Idempotency-Key': 'svc-multi-owner' },
    body: {
      jenis: 'service', metode_bayar: 'tunai', items: [],
      service: { nama_device: 'iPhone', deskripsi_kerusakan: 'LCD', biaya: 200000, harga_modal: 100000, tanggal_masuk: today, technisi_id: adminId },
    },
  });
  assert.equal(svc.status, 200, JSON.stringify(svc.data));

  const r = await call(env, `/api/gaji/owner?tanggal=${today}`, { token: adminToken });
  assert.equal(r.data.owners.length, 2, 'kedua admin dihitung, bukan hanya admin pertama');
  const nama = r.data.owners.map((o) => o.nama).sort();
  assert.deepEqual(nama, ['Admin', 'Admin Kedua']);
  // Admin kedua: upah 50.000, tanpa porsi -> tidak dapat bagi hasil
  const k2 = r.data.owners.find((o) => o.user_id === Number(admin2));
  assert.equal(k2.upah, 50000, 'admin kedua tetap dapat upah harian');
  assert.equal(k2.service_share, 0, 'tanpa porsi -> 0');
  // Admin 1: upah 50.000 + 50% dari laba 100.000 = 100.000. Admin 2: upah 50.000 saja.
  const k1 = r.data.owners.find((o) => o.user_id === Number(1) || o.nama === 'Admin');
  assert.equal(k1.total, 100000, 'admin dengan porsi 50% dapat 100.000');
  assert.equal(r.data.total, 150000, 'total global = 100.000 + 50.000');
});
