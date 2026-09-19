import { err } from '../lib/errors.js';
import { readBody, asInt, asDate, asEnum } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { nowIso, isValidCalendarDate, wibDateToday } from '../lib/time.js';
import { requireAdmin } from '../lib/auth.js';
import { hitungGajiOwner } from '../financial/gaji.js';
import { requireSessionForToday } from '../financial/kasir.js';
import { getAccount } from '../financial/akun.js';

export async function listGaji(db, request, ctx) {
  requireAdmin(ctx);
  const url = new URL(request.url);
  const params = url.searchParams;
  const where = ['1=1'];
  const bind = [];
  if (params.has('month')) {
    const m = /^(\d{4})-(\d{2})$/.exec(params.get('month') || '');
    if (!m) throw err(400, 'invalid_filter', 'month harus format YYYY-MM');
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) throw err(400, 'invalid_filter', 'month tidak valid');
    const start = `${m[1]}-${m[2]}-01`;
    const end = `${m[1]}-${m[2]}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
    where.push('g.tanggal >= ? AND g.tanggal <= ?');
    bind.push(start, end);
  } else if (params.has('tanggal')) {
    const d = params.get('tanggal');
    if (!isValidCalendarDate(d)) throw err(400, 'invalid_filter', 'tanggal tidak valid');
    where.push('g.tanggal = ?'); bind.push(d);
  } else if (params.has('tanggal_from') || params.has('tanggal_to')) {
    if (!params.get('tanggal_from') || !params.get('tanggal_to')) throw err(400, 'invalid_filter', 'tanggal_from & tanggal_to wajib bersama');
    where.push('g.tanggal >= ? AND g.tanggal <= ?'); bind.push(params.get('tanggal_from'), params.get('tanggal_to'));
  }
  if (params.has('user_id')) { where.push('g.user_id = ?'); bind.push(Number(params.get('user_id'))); }
  const rows = await db.many(
    `SELECT g.*, u.nama AS nama_karyawan
       FROM gaji_harian g LEFT JOIN users u ON u.id = g.user_id
      WHERE ${where.join(' AND ')} ORDER BY g.tanggal DESC, g.id DESC`,
    ...bind
  );
  return { items: rows };
}

export async function createGajiManual(db, request, ctx) {
  const admin = requireAdmin(ctx);
  const body = await readBody(request);
  const userId = asInt(body.user_id, { required: true, field: 'user_id' });
  const tanggal = asDate(body.tanggal, { required: true, field: 'tanggal' });
  const nominal = asInt(body.nominal, { required: true, field: 'nominal', min: 0 });
  const u = await db.one('SELECT id, role FROM users WHERE id = ?', userId);
  if (!u) throw err(400, 'invalid_user', 'User tidak ditemukan');
  if (u.role !== 'karyawan') throw err(400, 'invalid_user', 'Rate gaji hanya untuk role karyawan');

  const ts = nowIso();
  await db.exec(
    `INSERT INTO gaji_harian (user_id, tanggal, nominal, sumber, catatan, diedit_oleh, created_at)
     VALUES (?, ?, ?, 'manual_edit', ?, ?, ?)
     ON CONFLICT(user_id, tanggal) DO UPDATE SET
       nominal     = excluded.nominal,
       sumber      = 'manual_edit',
       catatan     = excluded.catatan,
       diedit_oleh = excluded.diedit_oleh,
       updated_at  = excluded.created_at`,
    userId, tanggal, nominal, body.catatan || null, admin.id, ts
  );
  const row = await db.one('SELECT id FROM gaji_harian WHERE user_id = ? AND tanggal = ?', userId, tanggal);
  const id = row.id;
  await writeAudit(db, { userId: admin.id, aksi: 'create', tabel: 'gaji_harian', recordId: id, dataAfter: { user_id: userId, tanggal, nominal, sumber: 'manual_edit' } });
  return { id, user_id: userId, tanggal, nominal, sumber: 'manual_edit' };
}

export async function updateGaji(db, request, ctx, idStr) {
  const admin = requireAdmin(ctx);
  const id = asInt(idStr, { required: true, field: 'id' });
  const body = await readBody(request);
  const old = await db.one('SELECT * FROM gaji_harian WHERE id = ?', id);
  if (!old) throw err(404, 'not_found', 'Gaji harian tidak ditemukan');

  const sets = [];
  const vals = [];
  if (body.nominal !== undefined) { sets.push('nominal = ?'); vals.push(asInt(body.nominal, { field: 'nominal', min: 0 })); }
  if (body.catatan !== undefined) { sets.push('catatan = ?'); vals.push(body.catatan || null); }
  sets.push("sumber = 'manual_edit'");
  sets.push('diedit_oleh = ?');
  sets.push('updated_at = ?');
  vals.push(admin.id, nowIso(), id);
  await db.exec(`UPDATE gaji_harian SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  await writeAudit(db, { userId: admin.id, aksi: 'update', tabel: 'gaji_harian', recordId: id, dataBefore: old, dataAfter: body });
  return { id, message: 'Gaji harian diperbarui' };
}

// GET /api/gaji/owner?tanggal=YYYY-MM-DD — hitung gaji owner (jaga + 50% service)
export async function getOwnerGaji(db, request, ctx) {
  requireAdmin(ctx);
  const url = new URL(request.url);
  const tanggal = asDate(url.searchParams.get('tanggal'), { required: true, field: 'tanggal' });
  return hitungGajiOwner(db, tanggal);
}

// GET /api/gaji/unpaid — gaji yang belum dibayar, dikelompokkan per orang.
export async function listGajiUnpaid(db, request, ctx) {
  requireAdmin(ctx);
  const rows = await db.many(
    `SELECT g.user_id, COALESCE(u.nama, '?') AS nama, COUNT(*) AS jumlah_hari,
            COALESCE(SUM(g.nominal), 0) AS total,
            MIN(g.tanggal) AS dari_tanggal, MAX(g.tanggal) AS sampai_tanggal
       FROM gaji_harian g LEFT JOIN users u ON u.id = g.user_id
      WHERE g.dibayar_at IS NULL
      GROUP BY g.user_id, u.nama ORDER BY nama`
  );
  return { items: rows.map((r) => ({ ...r, jumlah_hari: Number(r.jumlah_hari), total: Number(r.total) })) };
}

// POST /api/gaji/bayar  { user_id, akun? } — bayar SEMUA gaji belum dibayar milik
// satu orang: buat 1 Pengeluaran (biaya) dari akun (default Tunai Laci) + tandai lunas.
export async function bayarGaji(db, request, ctx) {
  const admin = requireAdmin(ctx);
  const body = await readBody(request);
  const userId = asInt(body.user_id, { required: true, field: 'user_id' });
  const user = await db.one('SELECT id, nama FROM users WHERE id = ?', userId);
  if (!user) throw err(400, 'invalid_user', 'User tidak ditemukan');
  const akun = body.akun ? (await getAccount(db, body.akun)).nama_akun : 'Tunai Laci';

  const unpaid = await db.one(
    'SELECT COUNT(*) AS n, COALESCE(SUM(nominal), 0) AS total FROM gaji_harian WHERE user_id = ? AND dibayar_at IS NULL',
    userId
  );
  const total = Number(unpaid.total);
  if (total <= 0) throw err(400, 'invalid_value', 'Tidak ada gaji yang belum dibayar');

  const sesi = await requireSessionForToday(db);
  const ts = nowIso();
  const marker = `[gaji] Bayar gaji ${user.nama}`;
  const res = await db.exec(
    `INSERT INTO pengeluaran (deskripsi, kategori, nominal, metode_bayar, akun_sumber, tanggal, dicatat_oleh, created_at)
     VALUES (?, 'gaji', ?, 'tunai', ?, ?, ?, ?)`,
    marker, total, akun, wibDateToday(), admin.id, ts
  );
  const pengeluaranId = res.lastRowId;
  await db.exec(
    `INSERT OR IGNORE INTO mutasi_saldo (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, created_at)
     VALUES (?, ?, ?, 'pengeluaran', ?, ?, ?)`,
    sesi.id, akun, -total, pengeluaranId, `gaji-bayar:${userId}:${pengeluaranId}`, ts
  );
  await db.exec(
    'UPDATE gaji_harian SET dibayar_at = ?, dibayar_oleh = ? WHERE user_id = ? AND dibayar_at IS NULL',
    ts, admin.id, userId
  );
  await writeAudit(db, {
    userId: admin.id, aksi: 'bayar_gaji', tabel: 'gaji_harian', recordId: userId,
    dataAfter: { user_id: userId, nama: user.nama, total, akun, pengeluaran_id: pengeluaranId, jumlah_hari: Number(unpaid.n) },
  });
  return { user_id: userId, nama: user.nama, total, jumlah_hari: Number(unpaid.n), akun, pengeluaran_id: pengeluaranId, status: 'dibayar' };
}

export async function listRateGaji(db, request, ctx) {
  requireAdmin(ctx);
  const rows = await db.many(
    `SELECT kr.id, kr.user_id, u.nama AS nama_karyawan, kr.tipe, kr.rate_flat,
            (SELECT GROUP_CONCAT(hari || ':' || rate, ',') FROM karyawan_rate_harian krh WHERE krh.user_id = kr.user_id) AS custom_harian
       FROM karyawan_rate kr LEFT JOIN users u ON u.id = kr.user_id ORDER BY u.nama`
  );
  return { items: rows };
}

export async function setRateGaji(db, request, ctx) {
  const admin = requireAdmin(ctx);
  const body = await readBody(request);
  const userId = asInt(body.user_id, { required: true, field: 'user_id' });
  const tipe = asEnum(body.tipe, ['flat', 'custom_harian'], { required: true, field: 'tipe' });
  const u = await db.one('SELECT id, role FROM users WHERE id = ?', userId);
  if (!u) throw err(400, 'invalid_user', 'User tidak ditemukan');
  if (u.role !== 'karyawan') throw err(400, 'invalid_user', 'Rate gaji hanya untuk role karyawan');

  const stmts = [];
  if (tipe === 'flat') {
    const rateFlat = asInt(body.rate_flat, { required: true, field: 'rate_flat', min: 0 });
    stmts.push(
      db.raw.prepare(
        `INSERT INTO karyawan_rate (user_id, tipe, rate_flat, created_at) VALUES (?, 'flat', ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET tipe='flat', rate_flat=excluded.rate_flat, updated_at=?`
      ).bind(userId, rateFlat, nowIso(), nowIso())
    );
  } else {
    if (!Array.isArray(body.custom_harian) || body.custom_harian.length !== 7) {
      throw err(400, 'invalid_value', 'custom_harian wajib berisi rate untuk 7 hari (senin..minggu)');
    }
    stmts.push(
      db.raw.prepare(
        `INSERT INTO karyawan_rate (user_id, tipe, rate_flat, created_at) VALUES (?, 'custom_harian', NULL, ?)
         ON CONFLICT(user_id) DO UPDATE SET tipe='custom_harian', updated_at=?`
      ).bind(userId, nowIso(), nowIso())
    );
    stmts.push(db.raw.prepare('DELETE FROM karyawan_rate_harian WHERE user_id = ?').bind(userId));
    const byHari = {};
    for (const r of body.custom_harian) {
      const hari = asEnum(r.hari, ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'], { field: 'hari' });
      byHari[hari] = asInt(r.rate, { field: `rate ${hari}`, min: 0 });
    }
    for (const hari of Object.keys(byHari)) {
      stmts.push(
        db.raw.prepare('INSERT INTO karyawan_rate_harian (user_id, hari, rate) VALUES (?, ?, ?)')
          .bind(userId, hari, byHari[hari])
      );
    }
  }
  await db.batch(stmts);
  await writeAudit(db, { userId: admin.id, aksi: 'update', tabel: 'karyawan_rate', recordId: userId, dataAfter: body });
  return { user_id: userId, tipe, message: 'Rate gaji disimpan' };
}