import { err } from '../lib/errors.js';
import { nowIso, wibDateToday } from '../lib/time.js';
import { getAccount } from './akun.js';
import { sumMutationBySession } from './mutasi.js';
import { writeAudit } from '../lib/audit.js';
import { ensureGajiAutoInput } from './gaji.js';

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

  const openingRows = await Promise.all(
    computeOpeningRows(body).map(async (r) => ({
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
  hang.push(ensureGajiAutoInput(db, { user, tanggal: today, kasirSesiId: sesi.id }));
  await Promise.all(hang);

  return { kasir_sesi_id: sesi.id, tanggal: today, status: 'buka', saldo_awal: openingRows.map((r) => ({ nama_akun: r.nama_akun, saldo: r.saldo })) };
}

export async function closing(db, { body, user, ip }) {
  const today = wibDateToday();
  const sesi = await requireOpenSession(db, today);

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

  const processed = [];
  for (const r of closingRows) {
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

  await writeAudit(db, { userId: user.id, aksi: 'closing', tabel: 'kasir_sesi', recordId: sesi.id, dataAfter: { tanggal: today, rekonsiliasi: processed, catatan: body.catatan_closing ?? null }, ip });

  return { kasir_sesi_id: sesi.id, tanggal: today, status: 'tutup', rekonsiliasi: processed };
}

export async function sessionStatus(db, { date = wibDateToday() } = {}) {
  const sesi = await getTodaySession(db, { date });
  if (!sesi) {
    return { tanggal: date, status: 'belum_buka', kasir_sesi_id: null, saldo: [] };
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
  const saldo = Object.values(accountRows).map((r) => ({
    nama_akun: r.nama_akun,
    saldo_opening: r.saldo_opening,
    mutasi: r.mutasi ?? 0,
    saldo_sistem: r.saldo_opening + (r.mutasi ?? 0),
  }));

  let closingRows = [];
  if (sesi.status === 'tutup') {
    closingRows = await db.many(
      "SELECT nama_akun, saldo_sistem, saldo_real, selisih FROM kasir_saldo WHERE kasir_sesi_id = ? AND tipe = 'closing'",
      sesi.id
    );
  }

  return {
    tanggal: date,
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