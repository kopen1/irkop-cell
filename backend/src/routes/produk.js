import { err } from '../lib/errors.js';
import { readBody, asInt, asString, asBool } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { nowIso } from '../lib/time.js';

function cleanName(v) {
  return String(v || '').trim().replace(/\s+/g, ' ');
}

export async function listKategori(db, request, ctx) {
  const url = new URL(request.url);
  const includeDeleted = url.searchParams.get('include_deleted') === 'true';
  const rows = await db.many(
    `SELECT * FROM kategori_produk ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY id`
  );
  return { items: rows };
}

export async function createKategori(db, request, ctx) {
  const { user } = ctx.auth;
  const body = await readBody(request);
  const nama = cleanName(body.nama);
  if (!nama) throw err(400, 'missing_field', 'nama kategori wajib diisi');
  const lacakStok = asBool(body.lacak_stok, { defaultVal: true });
  const dup = await db.one('SELECT id FROM kategori_produk WHERE nama = ?', nama);
  if (dup) throw err(409, 'duplicate_kategori', 'Nama kategori sudah ada');
  const res = await db.exec(
    'INSERT INTO kategori_produk (nama, lacak_stok, created_at) VALUES (?, ?, ?)',
    nama, lacakStok, nowIso()
  );
  await writeAudit(db, { userId: user.id, aksi: 'create', tabel: 'kategori_produk', recordId: res.lastRowId, dataAfter: { nama, lacak_stok: lacakStok } });
  return { id: res.lastRowId, nama, lacak_stok: lacakStok };
}

export async function updateKategori(db, request, ctx, idStr) {
  const { user } = ctx.auth;
  const id = asInt(idStr, { required: true, field: 'id' });
  const body = await readBody(request);
  const old = await db.one('SELECT * FROM kategori_produk WHERE id = ?', id);
  if (!old) throw err(404, 'not_found', 'Kategori tidak ditemukan');
  const nama = body.nama !== undefined ? cleanName(body.nama) : null;
  if (nama !== null) {
    if (!nama) throw err(400, 'missing_field', 'nama kategori wajib diisi');
    const dup = await db.one('SELECT id FROM kategori_produk WHERE nama = ? AND id != ?', nama, id);
    if (dup) throw err(409, 'duplicate_kategori', 'Nama kategori sudah ada');
  }
  const lacakStok = body.lacak_stok !== undefined ? asBool(body.lacak_stok) : null;
  const sets = [];
  const vals = [];
  if (nama !== null) { sets.push('nama = ?'); vals.push(nama); }
  if (lacakStok !== null) { sets.push('lacak_stok = ?'); vals.push(lacakStok); }
  if (!sets.length) throw err(400, 'no_changes', 'Tidak ada perubahan');
  sets.push('updated_at = ?'); vals.push(nowIso());
  vals.push(id);
  await db.exec(`UPDATE kategori_produk SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  await writeAudit(db, { userId: user.id, aksi: 'update', tabel: 'kategori_produk', recordId: id, dataBefore: { nama: old.nama, lacak_stok: old.lacak_stok }, dataAfter: body });
  return { id, message: 'Kategori diperbarui' };
}

export async function deleteKategori(db, request, ctx, idStr) {
  const { user } = ctx.auth;
  const id = asInt(idStr, { required: true, field: 'id' });
  const old = await db.one('SELECT * FROM kategori_produk WHERE id = ? AND deleted_at IS NULL', id);
  if (!old) throw err(404, 'not_found', 'Kategori tidak ditemukan');
  const used = await db.one('SELECT COUNT(*) AS n FROM produk WHERE kategori_id = ? AND deleted_at IS NULL', id);
  if (used.n > 0) throw err(409, 'kategori_in_use', 'Kategori masih dipakai produk, tidak bisa dihapus');
  await db.exec('UPDATE kategori_produk SET deleted_at = ? WHERE id = ?', nowIso(), id);
  await writeAudit(db, { userId: user.id, aksi: 'soft_delete', tabel: 'kategori_produk', recordId: id, dataBefore: { nama: old.nama } });
  return { id, status: 'soft_deleted' };
}

export async function listProduk(db, request, ctx) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const where = ['p.deleted_at IS NULL'];
  const bind = [];
  const q = params.get('q');
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    where.push('(p.kode LIKE ? OR p.nama LIKE ?)');
    bind.push(like, like);
  }
  if (params.has('kategori_id')) { where.push('p.kategori_id = ?'); bind.push(Number(params.get('kategori_id'))); }
  const rows = await db.many(
    `SELECT p.*, k.nama AS kategori_nama, k.lacak_stok AS kategori_lacak_stok
       FROM produk p LEFT JOIN kategori_produk k ON k.id = p.kategori_id
      WHERE ${where.join(' AND ')} ORDER BY p.nama`,
    ...bind
  );
  return { items: rows };
}

export async function createProduk(db, request, ctx) {
  const { user } = ctx.auth;
  const body = await readBody(request);
  const kode = cleanName(body.kode);
  const nama = cleanName(body.nama);
  if (!kode) throw err(400, 'missing_field', 'kode produk wajib diisi');
  if (!nama) throw err(400, 'missing_field', 'nama produk wajib diisi');
  const harga = asInt(body.harga, { required: true, field: 'harga', min: 0 });
  const hargaModal = body.harga_modal === undefined || body.harga_modal === null || body.harga_modal === ''
    ? null
    : asInt(body.harga_modal, { field: 'harga_modal', min: 0 });
  const kategoriId = body.kategori_id == null ? null : asInt(body.kategori_id, { field: 'kategori_id' });

  let lacakStok = 1;
  if (kategoriId != null) {
    const k = await db.one('SELECT * FROM kategori_produk WHERE id = ? AND deleted_at IS NULL', kategoriId);
    if (!k) throw err(400, 'invalid_kategori', 'Kategori tidak ditemukan');
    lacakStok = k.lacak_stok;
  }

  const dup = await db.one('SELECT id FROM produk WHERE kode = ?', kode);
  if (dup) throw err(409, 'duplicate_kode', 'Kode produk sudah ada');

  const stok = lacakStok ? asInt(body.stok, { field: 'stok', min: 0, defaultVal: 0 }) || 0 : 0;
  const stokMinimum = lacakStok ? asInt(body.stok_minimum, { field: 'stok_minimum', min: 0, defaultVal: 0 }) || 0 : 0;

  const res = await db.exec(
    `INSERT INTO produk (kode, nama, kategori_id, harga, harga_modal, stok, stok_minimum, satuan, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    kode, nama, kategoriId, harga, hargaModal, stok, stokMinimum, body.satuan ? String(body.satuan) : 'pcs', nowIso()
  );
  await writeAudit(db, { userId: user.id, aksi: 'create', tabel: 'produk', recordId: res.lastRowId, dataAfter: { kode, nama, harga, harga_modal: hargaModal, kategori_id: kategoriId, stok } });
  return { id: res.lastRowId, kode, nama, harga, harga_modal: hargaModal, kategori_id: kategoriId, stok, stok_minimum: stokMinimum };
}

export async function updateProduk(db, request, ctx, idStr) {
  const { user } = ctx.auth;
  const id = asInt(idStr, { required: true, field: 'id' });
  const body = await readBody(request);
  const old = await db.one('SELECT * FROM produk WHERE id = ? AND deleted_at IS NULL', id);
  if (!old) throw err(404, 'not_found', 'Produk tidak ditemukan');

  const sets = [];
  const vals = [];
  if (body.kode !== undefined) { const kode = cleanName(body.kode); if (!kode) throw err(400, 'missing_field', 'kode wajib diisi'); const dup = await db.one('SELECT id FROM produk WHERE kode = ? AND id != ?', kode, id); if (dup) throw err(409, 'duplicate_kode', 'Kode produk sudah ada'); sets.push('kode = ?'); vals.push(kode); }
  if (body.nama !== undefined) { const nama = cleanName(body.nama); if (!nama) throw err(400, 'missing_field', 'nama wajib diisi'); sets.push('nama = ?'); vals.push(nama); }
  if (body.harga !== undefined) { sets.push('harga = ?'); vals.push(asInt(body.harga, { field: 'harga', min: 0 })); }
  if (body.harga_modal !== undefined) { sets.push('harga_modal = ?'); vals.push(body.harga_modal === null || body.harga_modal === '' ? null : asInt(body.harga_modal, { field: 'harga_modal', min: 0 })); }
  if (body.kategori_id !== undefined) { const kid = body.kategori_id == null ? null : asInt(body.kategori_id, { field: 'kategori_id' }); sets.push('kategori_id = ?'); vals.push(kid); }
  if (body.stok !== undefined) { sets.push('stok = ?'); vals.push(asInt(body.stok, { field: 'stok', min: 0 })); }
  if (body.stok_minimum !== undefined) { sets.push('stok_minimum = ?'); vals.push(asInt(body.stok_minimum, { field: 'stok_minimum', min: 0 })); }
  if (body.satuan !== undefined) { sets.push('satuan = ?'); vals.push(String(body.satuan).trim() || 'pcs'); }
  if (!sets.length) throw err(400, 'no_changes', 'Tidak ada perubahan');
  sets.push('updated_at = ?'); vals.push(nowIso());
  vals.push(id);
  await db.exec(`UPDATE produk SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  const after = await db.one('SELECT * FROM produk WHERE id = ?', id);
  await writeAudit(db, { userId: user.id, aksi: 'update', tabel: 'produk', recordId: id, dataBefore: old, dataAfter: after });
  return { id, message: 'Produk diperbarui', data: after };
}

export async function deleteProduk(db, request, ctx, idStr) {
  const { user } = ctx.auth;
  const id = asInt(idStr, { required: true, field: 'id' });
  const old = await db.one('SELECT * FROM produk WHERE id = ? AND deleted_at IS NULL', id);
  if (!old) throw err(404, 'not_found', 'Produk tidak ditemukan');
  await db.exec('UPDATE produk SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
  await writeAudit(db, { userId: user.id, aksi: 'soft_delete', tabel: 'produk', recordId: id, dataBefore: { kode: old.kode, nama: old.nama } });
  return { id, status: 'soft_deleted' };
}