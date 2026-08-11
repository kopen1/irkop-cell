import { err } from '../lib/errors.js';
import { requireAdmin } from '../lib/auth.js';
import { isValidCalendarDate, wibDateToUtcRange } from '../lib/time.js';

export async function listLogs(db, request, ctx) {
  requireAdmin(ctx);
  const url = new URL(request.url);
  const params = url.searchParams;
  const where = ['1=1'];
  const bind = [];
  if (params.has('tabel')) { where.push('tabel_terkait = ?'); bind.push(params.get('tabel')); }
  if (params.has('aksi')) { where.push('aksi = ?'); bind.push(params.get('aksi')); }
  if (params.has('user_id')) { where.push('user_id = ?'); bind.push(Number(params.get('user_id'))); }
  if (params.has('tanggal')) {
    const d = params.get('tanggal');
    if (!isValidCalendarDate(d)) throw err(400, 'invalid_filter', 'tanggal tidak valid');
    const { startUtc, endUtc } = wibDateToUtcRange(d);
    where.push('created_at >= ? AND created_at < ?');
    bind.push(startUtc, endUtc);
  }
  const limit = Math.min(Number(params.get('limit') || '100'), 500);
  const offset = Math.max(Number(params.get('offset') || '0'), 0);
  const rows = await db.many(
    `SELECT l.*, u.nama AS user_nama
       FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
      WHERE ${where.join(' AND ')} ORDER BY l.id DESC LIMIT ? OFFSET ?`,
    ...[...bind, limit, offset]
  );
  const count = await db.one(`SELECT COUNT(*) AS total FROM audit_log WHERE ${where.join(' AND ')}`, ...bind);
  return { items: rows, total_items: count.total };
}