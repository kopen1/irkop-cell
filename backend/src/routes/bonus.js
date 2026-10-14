import { err } from '../lib/errors.js';
import { readBody, asInt, asString, asEnum, asDate } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { nowIso, wibDateToday } from '../lib/time.js';
import { requireAdmin } from '../lib/auth.js';
import { getAccount } from '../financial/akun.js';
import { requireSessionForToday } from '../financial/kasir.js';

// ---------------------------------------------------------------------------
// Aturan bonus: produk/kategori tertentu → bonus per unit untuk kasir.
// ---------------------------------------------------------------------------

// GET /api/bonus/aturan
export async function listAturan(db, request, ctx) {
  requireAdmin(ctx);
  const rows = await db.many(
    `SELECT a.*,
       CASE WHEN a.jenis_target = 'produk'
            THEN (SELECT p.nama FROM produk p WHERE p.id = a.target_id)
            ELSE (SELECT k.nama FROM kategori_produk k WHERE k.id = a.target_id)
       END AS target_nama
     FROM bonus_aturan a ORDER BY a.aktif DESC, a.id DESC`
  );
  return { items: rows };
}

function validasiTarget(db, jenisTarget, targetId) {
  if (jenisTarget === 'produk') {
    return db.one('SELECT id FROM produk WHERE id = ? AND deleted_at IS NULL', targetId);
  }
  return db.one('SELECT id FROM kategori_produk WHERE id = ? AND deleted_at IS NULL', targetId);
}

// POST /api/bonus/aturan  { nama, jenis_target, target_id, jumlah }
export async function createAturan(db, request, ctx) {
  const admin = requireAdmin(ctx);
  const body = await readBody(request);
  const nama = asString(body.nama, { required: true, field: 'nama', max: 100 });
  const jenisTarget = asEnum(body.jenis_target, ['produk', 'kategori'], { required: true, field: 'jenis_target' });
  const targetId = asInt(body.target_id, { required: true, field: 'target_id', min: 1 });
  const jumlah = asInt(body.jumlah, { required: true, field: 'jumlah', min: 1 });
  const target = await validasiTarget(db, jenisTarget, targetId);
  if (!target) throw err(400, 'invalid_target', `${jenisTarget === 'produk' ? 'Produk' : 'Kategori'} tidak ditemukan`);

  const res = await db.exec(
    'INSERT INTO bonus_aturan (nama, jenis_target, target_id, jumlah) VALUES (?, ?, ?, ?)',
    nama, jenisTarget, targetId, jumlah
  );
  const id = res.lastRowId;
  await writeAudit(db, { userId: admin.id, aksi: 'create', tabel: 'bonus_aturan', recordId: id, dataAfter: { nama, jenis_target: jenisTarget, target_id: targetId, jumlah } });
  return { id, nama, jenis_target: jenisTarget, target_id: targetId, jumlah, aktif: 1 };
}

// PUT /api/bonus/aturan/:id
export async function updateAturan(db, request, ctx, idStr) {
  const admin = requireAdmin(ctx);
  const id = asInt(idStr, { required: true, field: 'id' });
  const old = await db.one('SELECT * FROM bonus_aturan WHERE id = ?', id);
  if (!old) throw err(404, 'not_found', 'Aturan bonus tidak ditemukan');
  const body = await readBody(request);

  const sets = [];
  const vals = [];
  if (body.nama !== undefined) { sets.push('nama = ?'); vals.push(asString(body.nama, { field: 'nama', max: 100 })); }
  if (body.jenis_target !== undefined || body.target_id !== undefined) {
    const jenisTarget = body.jenis_target !== undefined
      ? asEnum(body.jenis_target, ['produk', 'kategori'], { field: 'jenis_target' })
      : old.jenis_target;
    const targetId = body.target_id !== undefined
      ? asInt(body.target_id, { field: 'target_id', min: 1 })
      : old.target_id;
    const target = await validasiTarget(db, jenisTarget, targetId);
    if (!target) throw err(400, 'invalid_target', 'Target tidak ditemukan');
    sets.push('jenis_target = ?', 'target_id = ?');
    vals.push(jenisTarget, targetId);
  }
  if (body.jumlah !== undefined) { sets.push('jumlah = ?'); vals.push(asInt(body.jumlah, { field: 'jumlah', min: 1 })); }
  if (body.aktif !== undefined) { sets.push('aktif = ?'); vals.push(asInt(body.aktif, { field: 'aktif', min: 0, max: 1 })); }
  if (!sets.length) throw err(400, 'missing_field', 'Tidak ada field yang diubah');
  sets.push('updated_at = ?');
  vals.push(nowIso(), id);
  await db.exec(`UPDATE bonus_aturan SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  await writeAudit(db, { userId: admin.id, aksi: 'update', tabel: 'bonus_aturan', recordId: id, dataBefore: old, dataAfter: body });
  return { id, message: 'Aturan bonus diperbarui' };
}

// DELETE /api/bonus/aturan/:id — nonaktifkan (aktif=0), bukan hapus,
// supaya akru lama tetap bisa dibaca.
export async function deleteAturan(db, request, ctx, idStr) {
  const admin = requireAdmin(ctx);
  const id = asInt(idStr, { required: true, field: 'id' });
  const old = await db.one('SELECT * FROM bonus_aturan WHERE id = ?', id);
  if (!old) throw err(404, 'not_found', 'Aturan bonus tidak ditemukan');
  await db.exec('UPDATE bonus_aturan SET aktif = 0, updated_at = ? WHERE id = ?', nowIso(), id);
  await writeAudit(db, { userId: admin.id, aksi: 'delete', tabel: 'bonus_aturan', recordId: id, dataBefore: old });
  return { id, aktif: 0, message: 'Aturan bonus dinonaktifkan' };
}

// ---------------------------------------------------------------------------
// Akru bonus penjualan.
// ---------------------------------------------------------------------------

// GET /api/bonus?tanggal=&user_id=&status=
export async function listBonus(db, request, ctx) {
  requireAdmin(ctx);
  const url = new URL(request.url);
  const params = url.searchParams;
  const where = ['b.deleted_at IS NULL'];
  const bind = [];
  if (params.has('tanggal')) {
    const d = asDate(params.get('tanggal'), { field: 'tanggal' });
    where.push('t.tanggal_transaksi = ?'); bind.push(d);
  }
  if (params.has('user_id')) { where.push('b.user_id = ?'); bind.push(Number(params.get('user_id'))); }
  if (params.has('status')) {
    const st = params.get('status');
    if (st === 'belum') where.push('b.dibayar_at IS NULL');
    else if (st === 'lunas') where.push('b.dibayar_at IS NOT NULL');
    else throw err(400, 'invalid_filter', 'status harus belum atau lunas');
  }
  const rows = await db.many(
    `SELECT b.*, t.tanggal_transaksi AS tanggal, u.nama AS nama_kasir,
            a.nama AS aturan_nama, a.jenis_target
       FROM bonus_penjualan b
       JOIN transaksi t ON t.id = b.transaksi_id
       LEFT JOIN users u ON u.id = b.user_id
       LEFT JOIN bonus_aturan a ON a.id = b.aturan_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.tanggal_transaksi DESC, b.id DESC`,
    ...bind
  );
  return { items: rows };
}

// GET /api/bonus/unpaid — bonus belum dibayar, dikelompokkan per kasir.
export async function listBonusUnpaid(db, request, ctx) {
  requireAdmin(ctx);
  const rows = await db.many(
    `SELECT b.user_id, COALESCE(u.nama, '?') AS nama,
            COUNT(*) AS jumlah_transaksi, COALESCE(SUM(b.jumlah), 0) AS total
       FROM bonus_penjualan b LEFT JOIN users u ON u.id = b.user_id
      WHERE b.deleted_at IS NULL AND b.dibayar_at IS NULL
      GROUP BY b.user_id, u.nama ORDER BY nama`
  );
  return { items: rows.map((r) => ({ ...r, jumlah_transaksi: Number(r.jumlah_transaksi), total: Number(r.total) })) };
}

// POST /api/bonus/bayar { user_id, akun? } — bayar SEMUA bonus belum
// dibayar milik satu kasir: 1 Pengeluaran (kategori 'bonus') dari
// akun (default Tunai Laci) + mutasi saldo + tandai lunas.
// Jalur yang sama dengan bayarGaji.
export async function bayarBonus(db, request, ctx) {
  const admin = requireAdmin(ctx);
  const body = await readBody(request);
  const userId = asInt(body.user_id, { required: true, field: 'user_id' });
  const user = await db.one('SELECT id, nama FROM users WHERE id = ?', userId);
  if (!user) throw err(400, 'invalid_user', 'User tidak ditemukan');
  const akun = body.akun ? (await getAccount(db, body.akun)).nama_akun : 'Tunai Laci';

  const unpaid = await db.one(
    'SELECT COUNT(*) AS n, COALESCE(SUM(jumlah), 0) AS total FROM bonus_penjualan WHERE user_id = ? AND deleted_at IS NULL AND dibayar_at IS NULL',
    userId
  );
  const total = Number(unpaid.total);
  if (total <= 0) throw err(400, 'invalid_value', 'Tidak ada bonus yang belum dibayar');

  const sesi = await requireSessionForToday(db);
  const ts = nowIso();
  const marker = `[bonus] Bayar bonus penjualan ${user.nama}`;
  const res = await db.exec(
    `INSERT INTO pengeluaran (deskripsi, kategori, nominal, metode_bayar, akun_sumber, tanggal, dicatat_oleh, created_at)
     VALUES (?, 'bonus', ?, 'tunai', ?, ?, ?, ?)`,
    marker, total, akun, wibDateToday(), admin.id, ts
  );
  const pengeluaranId = res.lastRowId;
  await db.exec(
    `INSERT OR IGNORE INTO mutasi_saldo (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, created_at)
     VALUES (?, ?, ?, 'pengeluaran', ?, ?, ?)`,
    sesi.id, akun, -total, pengeluaranId, `bonus-bayar:${userId}:${pengeluaranId}`, ts
  );
  await db.exec(
    'UPDATE bonus_penjualan SET dibayar_at = ?, dibayar_oleh = ? WHERE user_id = ? AND deleted_at IS NULL AND dibayar_at IS NULL',
    ts, admin.id, userId
  );
  await writeAudit(db, {
    userId: admin.id, aksi: 'bayar_bonus', tabel: 'bonus_penjualan', recordId: userId,
    dataAfter: { user_id: userId, nama: user.nama, total, akun, pengeluaran_id: pengeluaranId, jumlah_transaksi: Number(unpaid.n) },
  });
  return { user_id: userId, nama: user.nama, total, jumlah_transaksi: Number(unpaid.n), akun, pengeluaran_id: pengeluaranId, status: 'dibayar' };
}
