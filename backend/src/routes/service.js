import { err } from '../lib/errors.js';
import { readBody, asInt, asDate, asBool } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { nowIso, wibDateToday } from '../lib/time.js';

const STATUS_SERVICE = ['masuk', 'proses', 'selesai', 'diambil'];

export async function listService(db, request, ctx) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const where = ['s.deleted_at IS NULL'];
  const bind = [];
  if (params.has('status')) {
    if (!STATUS_SERVICE.includes(params.get('status'))) throw err(400, 'invalid_filter', 'status tidak valid');
    where.push('s.status = ?');
    bind.push(params.get('status'));
  }
  if (params.has('pelanggan_id')) { where.push('s.pelanggan_id = ?'); bind.push(Number(params.get('pelanggan_id'))); }
  const rows = await db.many(
    `SELECT s.*, p.nama AS pelanggan_nama
       FROM service_hp s LEFT JOIN pelanggan p ON p.id = s.pelanggan_id
      WHERE ${where.join(' AND ')} ORDER BY s.tanggal_masuk DESC, s.id DESC`,
    ...bind
  );
  return { items: rows };
}

export async function createService(db, request, ctx) {
  const { user } = ctx.auth;
  const body = await readBody(request);
  const pelangganId = asInt(body.pelanggan_id, { required: true, field: 'pelanggan_id' });
  const namaDevice = String(body.nama_device || '').trim();
  const deskripsi = String(body.deskripsi_kerusakan || '').trim();
  if (!namaDevice) throw err(400, 'missing_field', 'nama_device wajib diisi');
  if (!deskripsi) throw err(400, 'missing_field', 'deskripsi_kerusakan wajib diisi');
  const tanggalMasuk = asDate(body.tanggal_masuk, { field: 'tanggal_masuk' }) || wibDateToday();
  const res = await db.exec(
    `INSERT INTO service_hp
       (pelanggan_id, nama_device, deskripsi_kerusakan, status, estimasi_biaya, teknisi_id, catatan, foto_masuk, tanggal_masuk)
     VALUES (?, ?, ?, 'masuk', ?, ?, ?, ?, ?)`,
    pelangganId, namaDevice, deskripsi,
    body.estimasi_biaya == null || body.estimasi_biaya === '' ? null : asInt(body.estimasi_biaya, { field: 'estimasi_biaya', min: 0 }),
    body.teknisi_id || null, body.catatan || null, body.foto_masuk || null, tanggalMasuk
  );
  await writeAudit(db, { userId: user.id, aksi: 'create', tabel: 'service_hp', recordId: res.lastRowId, dataAfter: { nama_device: namaDevice, pelanggan_id: pelangganId, tanggal_masuk: tanggalMasuk } });
  return { id: res.lastRowId, nama_device: namaDevice, status: 'masuk' };
}

export async function updateService(db, request, ctx, idStr) {
  const { user } = ctx.auth;
  const id = asInt(idStr, { required: true, field: 'id' });
  const body = await readBody(request);
  const old = await db.one('SELECT * FROM service_hp WHERE id = ? AND deleted_at IS NULL', id);
  if (!old) throw err(404, 'not_found', 'Service HP tidak ditemukan');

  const sets = [];
  const vals = [];
  if (body.status !== undefined) {
    if (!STATUS_SERVICE.includes(body.status)) throw err(400, 'invalid_value', 'status tidak valid');
    sets.push('status = ?'); vals.push(body.status);
    if (body.status === 'selesai' && !old.tanggal_selesai) { sets.push('tanggal_selesai = ?'); vals.push(nowIso()); }
    if (body.status === 'diambil' && !old.tanggal_diambil) { sets.push('tanggal_diambil = ?'); vals.push(nowIso()); }
  }
  if (body.biaya !== undefined) { sets.push('biaya = ?'); vals.push(body.biaya === '' || body.biaya == null ? null : asInt(body.biaya, { field: 'biaya', min: 0 })); }
  if (body.estimasi_biaya !== undefined) { sets.push('estimasi_biaya = ?'); vals.push(body.estimasi_biaya === '' || body.estimasi_biaya == null ? null : asInt(body.estimasi_biaya, { field: 'estimasi_biaya', min: 0 })); }
  if (body.teknisi_id !== undefined) { sets.push('teknisi_id = ?'); vals.push(body.teknisi_id || null); }
  if (body.catatan !== undefined) { sets.push('catatan = ?'); vals.push(body.catatan || null); }
  if (body.sudah_dihubungi !== undefined) { sets.push('sudah_dihubungi = ?'); vals.push(asBool(body.sudah_dihubungi)); }
  if (body.foto_masuk !== undefined) { sets.push('foto_masuk = ?'); vals.push(body.foto_masuk || null); }
  if (body.nama_device !== undefined) { sets.push('nama_device = ?'); vals.push(String(body.nama_device).trim()); }
  if (body.deskripsi_kerusakan !== undefined) { sets.push('deskripsi_kerusakan = ?'); vals.push(String(body.deskripsi_kerusakan).trim()); }
  if (!sets.length) throw err(400, 'no_changes', 'Tidak ada perubahan');
  vals.push(id);
  await db.exec(`UPDATE service_hp SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  const after = await db.one('SELECT * FROM service_hp WHERE id = ?', id);
  await writeAudit(db, { userId: user.id, aksi: 'update', tabel: 'service_hp', recordId: id, dataBefore: old, dataAfter: after });
  return { id, message: 'Service HP diperbarui', data: after };
}