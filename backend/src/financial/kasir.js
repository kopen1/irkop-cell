import { err } from '../lib/errors.js';
import { nowIso, wibDateToday } from '../lib/time.js';
import { getAccount } from './akun.js';
import { sumMutationBySession } from './mutasi.js';
import { writeAudit } from '../lib/audit.js';
import { ensureGajiAutoInput, ensureOwnerGajiAutoInput } from './gaji.js';
import { autoCreateProdukFromTransaksi } from './autoProduk.js';

// Akun ledger / label hitung yang BUKAN akun uang — tidak direkonsiliasi
// dan tidak wajib ada di akun_master saat opening/closing.
const LEDGER_AKUN = new Set(['Saldo Akun', 'Total Saldo', 'Laba']);
const isAkunUang = (namaAkun) => !LEDGER_AKUN.has(String(namaAkun || '').trim());

export async function reminderKasirBelumClosing(db, { user, ip }) {
  const today = wibDateToday();
  const open = await db.many(
    `SELECT ks.id, ks.tanggal, ks.dibuka_at, ks.dibuka_oleh, u.nama AS dibuka_oleh_nama
       FROM kasir_sesi ks
       LEFT JOIN users u ON u.id = ks.dibuka_oleh
      WHERE ks.status = 'buka' AND ks.tanggal < ?
      ORDER BY ks.tanggal, ks.id`,
    today
  );
  if (open.length) {
    await writeAudit(db, {
      userId: user.id, aksi: 'reminder_closing', tabel: 'kasir_sesi', recordId: open[0].id,
      dataAfter: { tanggal: today, jml_sesi_buka: open.length, daftar_tanggal: open.map((o) => o.tanggal) },
      ip,
    });
  }
  return {
    tanggal: today,
    perlu_diingatkan: open.length > 0,
    sesi_buka_lampau: open.map((o) => ({
      kasir_sesi_id: o.id,
      tanggal: o.tanggal,
      dibuka_at: o.dibuka_at,
      dibuka_oleh: o.dibuka_oleh_nama,
    })),
  };
}

export async function getTodaySession(db, { date = wibDateToday() } = {}) {
  return db.one('SELECT * FROM kasir_sesi WHERE tanggal = ?', date);
}

export async function getSessionById(db, kasirSesiId) {
  return db.one('SELECT * FROM kasir_sesi WHERE id = ?', kasirSesiId);
}

export async function requireOpenSession(db, date = wibDateToday()) {
  const sesi = await getTodaySession(db, { date });
  if (!sesi) {
    throw err(409, 'session_not_open', 'Kasir belum dibuka hari ini');
  }
  if (sesi.status !== 'buka') {
    throw err(409, 'session_closed', 'Sesi kasir hari ini sudah ditutup');
  }
  return sesi;
}

// Sesi hari ini apa pun statusnya (buka atau tutup). Dipakai operasi yang
// boleh dicatat pasca-closing, mis. setoran tunai ke bank setelah tutup toko.
export async function requireSessionForToday(db, date = wibDateToday()) {
  const sesi = await getTodaySession(db, { date });
  if (!sesi) throw err(409, 'session_not_open', 'Kasir belum dibuka hari ini');
  return sesi;
}

// Buka ulang sesi yang sudah ditutup (mis. masih ada setoran pasca-closing).
// Hasil closing lama dihapus agar closing berikutnya tidak dobel.
export async function reopen(db, { body = {}, user, ip }) {
  const targetId = body.kasir_sesi_id != null ? Number(body.kasir_sesi_id) : null;
  const sesi = targetId
    ? await getSessionById(db, targetId)
    : await getTodaySession(db, { date: body.tanggal || wibDateToday() });
  if (!sesi) throw err(404, 'session_not_found', 'Sesi kasir tidak ditemukan');
  if (sesi.status !== 'tutup') throw err(409, 'session_not_closed', 'Sesi kasir belum ditutup');

  const { results } = await db.batch([
    db.raw.prepare("DELETE FROM kasir_saldo WHERE kasir_sesi_id = ? AND tipe = 'closing'").bind(sesi.id),
    db.raw
      .prepare("UPDATE kasir_sesi SET status = 'buka', ditutup_oleh = NULL, ditutup_at = NULL, catatan_closing = NULL WHERE id = ?")
      .bind(sesi.id),
  ]);
  if (!results.every((r) => r.success)) throw err(500, 'reopen_failed', 'Gagal membuka ulang sesi kasir');
  await writeAudit(db, { userId: user.id, aksi: 'reopen', tabel: 'kasir_sesi', recordId: sesi.id, dataAfter: { tanggal: sesi.tanggal }, ip });
  return { kasir_sesi_id: sesi.id, tanggal: sesi.tanggal, status: 'buka' };
}

// Sesi yang masih 'buka' — bisa sesi hari ini (default) atau sesi lampau yang
// belum di-closing (dari reminder). Sesi yang sudah tutup TIDAK boleh diubah.
async function resolveOpenSession(db, targetId, today) {
  if (targetId === null) {
    return requireOpenSession(db, today);
  }
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw err(400, 'invalid_value', 'kasir_sesi_id tidak valid');
  }
  const sesi = await getSessionById(db, targetId);
  if (!sesi) {
    throw err(404, 'session_not_found', 'Sesi kasir tidak ditemukan');
  }
  if (sesi.status !== 'buka') {
    throw err(409, 'session_closed', 'Sesi kasir sudah ditutup');
  }
  return sesi;
}

export async function getOpeningBalances(db, kasirSesiId) {
  return db.many(
    "SELECT nama_akun, saldo_sistem AS saldo_opening FROM kasir_saldo WHERE kasir_sesi_id = ? AND tipe = 'opening'",
    kasirSesiId
  );
}

function computeOpeningRows(body) {
  if (Array.isArray(body.saldo_awal)) {
    for (const row of body.saldo_awal) {
      if (!row.nama_akun) throw err(400, 'missing_field', 'setiap saldo_awal wajib punya nama_akun');
      const saldo = Number(row.saldo);
      if (!Number.isInteger(saldo) || saldo < 0) {
        throw err(400, 'invalid_value', `saldo awal '${row.nama_akun}' harus integer >= 0`);
      }
    }
    return body.saldo_awal;
  }
  if (body.nama_akun !== undefined && body.saldo !== undefined) {
    const saldo = Number(body.saldo);
    if (!Number.isInteger(saldo) || saldo < 0) {
      throw err(400, 'invalid_value', 'saldo awal harus integer >= 0');
    }
    return [{ nama_akun: body.nama_akun, saldo }];
  }
  throw err(400, 'missing_field', 'saldo_awal wajib diisi (array {nama_akun, saldo})');
}

export async function opening(db, { body, user, ip }) {
  const today = wibDateToday();
  const existing = await getTodaySession(db, { date: today });
  if (existing) {
    throw err(409, 'session_already_opened', 'Sesi kasir hari ini sudah pernah dibuat');
  }

  const openingInput = computeOpeningRows(body).filter((r) => isAkunUang(r.nama_akun));
  if (!openingInput.length) throw err(400, 'missing_field', 'Tidak ada akun uang untuk saldo awal');
  const openingRows = await Promise.all(
    openingInput.map(async (r) => ({
      nama_akun: r.nama_akun,
      saldo: Number(r.saldo),
      account: await getAccount(db, r.nama_akun),
    }))
  );

  const dbBatch = [];
  const now = nowIso();
  dbBatch.push(
    db.raw.prepare(
      'INSERT INTO kasir_sesi (tanggal, dibuka_oleh, dibuka_at, status) VALUES (?, ?, ?, ?)'
    ).bind(today, user.id, now, 'buka')
  );
  for (const { nama_akun, saldo } of openingRows) {
    dbBatch.push(
      db.raw.prepare(
        "INSERT INTO kasir_saldo (kasir_sesi_id, nama_akun, saldo_sistem, saldo_real, selisih, tipe, created_at) VALUES ((SELECT max(id) FROM kasir_sesi WHERE tanggal = ?), ?, ?, ?, 0, 'opening', ?)"
      ).bind(today, nama_akun, saldo, saldo, now)
    );
  }

  const { results } = await db.batch(dbBatch);
  if (!results.every((r) => r.success)) {
    throw err(500, 'open_failed', 'Gagal membuka kasir');
  }

  const sesi = await getTodaySession(db, { date: today });

  const hang = [];
  hang.push(
    writeAudit(db, { userId: user.id, aksi: 'opening', tabel: 'kasir_sesi', recordId: sesi.id, dataAfter: { tanggal: today, saldo_awal: openingRows.map((r) => ({ nama_akun: r.nama_akun, saldo: r.saldo })) }, ip })
  );
  const wibHour = new Date(Date.now() + 7 * 3600 * 1000).getUTCHours();
  hang.push(ensureGajiAutoInput(db, { user, tanggal: today, kasirSesiId: sesi.id, jamBuka: wibHour }));
  await Promise.all(hang);

  return { kasir_sesi_id: sesi.id, tanggal: today, status: 'buka', saldo_awal: openingRows.map((r) => ({ nama_akun: r.nama_akun, saldo: r.saldo })) };
}

export async function closing(db, { body, user, ip }) {
  const today = wibDateToday();
  const targetId = body.kasir_sesi_id != null ? Number(body.kasir_sesi_id) : null;
  const sesi = await resolveOpenSession(db, targetId, today);
  const tanggal = sesi.tanggal;

  const closingRows = body.saldo_real;
  if (Array.isArray(closingRows)) {
    for (const r of closingRows) {
      if (!r.nama_akun) throw err(400, 'missing_field', 'setiap saldo_real wajib punya nama_akun');
      const v = Number(r.saldo_real);
      if (!Number.isInteger(v)) {
        throw err(400, 'invalid_value', `saldo_real '${r.nama_akun}' harus integer`);
      }
    }
  } else {
    throw err(400, 'missing_field', 'saldo_real wajib diisi (array {nama_akun, saldo_real})');
  }

  // Hanya rekonsiliasi akun uang; akun ledger/label diabaikan.
  const closingInput = closingRows.filter((r) => isAkunUang(r.nama_akun));
  if (!closingInput.length) throw err(400, 'missing_field', 'Tidak ada akun uang untuk direkonsiliasi');

  const processed = [];
  for (const r of closingInput) {
    await getAccount(db, r.nama_akun);
    const openingRows = await getOpeningBalances(db, sesi.id);
    const openingFor = openingRows.find((o) => o.nama_akun === r.nama_akun);
    const opening = openingFor ? Number(openingFor.saldo_opening) : 0;
    const mutasi = await sumMutationBySession(db, sesi.id, r.nama_akun);
    const saldoSistem = opening + mutasi;
    const saldoReal = Number(r.saldo_real);
    const selisih = saldoReal - saldoSistem;
    processed.push({ nama_akun: r.nama_akun, saldo_sistem: saldoSistem, saldo_real: saldoReal, selisih });
  }

  const now = nowIso();
  const dbBatch = [];
  for (const row of processed) {
    dbBatch.push(
      db.raw.prepare(
        "INSERT INTO kasir_saldo (kasir_sesi_id, nama_akun, saldo_sistem, saldo_real, selisih, tipe, created_at) VALUES (?, ?, ?, ?, ?, 'closing', ?)"
      ).bind(sesi.id, row.nama_akun, row.saldo_sistem, row.saldo_real, row.selisih, now)
    );
  }
  dbBatch.push(
    db.raw.prepare(
      "UPDATE kasir_sesi SET status='tutup', ditutup_oleh=?, ditutup_at=?, catatan_closing=? WHERE id=? AND status='buka'"
    ).bind(user.id, now, body.catatan_closing ?? null, sesi.id)
  );
  const { results } = await db.batch(dbBatch);
  if (!results.every((r) => r.success)) {
    throw err(500, 'close_failed', 'Gagal menutup kasir');
  }

  // Akru gaji owner otomatis saat closing (belum dibayar).
  if (sesi.dibuka_at) {
    const jamBuka = (new Date(sesi.dibuka_at).getUTCHours() + 7) % 24;
    await ensureOwnerGajiAutoInput(db, { tanggal: sesi.tanggal, jamBuka, kasirSesiId: sesi.id });
  }

  // Buat produk otomatis dari transaksi DANA/Bank yang sering.
  await autoCreateProdukFromTransaksi(db, {});

  await writeAudit(db, { userId: user.id, aksi: 'closing', tabel: 'kasir_sesi', recordId: sesi.id, dataAfter: { tanggal, kasir_sesi_id: sesi.id, rekonsiliasi: processed, catatan: body.catatan_closing ?? null }, ip });

  return { kasir_sesi_id: sesi.id, tanggal, status: 'tutup', rekonsiliasi: processed };
}

// Saran saldo awal untuk Opening: ambil dari sesi terakhir. Prioritas saldo_real
// hasil closing (uang yang benar-benar dihitung); kalau belum closing, hitung
// opening + mutasi sesi terakhir. Hanya akun uang (ledger dikecualikan).
async function lastSessionBalances(db) {
  const last = await db.one('SELECT id FROM kasir_sesi ORDER BY tanggal DESC, id DESC LIMIT 1');
  if (!last) return [];
  const closing = await db.many(
    "SELECT nama_akun, saldo_real FROM kasir_saldo WHERE kasir_sesi_id = ? AND tipe = 'closing'",
    last.id
  );
  if (closing.length) {
    return closing
      .filter((r) => !LEDGER_AKUN.has(r.nama_akun))
      .map((r) => ({ nama_akun: r.nama_akun, saldo: Number(r.saldo_real) }));
  }
  const opening = await getOpeningBalances(db, last.id);
  const mutasi = await db.many(
    'SELECT nama_akun, SUM(jumlah) AS total FROM mutasi_saldo WHERE kasir_sesi_id = ? GROUP BY nama_akun',
    last.id
  );
  const map = {};
  for (const o of opening) {
    if (!LEDGER_AKUN.has(o.nama_akun)) map[o.nama_akun] = { nama_akun: o.nama_akun, saldo: Number(o.saldo_opening) };
  }
  for (const m of mutasi) {
    if (LEDGER_AKUN.has(m.nama_akun)) continue;
    if (!map[m.nama_akun]) map[m.nama_akun] = { nama_akun: m.nama_akun, saldo: 0 };
    map[m.nama_akun].saldo += Number(m.total);
  }
  return Object.values(map);
}

export async function sessionStatus(db, { date = wibDateToday(), kasirSesiId = null } = {}) {
  let sesi = null;
  let effectiveDate = date;
  if (kasirSesiId) {
    sesi = await getSessionById(db, kasirSesiId);
    if (sesi) effectiveDate = sesi.tanggal;
  } else {
    sesi = await getTodaySession(db, { date });
  }
  if (!sesi) {
    const saldoAwalSaran = await lastSessionBalances(db);
    return { tanggal: effectiveDate, status: 'belum_buka', kasir_sesi_id: null, saldo: [], saldo_awal_saran: saldoAwalSaran };
  }
  const openingRows = await getOpeningBalances(db, sesi.id);
  const accountRows = {};
  for (const o of openingRows) {
    accountRows[o.nama_akun] = { nama_akun: o.nama_akun, saldo_opening: Number(o.saldo_opening) };
  }
  const mutasiRows = await db.many(
    'SELECT nama_akun, SUM(jumlah) AS total FROM mutasi_saldo WHERE kasir_sesi_id = ? GROUP BY nama_akun',
    sesi.id
  );
  for (const m of mutasiRows) {
    if (!accountRows[m.nama_akun]) accountRows[m.nama_akun] = { nama_akun: m.nama_akun, saldo_opening: 0 };
    accountRows[m.nama_akun].mutasi = Number(m.total);
  }

  // Hanya akun uang (tunai/bank/e_wallet/digital) yang direkonsiliasi.
  // Akun ledger (Laba, Saldo Akun) dan label hitung "Total Saldo" tidak termasuk.
  const tipeRows = await db.many('SELECT nama_akun, tipe FROM akun_master');
  const tipeMap = {};
  for (const a of tipeRows) tipeMap[a.nama_akun] = a.tipe;

  const saldo = Object.values(accountRows)
    .filter((r) => !LEDGER_AKUN.has(r.nama_akun) && tipeMap[r.nama_akun] !== 'lainnya')
    .map((r) => ({
      nama_akun: r.nama_akun,
      saldo_opening: r.saldo_opening,
      mutasi: r.mutasi ?? 0,
      saldo_sistem: r.saldo_opening + (r.mutasi ?? 0),
    }));

  // Total Saldo — jumlah saldo akun uang KECUALI Tunai Laci
  const uangNonLaci = saldo.filter((r) => !r.nama_akun.toLowerCase().includes('tunai laci'));
  const totalSaldo = uangNonLaci.reduce((s, r) => s + r.saldo_sistem, 0);
  saldo.push({
    nama_akun: 'Total Saldo',
    saldo_opening: uangNonLaci.reduce((s, r) => s + r.saldo_opening, 0),
    mutasi: totalSaldo - uangNonLaci.reduce((s, r) => s + r.saldo_opening, 0),
    saldo_sistem: totalSaldo
  });

  let closingRows = [];
  if (sesi.status === 'tutup') {
    closingRows = await db.many(
      "SELECT nama_akun, saldo_sistem, saldo_real, selisih FROM kasir_saldo WHERE kasir_sesi_id = ? AND tipe = 'closing'",
      sesi.id
    );
  }

  return {
    tanggal: effectiveDate,
    kasir_sesi_id: sesi.id,
    status: sesi.status,
    dibuka_oleh: sesi.dibuka_oleh,
    dibuka_at: sesi.dibuka_at,
    ditutup_oleh: sesi.ditutup_oleh,
    ditutup_at: sesi.ditutup_at,
    catatan_closing: sesi.catatan_closing,
    saldo,
    closing: closingRows,
  };
}