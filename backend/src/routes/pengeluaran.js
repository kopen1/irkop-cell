import { err } from '../lib/errors.js';
import { nowIso, wibDateToUtcRange, isValidCalendarDate } from '../lib/time.js';
import { getAccount } from '../financial/akun.js';
import { requireOpenSession } from '../financial/kasir.js';
import { reverseFullSource } from '../financial/reversal.js';
import { writeAudit } from '../lib/audit.js';
import { asInt } from '../lib/validate.js';

function validateBody(body) {
  const deskripsi = (body.deskripsi || '').toString().trim();
  if (!deskripsi) throw err(400, 'missing_field', 'deskripsi wajib diisi');
  const nominal = Number(body.nominal);
  if (!Number.isInteger(nominal) || nominal < 1) throw err(400, 'invalid_value', 'nominal harus integer >= 1');
  const metodeBayar = body.metode_bayar;
  if (!['tunai', 'transfer'].includes(metodeBayar)) throw err(400, 'invalid_value', 'metode_bayar harus tunai atau transfer');
  if (!body.akun_sumber) throw err(400, 'missing_field', 'akun_sumber wajib diisi');
  let tanggal = body.tanggal;
  if (!tanggal) tanggal = new Date().toISOString().slice(0, 10);
  if (!isValidCalendarDate(tanggal)) throw err(400, 'invalid_value', 'tanggal harus format YYYY-MM-DD');
  return { deskripsi, kategori: body.kategori ? String(body.kategori).trim() : null, nominal, metodeBayar, akunSumber: String(body.akun_sumber), tanggal };
}

export async function listPengeluaran(db, request, ctx) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const where = ['deleted_at IS NULL'];
  const bind = [];
  if (params.has('tanggal')) {
    const d = params.get('tanggal');
    if (!isValidCalendarDate(d)) throw err(400, 'invalid_filter', 'tanggal harus format YYYY-MM-DD');
    const { startUtc, endUtc } = wibDateToUtcRange(d);
    where.push('tanggal = ?');
    bind.push(d);
  } else if (params.has('tanggal_from') && params.has('tanggal_to')) {
    if (params.get('tanggal_from') > params.get('tanggal_to')) throw err(400, 'invalid_filter', 'tanggal_from > tanggal_to');
    where.push('tanggal >= ? AND tanggal <= ?');
    bind.push(params.get('tanggal_from'), params.get('tanggal_to'));
  }
  if (params.has('metode_bayar')) { where.push('metode_bayar = ?'); bind.push(params.get('metode_bayar')); }
  if (params.has('akun_sumber')) { where.push('akun_sumber = ?'); bind.push(params.get('akun_sumber')); }
  const q = params.get('q');
  if (q && q.trim()) { where.push('deskripsi LIKE ?'); bind.push(`%${q.trim()}%`); }

  const summary = await db.one(
    `SELECT COUNT(*) AS total_items, COALESCE(SUM(nominal), 0) AS total_nilai FROM pengeluaran WHERE ${where.join(' AND ')}`,
    ...bind
  );
  const limit = Math.min(Number(params.get('limit') || '100'), 200);
  const offset = Math.max(Number(params.get('offset') || '0'), 0);
  const rows = await db.many(
    `SELECT p.*, u.nama AS dicatat_oleh_nama FROM pengeluaran p
       LEFT JOIN users u ON u.id = p.dicatat_oleh
      WHERE ${where.join(' AND ')} ORDER BY p.tanggal DESC, p.id DESC LIMIT ? OFFSET ?`,
    ...[...bind, limit, offset]
  );
  return {
    items: rows,
    total_items: summary.total_items,
    total_nilai: summary.total_nilai,
    filter: { tanggal: params.get('tanggal'), tanggal_from: params.get('tanggal_from'), tanggal_to: params.get('tanggal_to'), metode_bayar: params.get('metode_bayar'), akun_sumber: params.get('akun_sumber'), q: params.get('q') },
  };
}

export async function getPengeluaran(db, request, ctx, idStr) {
  const row = await db.one(
    'SELECT p.*, u.nama AS dicatat_oleh_nama FROM pengeluaran p LEFT JOIN users u ON u.id = p.dicatat_oleh WHERE p.id = ? AND p.deleted_at IS NULL',
    asInt(idStr, { required: true, field: 'id' })
  );
  if (!row) throw err(404, 'not_found', 'Pengeluaran tidak ditemukan');
  const mutasi = await db.many(
    "SELECT id, nama_akun, jumlah, sumber_tipe, mutation_key, created_at FROM mutasi_saldo WHERE sumber_tipe = 'pengeluaran' AND sumber_id = ?",
    row.id
  );
  return { ...row, mutasi_saldo: mutasi };
}

export async function createPengeluaran(db, body, ctx, request) {
  const { user } = ctx.auth;
  const v = validateBody(body);
  await getAccount(db, v.akunSumber);
  const sesi = await requireOpenSession(db);
  const idempotencyKey = request.headers.get('Idempotency-Key') || null;

  if (idempotencyKey) {
    const existing = await db.one(
      'SELECT sumber_id FROM mutasi_saldo WHERE mutation_key = ?',
      `req:${idempotencyKey}:pengeluaran:${v.akunSumber}`
    );
    if (existing && existing.sumber_id) {
      return db.one('SELECT * FROM pengeluaran WHERE id = ?', existing.sumber_id);
    }
  }

  const res = await db.exec(
    `INSERT INTO pengeluaran (deskripsi, kategori, nominal, metode_bayar, akun_sumber, tanggal, dicatat_oleh, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    v.deskripsi, v.kategori, v.nominal, v.metodeBayar, v.akunSumber, v.tanggal, user.id, nowIso()
  );
  const id = res.lastRowId;
  const mutationKey = idempotencyKey
    ? `req:${idempotencyKey}:pengeluaran:${v.akunSumber}`
    : `pengeluaran:${id}:${v.akunSumber}`;

  const mut = await db.exec(
    `INSERT OR IGNORE INTO mutasi_saldo
       (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, created_at)
     VALUES (?, ?, ?, 'pengeluaran', ?, ?, ?)`,
    sesi.id, v.akunSumber, -v.nominal, id, mutationKey, nowIso()
  );

  if (mut.changes === 0) {
    const dup = await db.one('SELECT * FROM mutasi_saldo WHERE mutation_key = ?', mutationKey);
    if (dup && dup.sumber_id && dup.sumber_id !== id) {
      await db.exec('DELETE FROM pengeluaran WHERE id = ?', id);
      return db.one('SELECT * FROM pengeluaran WHERE id = ?', dup.sumber_id);
    }
  }

  const saved = await db.one('SELECT * FROM pengeluaran WHERE id = ?', id);
  await writeAudit(db, {
    userId: user.id, aksi: 'create', tabel: 'pengeluaran', recordId: id,
    dataAfter: { deskripsi: v.deskripsi, nominal: v.nominal, metode_bayar: v.metodeBayar, akun_sumber: v.akunSumber, tanggal: v.tanggal },
  });
  return saved;
}

export async function updatePengeluaran(db, body, ctx, idStr) {
  const { user } = ctx.auth;
  const id = asInt(idStr, { required: true, field: 'id' });
  const old = await db.one('SELECT * FROM pengeluaran WHERE id = ? AND deleted_at IS NULL', id);
  if (!old) throw err(404, 'not_found', 'Pengeluaran tidak ditemukan');

  const v = validateBody(body);
  await getAccount(db, v.akunSumber);
  const sesi = await requireOpenSession(db);
  const actionKey = ctx.idempotencyKey || `peu-${id}-${Date.now()}`;

  await reverseFullSource(db, { sumberTipe: 'pengeluaran', sumberId: id, kasirSesiId: sesi.id, actionKey });

  await db.exec(
    'UPDATE pengeluaran SET deskripsi = ?, kategori = ?, nominal = ?, metode_bayar = ?, akun_sumber = ?, tanggal = ?, updated_at = ? WHERE id = ?',
    v.deskripsi, v.kategori, v.nominal, v.metodeBayar, v.akunSumber, v.tanggal, nowIso(), id
  );
  await db.exec(
    `INSERT OR IGNORE INTO mutasi_saldo
       (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, created_at)
     VALUES (?, ?, ?, 'pengeluaran', ?, ?, ?)`,
    sesi.id, v.akunSumber, -v.nominal, id, `pengeluaran:${id}:${v.akunSumber}:v:${actionKey}`, nowIso()
  );
  await writeAudit(db, {
    userId: user.id, aksi: 'update', tabel: 'pengeluaran', recordId: id,
    dataBefore: { deskripsi: old.deskripsi, nominal: old.nominal, metode_bayar: old.metode_bayar, akun_sumber: old.akun_sumber, tanggal: old.tanggal },
    dataAfter: { deskripsi: v.deskripsi, nominal: v.nominal, metode_bayar: v.metodeBayar, akun_sumber: v.akunSumber, tanggal: v.tanggal },
  });
  return { id, message: 'Pengeluaran berhasil diperbarui' };
}

export async function deletePengeluaran(db, body, ctx, idStr) {
  const { user } = ctx.auth;
  const id = asInt(idStr, { required: true, field: 'id' });
  const old = await db.one('SELECT * FROM pengeluaran WHERE id = ? AND deleted_at IS NULL', id);
  if (!old) throw err(404, 'not_found', 'Pengeluaran tidak ditemukan');

  const sesi = await requireOpenSession(db);
  const actionKey = ctx.idempotencyKey || `ped-${id}-${Date.now()}`;
  const reversal = await reverseFullSource(db, { sumberTipe: 'pengeluaran', sumberId: id, kasirSesiId: sesi.id, actionKey });
  const reason = body.deleted_reason || 'manual soft-delete';

  await db.exec(
    'UPDATE pengeluaran SET deleted_at = ?, deleted_by = ?, deleted_reason = ?, updated_at = ? WHERE id = ?',
    nowIso(), user.id, reason, nowIso(), id
  );
  await writeAudit(db, {
    userId: user.id, aksi: 'soft_delete', tabel: 'pengeluaran', recordId: id,
    dataBefore: { deskripsi: old.deskripsi, nominal: old.nominal, metode_bayar: old.metode_bayar, akun_sumber: old.akun_sumber },
    dataAfter: { deleted_reason: reason, reversal: reversal.reversed },
  });
  return { id, status: 'soft_deleted', reversal: reversal.reversed };
}