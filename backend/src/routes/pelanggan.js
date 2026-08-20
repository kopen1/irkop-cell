import { err } from '../lib/errors.js';
import { readBody } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { nowIso } from '../lib/time.js';
import { randomToken } from '../lib/password.js';

export async function listPelanggan(db, request, ctx) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const where = ['p.merged_into_id IS NULL'];
  const bind = [];
  const q = params.get('q');
  if (q && q.trim()) { where.push('(p.nama LIKE ? OR p.telepon LIKE ?)'); bind.push(`%${q.trim()}%`, `%${q.trim()}%`); }
  const rows = await db.many(
    `SELECT p.id, p.nama, p.telepon, p.total_belanja, p.frekuensi_transaksi, p.created_at,
            (SELECT GROUP_CONCAT(CONCAT(a.nilai, ':', a.tipe), ',') FROM pelanggan_alias a WHERE a.pelanggan_id = p.id) AS alias,
            (SELECT COUNT(*) FROM transaksi t WHERE t.pelanggan_id = p.id AND t.deleted_at IS NULL) AS jumlah_transaksi
       FROM pelanggan p WHERE ${where.join(' AND ')} ORDER BY p.total_belanja DESC`,
    ...bind
  );
  return { items: rows };
}

export async function getPelanggan(db, request, ctx, idStr) {
  const p = await db.one('SELECT * FROM pelanggan WHERE id = ? AND merged_into_id IS NULL', idStr);
  if (!p) throw err(404, 'not_found', 'Pelanggan tidak ditemukan');
  const alias = await db.many('SELECT * FROM pelanggan_alias WHERE pelanggan_id = ?', p.id);
  const transaksi = await db.many(
    'SELECT * FROM transaksi WHERE pelanggan_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50',
    p.id
  );
  const kasbon = await db.many('SELECT * FROM kasbon WHERE pelanggan_id = ? ORDER BY id DESC', p.id);
  return { ...p, alias, riwayat_transaksi: transaksi, kasbon };
}

export async function createPelanggan(db, request, ctx) {
  const { user } = ctx.auth;
  const body = await readBody(request);
  const nama = String(body.nama || '').trim();
  if (!nama) throw err(400, 'missing_field', 'nama pelanggan wajib diisi');
  const res = await db.exec(
    'INSERT INTO pelanggan (nama, telepon, created_at) VALUES (?, ?, ?)',
    nama, body.telepon ? String(body.telepon).trim() : null, nowIso()
  );
  await writeAudit(db, { userId: user.id, aksi: 'create', tabel: 'pelanggan', recordId: res.lastRowId, dataAfter: { nama, telepon: body.telepon } });
  return { id: res.lastRowId, nama, telepon: body.telepon || null };
}

export async function updatePelanggan(db, request, ctx, idStr) {
  const { user } = ctx.auth;
  const body = await readBody(request);
  const p = await db.one('SELECT * FROM pelanggan WHERE id = ? AND merged_into_id IS NULL', idStr);
  if (!p) throw err(404, 'not_found', 'Pelanggan tidak ditemukan');
  const nama = body.nama != null ? String(body.nama).trim() : p.nama;
  const telepon = body.telepon != null ? (body.telepon ? String(body.telepon).trim() : null) : p.telepon;
  if (!nama) throw err(400, 'missing_field', 'nama pelanggan wajib diisi');
  await db.exec('UPDATE pelanggan SET nama = ?, telepon = ?, updated_at = ? WHERE id = ?', nama, telepon, nowIso(), p.id);
  await writeAudit(db, { userId: user.id, aksi: 'update', tabel: 'pelanggan', recordId: p.id, dataBefore: { nama: p.nama, telepon: p.telepon }, dataAfter: { nama, telepon } });
  return { id: p.id, nama, telepon };
}

export async function deletePelanggan(db, request, ctx, idStr) {
  const { user } = ctx.auth;
  const p = await db.one('SELECT * FROM pelanggan WHERE id = ? AND merged_into_id IS NULL', idStr);
  if (!p) throw err(404, 'not_found', 'Pelanggan tidak ditemukan');
  await db.exec('DELETE FROM pelanggan WHERE id = ?', p.id);
  await writeAudit(db, { userId: user.id, aksi: 'delete', tabel: 'pelanggan', recordId: p.id, dataBefore: { nama: p.nama, telepon: p.telepon } });
  return { deleted: true, id: p.id };
}

export async function mergePelanggan(db, request, ctx) {
  const { user } = ctx.auth;
  const body = await readBody(request);
  const idUtama = Number(body.id_utama);
  const idGabung = Number(body.id_gabung);
  if (!Number.isInteger(idUtama) || !Number.isInteger(idGabung) || idUtama === idGabung) {
    throw err(400, 'invalid_value', 'id_utama dan id_gabung harus berbeda dan valid');
  }
  const utama = await db.one('SELECT * FROM pelanggan WHERE id = ?', idUtama);
  const gabung = await db.one('SELECT * FROM pelanggan WHERE id = ?', idGabung);
  if (!utama || !gabung) throw err(404, 'not_found', 'Pelanggan tidak ditemukan');
  if (gabung.merged_into_id) throw err(409, 'already_merged', `Pelanggan ${idGabung} sudah di-merge`);

  const stmts = [
    db.raw.prepare('UPDATE pelanggan SET merged_into_id = ? WHERE id = ?').bind(idUtama, idGabung),
    db.raw.prepare(
      'UPDATE pelanggan SET total_belanja = total_belanja + ?, frekuensi_transaksi = frekuensi_transaksi + ?, updated_at = ? WHERE id = ?'
    ).bind(gabung.total_belanja, gabung.frekuensi_transaksi, nowIso(), idUtama),
    db.raw.prepare(
      `INSERT INTO pelanggan_alias (pelanggan_id, tipe, nilai, sumber, created_at)
       VALUES (?, 'nama', ?, 'manual', ?)`
    ).bind(idUtama, `${gabung.nama} (merge dari id ${idGabung})`, nowIso()),
  ];
  await db.batch(stmts);
  await writeAudit(db, { userId: user.id, aksi: 'merge', tabel: 'pelanggan', recordId: idUtama, dataAfter: { id_utama: idUtama, id_gabung: idGabung } });
  return { id_utama: idUtama, id_gabung: idGabung, message: 'Pelanggan digabungkan' };
}