// Transfer antar akun internal ("Isi Saldo"), mis. SeaBank -> OrderKuota.
// Bukan penjualan & bukan pengeluaran: satu operasi = DUA mutasi di
// mutasi_saldo (asal -nominal, tujuan +nominal) dengan sumber_tipe
// 'penyesuaian' + kategori 'transfer_internal', sehingga Total Saldo tetap
// (cuma pindah) dan tidak dihitung sebagai omzet/laba.
import { err } from '../lib/errors.js';
import { nowIso, wibDateToday, isValidCalendarDate } from '../lib/time.js';
import { getAccount } from '../financial/akun.js';
import { requireSessionForToday } from '../financial/kasir.js';
import { reverseFullSource } from '../financial/reversal.js';
import { writeAudit } from '../lib/audit.js';
import { asInt } from '../lib/validate.js';

const KATEGORI = 'transfer_internal';
const AKUN_UANG = ['tunai', 'bank', 'e_wallet', 'digital'];

async function resolveMoneyAccount(db, nama) {
  const acc = await getAccount(db, nama);
  if (!AKUN_UANG.includes(acc.tipe)) {
    throw err(400, 'invalid_account', `Akun '${acc.nama_akun}' bukan akun uang (tipe ${acc.tipe})`);
  }
  return acc.nama_akun;
}

function validateBody(body) {
  const dari = String(body.dari_akun || '').trim();
  const ke = String(body.ke_akun || '').trim();
  if (!dari || !ke) throw err(400, 'missing_field', 'dari_akun dan ke_akun wajib diisi');
  const nominal = Number(body.nominal);
  if (!Number.isInteger(nominal) || nominal < 1) {
    throw err(400, 'invalid_value', 'nominal harus integer >= 1');
  }
  let tanggal = body.tanggal || wibDateToday();
  if (!isValidCalendarDate(tanggal)) throw err(400, 'invalid_value', 'tanggal harus format YYYY-MM-DD');
  if (tanggal > wibDateToday()) throw err(400, 'invalid_value', 'tanggal tidak boleh di masa depan');
  return { dari, ke, nominal, tanggal, catatan: body.catatan ? String(body.catatan).trim() : null };
}

function mutationKey(idempotencyKey, id, akun) {
  return idempotencyKey ? `req:${idempotencyKey}:transfer:${akun}` : `transfer:${id}:${akun}`;
}

function insertMutationStmts(db, sesiId, transferId, dari, ke, nominal, idempotencyKey, now) {
  const mk = (akun) => mutationKey(idempotencyKey, transferId, akun);
  return [
    db.raw.prepare(
      `INSERT OR IGNORE INTO mutasi_saldo
         (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, kategori, created_at)
       VALUES (?, ?, ?, 'penyesuaian', ?, ?, ?, ?)`
    ).bind(sesiId, dari, -nominal, transferId, mk(dari), KATEGORI, now),
    db.raw.prepare(
      `INSERT OR IGNORE INTO mutasi_saldo
         (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, kategori, created_at)
       VALUES (?, ?, ?, 'penyesuaian', ?, ?, ?, ?)`
    ).bind(sesiId, ke, nominal, transferId, mk(ke), KATEGORI, now),
  ];
}

export async function listTransferSaldo(db, request, ctx) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const where = ['t.deleted_at IS NULL'];
  const bind = [];
  if (params.has('tanggal')) {
    const d = params.get('tanggal');
    if (!isValidCalendarDate(d)) throw err(400, 'invalid_filter', 'tanggal harus format YYYY-MM-DD');
    where.push('t.tanggal = ?');
    bind.push(d);
  } else if (params.has('tanggal_from') || params.has('tanggal_to')) {
    const df = params.get('tanggal_from');
    const dt = params.get('tanggal_to');
    if (!df || !dt) throw err(400, 'invalid_filter', 'tanggal_from dan tanggal_to wajib bersamaan');
    if (!isValidCalendarDate(df) || !isValidCalendarDate(dt)) throw err(400, 'invalid_filter', 'format tanggal tidak valid');
    if (df > dt) throw err(400, 'invalid_filter', 'tanggal_from tidak boleh setelah tanggal_to');
    where.push('t.tanggal >= ? AND t.tanggal <= ?');
    bind.push(df, dt);
  }
  if (params.has('akun')) {
    const a = params.get('akun');
    where.push('(t.dari_akun = ? OR t.ke_akun = ?)');
    bind.push(a, a);
  }

  const summary = await db.one(
    `SELECT COUNT(*) AS total_items, COALESCE(SUM(t.nominal), 0) AS total_nilai
       FROM transfer_saldo t WHERE ${where.join(' AND ')}`,
    ...bind
  );
  const limit = Math.min(Number(params.get('limit') || '100'), 200);
  const offset = Math.max(Number(params.get('offset') || '0'), 0);
  const rows = await db.many(
    `SELECT t.*, u.nama AS dibuat_oleh_nama, d.nama AS dihapus_oleh_nama
       FROM transfer_saldo t
       LEFT JOIN users u ON u.id = t.dibuat_oleh
       LEFT JOIN users d ON d.id = t.deleted_by
      WHERE ${where.join(' AND ')} ORDER BY t.tanggal DESC, t.id DESC LIMIT ? OFFSET ?`,
    ...[...bind, limit, offset]
  );
  return {
    items: rows,
    total_items: summary.total_items,
    total_nilai: summary.total_nilai,
    filter: { tanggal: params.get('tanggal'), tanggal_from: params.get('tanggal_from'), tanggal_to: params.get('tanggal_to'), akun: params.get('akun') },
  };
}

export async function getTransferSaldo(db, request, ctx, idStr) {
  const id = asInt(idStr, { required: true, field: 'id' });
  const row = await db.one(
    `SELECT t.*, u.nama AS dibuat_oleh_nama FROM transfer_saldo t
       LEFT JOIN users u ON u.id = t.dibuat_oleh WHERE t.id = ? AND t.deleted_at IS NULL`,
    id
  );
  if (!row) throw err(404, 'not_found', 'Transfer saldo tidak ditemukan');
  const mutasi = await db.many(
    "SELECT id, nama_akun, jumlah, sumber_tipe, mutation_key, kategori, created_at FROM mutasi_saldo WHERE sumber_tipe = 'penyesuaian' AND sumber_id = ? ORDER BY id",
    id
  );
  return { ...row, mutasi_saldo: mutasi };
}

export async function createTransferSaldo(db, body, ctx, request) {
  const { user } = ctx.auth;
  const v = validateBody(body);
  const dari = await resolveMoneyAccount(db, v.dari);
  const ke = await resolveMoneyAccount(db, v.ke);
  if (dari === ke) throw err(400, 'invalid_value', 'Akun asal dan tujuan tidak boleh sama');

  const sesi = await requireSessionForToday(db);
  const idempotencyKey = request.headers.get('Idempotency-Key') || null;

  if (idempotencyKey) {
    const existing = await db.one(
      'SELECT sumber_id FROM mutasi_saldo WHERE mutation_key = ?',
      mutationKey(idempotencyKey, null, dari)
    );
    if (existing && existing.sumber_id) {
      return db.one('SELECT * FROM transfer_saldo WHERE id = ?', existing.sumber_id);
    }
  }

  const now = nowIso();
  const res = await db.exec(
    `INSERT INTO transfer_saldo (dari_akun, ke_akun, nominal, tanggal, catatan, dibuat_oleh, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    dari, ke, v.nominal, v.tanggal, v.catatan, user.id, now
  );
  const id = res.lastRowId;

  const { results } = await db.batch(insertMutationStmts(db, sesi.id, id, dari, ke, v.nominal, idempotencyKey, now));

  // Race idempotency: kalau kedua mutasi ter-IGNORE karena key sudah dipakai
  // penulis lain, hapus baris phantom kita dan kembalikan milik penulis pertama.
  if (idempotencyKey && results.every((r) => Number(r?.meta?.changes ?? 0) === 0)) {
    const existing = await db.one(
      'SELECT sumber_id FROM mutasi_saldo WHERE mutation_key = ?',
      mutationKey(idempotencyKey, null, dari)
    );
    if (existing && existing.sumber_id && existing.sumber_id !== id) {
      await db.exec('DELETE FROM transfer_saldo WHERE id = ?', id);
      return db.one('SELECT * FROM transfer_saldo WHERE id = ?', existing.sumber_id);
    }
  }

  const saved = await db.one('SELECT * FROM transfer_saldo WHERE id = ?', id);
  await writeAudit(db, {
    userId: user.id, aksi: 'create', tabel: 'transfer_saldo', recordId: id,
    dataAfter: { dari_akun: dari, ke_akun: ke, nominal: v.nominal, tanggal: v.tanggal, catatan: v.catatan },
  });
  return saved;
}

export async function updateTransferSaldo(db, body, ctx, idStr) {
  const { user } = ctx.auth;
  const id = asInt(idStr, { required: true, field: 'id' });
  const old = await db.one('SELECT * FROM transfer_saldo WHERE id = ? AND deleted_at IS NULL', id);
  if (!old) throw err(404, 'not_found', 'Transfer saldo tidak ditemukan');

  const v = validateBody(body);
  const dari = await resolveMoneyAccount(db, v.dari);
  const ke = await resolveMoneyAccount(db, v.ke);
  if (dari === ke) throw err(400, 'invalid_value', 'Akun asal dan tujuan tidak boleh sama');

  const sesi = await requireSessionForToday(db);
  const actionKey = ctx.idempotencyKey || `utr-${id}-${Date.now()}`;
  const now = nowIso();

  // Batalkan mutasi lama secara atomik, lalu tulis nilai baru.
  await reverseFullSource(db, { sumberTipe: 'penyesuaian', sumberId: id, kasirSesiId: sesi.id, actionKey });

  await db.exec(
    'UPDATE transfer_saldo SET dari_akun = ?, ke_akun = ?, nominal = ?, tanggal = ?, catatan = ?, updated_at = ? WHERE id = ?',
    dari, ke, v.nominal, v.tanggal, v.catatan, now, id
  );

  const mk = (akun) => `transfer:${id}:${akun}:v:${actionKey}`;
  await db.batch([
    db.raw.prepare(
      `INSERT OR IGNORE INTO mutasi_saldo
         (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, kategori, created_at)
       VALUES (?, ?, ?, 'penyesuaian', ?, ?, ?, ?)`
    ).bind(sesi.id, dari, -v.nominal, id, mk(dari), KATEGORI, now),
    db.raw.prepare(
      `INSERT OR IGNORE INTO mutasi_saldo
         (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, kategori, created_at)
       VALUES (?, ?, ?, 'penyesuaian', ?, ?, ?, ?)`
    ).bind(sesi.id, ke, v.nominal, id, mk(ke), KATEGORI, now),
  ]);

  await writeAudit(db, {
    userId: user.id, aksi: 'update', tabel: 'transfer_saldo', recordId: id,
    dataBefore: { dari_akun: old.dari_akun, ke_akun: old.ke_akun, nominal: old.nominal, tanggal: old.tanggal, catatan: old.catatan },
    dataAfter: { dari_akun: dari, ke_akun: ke, nominal: v.nominal, tanggal: v.tanggal, catatan: v.catatan },
  });
  return db.one('SELECT * FROM transfer_saldo WHERE id = ?', id);
}

export async function deleteTransferSaldo(db, body, ctx, idStr) {
  const { user } = ctx.auth;
  const id = asInt(idStr, { required: true, field: 'id' });
  const old = await db.one('SELECT * FROM transfer_saldo WHERE id = ? AND deleted_at IS NULL', id);
  if (!old) throw err(404, 'not_found', 'Transfer saldo tidak ditemukan');

  const sesi = await requireSessionForToday(db);
  const actionKey = ctx.idempotencyKey || `dtr-${id}-${Date.now()}`;
  const reversal = await reverseFullSource(db, { sumberTipe: 'penyesuaian', sumberId: id, kasirSesiId: sesi.id, actionKey });
  const reason = body.deleted_reason || 'dihapus dari halaman Isi Saldo';

  await db.exec(
    'UPDATE transfer_saldo SET deleted_at = ?, deleted_by = ?, deleted_reason = ?, updated_at = ? WHERE id = ?',
    nowIso(), user.id, reason, nowIso(), id
  );
  await writeAudit(db, {
    userId: user.id, aksi: 'soft_delete', tabel: 'transfer_saldo', recordId: id,
    dataBefore: { dari_akun: old.dari_akun, ke_akun: old.ke_akun, nominal: old.nominal },
    dataAfter: { deleted_reason: reason, reversal: reversal.reversed },
  });
  return { id, status: 'soft_deleted', reversal: reversal.reversed };
}
