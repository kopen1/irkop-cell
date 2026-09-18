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
  // total_belanja/frekuensi dihitung langsung dari transaksi (bukan kolom
  // denormalized yang bisa basi) agar transaksi baru pasti terhitung.
  const rows = await db.many(
    `SELECT p.id, p.nama, p.telepon, p.created_at,
            (SELECT COUNT(*) FROM pelanggan_alias a WHERE a.pelanggan_id = p.id) AS alias_count,
            (SELECT GROUP_CONCAT(CONCAT(a.nilai, ':', a.tipe), ',') FROM pelanggan_alias a WHERE a.pelanggan_id = p.id) AS alias,
            (SELECT COALESCE(SUM(t.total), 0) FROM transaksi t WHERE t.pelanggan_id = p.id AND t.deleted_at IS NULL) AS total_belanja,
            (SELECT COUNT(*) FROM transaksi t WHERE t.pelanggan_id = p.id AND t.deleted_at IS NULL) AS frekuensi_transaksi,
            (SELECT COUNT(*) FROM transaksi t WHERE t.pelanggan_id = p.id AND t.deleted_at IS NULL) AS jumlah_transaksi
       FROM pelanggan p WHERE ${where.join(' AND ')} ORDER BY total_belanja DESC`,
    ...bind
  );
  return { items: rows };
}

export async function getPelanggan(db, request, ctx, idStr) {
  const p = await db.one('SELECT * FROM pelanggan WHERE id = ? AND merged_into_id IS NULL', idStr);
  if (!p) throw err(404, 'not_found', 'Pelanggan tidak ditemukan');
  const alias = await db.many('SELECT * FROM pelanggan_alias WHERE pelanggan_id = ?', p.id);
  const transaksi = await db.many(
    'SELECT id, kode_transaksi, tanggal_transaksi, total, metode_bayar, created_at FROM transaksi WHERE pelanggan_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50',
    p.id
  );
  const kasbon = await db.many('SELECT * FROM kasbon WHERE pelanggan_id = ? ORDER BY id DESC', p.id);
  const stats = await db.one(
    `SELECT COALESCE(SUM(total), 0) AS total_belanja, COUNT(*) AS frekuensi_transaksi
       FROM transaksi WHERE pelanggan_id = ? AND deleted_at IS NULL`,
    p.id
  );
  return {
    ...p,
    total_belanja: Number(stats?.total_belanja || 0),
    frekuensi_transaksi: Number(stats?.frekuensi_transaksi || 0),
    alias_count: alias.length,
    alias,
    riwayat_transaksi: transaksi,
    kasbon,
  };
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

  const now = nowIso();

  // Kumpulkan alias yang harus ikut pindah ke pelanggan tujuan: nama sumber,
  // nomor telepon sumber, dan semua alias (no_hp/no_rekening/nama) yang sudah
  // tercatat. Hindari duplikat dengan alias yang sudah ada di tujuan.
  const existing = await db.many('SELECT tipe, nilai FROM pelanggan_alias WHERE pelanggan_id = ?', idUtama);
  const seen = new Set(existing.map((a) => `${a.tipe}:${a.nilai}`));
  if (utama.telepon) seen.add(`no_hp:${utama.telepon}`);
  const toAdd = [];
  const pushAlias = (tipe, nilai, sumber = 'manual') => {
    const v = String(nilai || '').trim();
    if (!v) return;
    const key = `${tipe}:${v}`;
    if (seen.has(key)) return;
    seen.add(key);
    toAdd.push({ tipe, nilai: v, sumber });
  };
  // Nama & nomor sumber digabung dalam SATU alias agar tampil satu baris.
  const telSumber = String(gabung.telepon || '').trim();
  pushAlias('nama', telSumber ? `${gabung.nama} — ${telSumber}` : gabung.nama);
  const gabungAliases = await db.many('SELECT tipe, nilai, sumber FROM pelanggan_alias WHERE pelanggan_id = ?', idGabung);
  for (const a of gabungAliases) {
    if (a.tipe === 'nama') continue; // nama sudah digabung di atas
    if (telSumber && a.nilai === telSumber) continue; // nomor sudah ikut di baris nama
    pushAlias(a.tipe, a.nilai, a.sumber);
  }

  const stmts = [
    db.raw.prepare('UPDATE pelanggan SET merged_into_id = ? WHERE id = ?').bind(idUtama, idGabung),
    db.raw.prepare(
      'UPDATE pelanggan SET total_belanja = total_belanja + ?, frekuensi_transaksi = frekuensi_transaksi + ?, updated_at = ? WHERE id = ?'
    ).bind(gabung.total_belanja, gabung.frekuensi_transaksi, now, idUtama),
    ...toAdd.map((a) =>
      db.raw.prepare(
        `INSERT INTO pelanggan_alias (pelanggan_id, tipe, nilai, sumber, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(idUtama, a.tipe, a.nilai, a.sumber, now)
    ),
    // Alias sumber dihapus setelah dipindah agar tidak ada data yatim.
    db.raw.prepare('DELETE FROM pelanggan_alias WHERE pelanggan_id = ?').bind(idGabung),
  ];
  await db.batch(stmts);
  await writeAudit(db, { userId: user.id, aksi: 'merge', tabel: 'pelanggan', recordId: idUtama, dataAfter: { id_utama: idUtama, id_gabung: idGabung, alias_dipindah: toAdd } });
  return { id_utama: idUtama, id_gabung: idGabung, alias_dipindah: toAdd.length, message: 'Pelanggan digabungkan' };
}

const TIPE_ALIAS = ['nama', 'no_rekening', 'no_hp'];

// POST /api/pelanggan/:id/alias  { tipe, nilai }
export async function addPelangganAlias(db, request, ctx, idStr) {
  const { user } = ctx.auth;
  const p = await db.one('SELECT id FROM pelanggan WHERE id = ? AND merged_into_id IS NULL', idStr);
  if (!p) throw err(404, 'not_found', 'Pelanggan tidak ditemukan');
  const body = await readBody(request);
  const nilai = String(body.nilai || '').trim();
  const tipe = body.tipe || 'nama';
  if (!nilai) throw err(400, 'missing_field', 'nilai alias wajib diisi');
  if (!TIPE_ALIAS.includes(tipe)) throw err(400, 'invalid_value', 'tipe alias harus nama, no_rekening, atau no_hp');
  const dup = await db.one('SELECT id FROM pelanggan_alias WHERE pelanggan_id = ? AND tipe = ? AND nilai = ?', p.id, tipe, nilai);
  if (dup) throw err(409, 'duplicate_alias', 'Alias sudah ada');
  const res = await db.exec(
    'INSERT INTO pelanggan_alias (pelanggan_id, tipe, nilai, sumber, created_at) VALUES (?, ?, ?, ?, ?)',
    p.id, tipe, nilai, 'manual', nowIso()
  );
  await writeAudit(db, { userId: user.id, aksi: 'create', tabel: 'pelanggan_alias', recordId: res.lastRowId, dataAfter: { pelanggan_id: p.id, tipe, nilai } });
  return { id: res.lastRowId, pelanggan_id: p.id, tipe, nilai, sumber: 'manual' };
}

// PUT /api/pelanggan/alias/:id  { tipe?, nilai? }
export async function updatePelangganAlias(db, request, ctx, idStr) {
  const { user } = ctx.auth;
  const old = await db.one('SELECT * FROM pelanggan_alias WHERE id = ?', idStr);
  if (!old) throw err(404, 'not_found', 'Alias tidak ditemukan');
  const body = await readBody(request);
  const tipe = body.tipe != null ? String(body.tipe) : old.tipe;
  const nilai = body.nilai != null ? String(body.nilai).trim() : old.nilai;
  if (!nilai) throw err(400, 'missing_field', 'nilai alias wajib diisi');
  if (!TIPE_ALIAS.includes(tipe)) throw err(400, 'invalid_value', 'tipe alias harus nama, no_rekening, atau no_hp');
  await db.exec(
    'UPDATE pelanggan_alias SET tipe = ?, nilai = ? WHERE id = ?',
    tipe, nilai, old.id
  );
  await writeAudit(db, { userId: user.id, aksi: 'update', tabel: 'pelanggan_alias', recordId: old.id, dataBefore: old, dataAfter: { tipe, nilai } });
  return { id: old.id, pelanggan_id: old.pelanggan_id, tipe, nilai, sumber: old.sumber };
}

// DELETE /api/pelanggan/alias/:id
export async function deletePelangganAlias(db, request, ctx, idStr) {
  const { user } = ctx.auth;
  const old = await db.one('SELECT * FROM pelanggan_alias WHERE id = ?', idStr);
  if (!old) throw err(404, 'not_found', 'Alias tidak ditemukan');
  await db.exec('DELETE FROM pelanggan_alias WHERE id = ?', old.id);
  await writeAudit(db, { userId: user.id, aksi: 'delete', tabel: 'pelanggan_alias', recordId: old.id, dataBefore: old });
  return { deleted: true, id: old.id };
}