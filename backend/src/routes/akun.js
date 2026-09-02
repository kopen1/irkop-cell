import { err } from '../lib/errors.js';
import { readBody, asInt } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { nowIso } from '../lib/time.js';
import { listActiveAccounts } from '../financial/akun.js';

export async function listAkun(db, request, ctx) {
  const rows = await listActiveAccounts(db);
  return { items: rows };
}

export async function createAkun(db, request, ctx) {
  const { user } = ctx.auth;
  if (user.role !== 'admin') throw err(403, 'forbidden', 'Admin only');
  const body = await readBody(request);
  const namaAkun = String(body.nama_akun || '').trim();
  const tipe = body.tipe;
  if (!namaAkun) throw err(400, 'missing_field', 'nama_akun wajib diisi');
  if (!['tunai', 'bank', 'e_wallet', 'digital', 'lainnya'].includes(tipe)) throw err(400, 'invalid_value', 'tipe akun tidak valid');
  const dup = await db.one('SELECT id FROM akun_master WHERE nama_akun = ?', namaAkun);
  if (dup) throw err(409, 'duplicate_akun', 'Nama akun sudah ada');
  const res = await db.exec('INSERT INTO akun_master (nama_akun, tipe, aktif, created_at) VALUES (?, ?, 1, ?)', namaAkun, tipe, nowIso());
  await writeAudit(db, { userId: user.id, aksi: 'create', tabel: 'akun_master', recordId: res.lastRowId, dataAfter: { nama_akun: namaAkun, tipe } });
  return { id: res.lastRowId, nama_akun: namaAkun, tipe, aktif: 1 };
}

export async function updateAkun(db, request, ctx, idStr) {
  const { user } = ctx.auth;
  if (user.role !== 'admin') throw err(403, 'forbidden', 'Admin only');
  const body = await readBody(request);
  const id = asInt(idStr, { required: true, field: 'id' });
  const old = await db.one('SELECT * FROM akun_master WHERE id = ?', id);
  if (!old) throw err(404, 'not_found', 'Akun tidak ditemukan');
  const sets = [];
  const vals = [];
  if (body.nama_akun !== undefined) {
    const nama = String(body.nama_akun).trim();
    if (!nama) throw err(400, 'missing_field', 'nama_akun wajib diisi');
    const dup = await db.one('SELECT id FROM akun_master WHERE nama_akun = ? AND id != ?', nama, id);
    if (dup) throw err(409, 'duplicate_akun', 'Nama akun sudah ada');
    sets.push('nama_akun = ?'); vals.push(nama);
  }
  if (body.tipe !== undefined) {
    if (!['tunai', 'bank', 'e_wallet', 'digital', 'lainnya'].includes(body.tipe)) throw err(400, 'invalid_value', 'tipe tidak valid');
    sets.push('tipe = ?'); vals.push(body.tipe);
  }
  if (body.aktif !== undefined) {
    const aktif = body.aktif === true || body.aktif === 1 || body.aktif === '1' ? 1 : 0;
    sets.push('aktif = ?'); vals.push(aktif);
  }
  if (!sets.length) throw err(400, 'no_changes', 'Tidak ada perubahan');
  sets.push('updated_at = ?'); vals.push(nowIso()); vals.push(id);
  await db.exec(`UPDATE akun_master SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  await writeAudit(db, { userId: user.id, aksi: 'update', tabel: 'akun_master', recordId: id, dataBefore: old, dataAfter: body });
  return { id, message: 'Akun diperbarui' };
}

export async function deleteAkun(db, request, ctx, idStr) {
  const { user } = ctx.auth;
  if (user.role !== 'admin') throw err(403, 'forbidden', 'Admin only');
  const id = asInt(idStr, { required: true, field: 'id' });
  const old = await db.one('SELECT * FROM akun_master WHERE id = ?', id);
  if (!old) throw err(404, 'not_found', 'Akun tidak ditemukan');
  if (old.aktif === 0) throw err(409, 'already_inactive', 'Akun sudah nonaktif');
  await db.exec('UPDATE akun_master SET aktif = 0, updated_at = ? WHERE id = ?', nowIso(), id);
  await writeAudit(db, { userId: user.id, aksi: 'delete', tabel: 'akun_master', recordId: id, dataBefore: old, dataAfter: { ...old, aktif: 0 } });
  return { id, message: 'Akun dinonaktifkan' };
}
