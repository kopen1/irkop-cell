import { err } from '../lib/errors.js';
import { readBody, asInt, asDate, asEnum } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { nowIso, wibDateToday } from '../lib/time.js';
import { requireOpenSession } from '../financial/kasir.js';
import { getAccount } from '../financial/akun.js';

export async function listKasbon(db, request, ctx) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const where = ['1=1'];
  const bind = [];
  if (params.has('status')) { where.push('k.status = ?'); bind.push(params.get('status')); }
  if (params.has('pelanggan_id')) { where.push('k.pelanggan_id = ?'); bind.push(Number(params.get('pelanggan_id'))); }
  const rows = await db.many(
    `SELECT k.*, p.nama AS pelanggan_nama, t.kode_transaksi
       FROM kasbon k
       LEFT JOIN pelanggan p ON p.id = k.pelanggan_id
       LEFT JOIN transaksi t ON t.id = k.transaksi_id
      WHERE ${where.join(' AND ')} ORDER BY k.tanggal DESC, k.id DESC`,
    ...bind
  );
  return { items: rows.map((r) => ({ ...r, terbayar: Number(r.terbayar || 0), sisa: Number(r.nominal) - Number(r.terbayar || 0) })) };
}

export async function createKasbon(db, request, ctx) {
  const { user } = ctx.auth;
  const body = await readBody(request);
  const pelangganId = asInt(body.pelanggan_id, { required: true, field: 'pelanggan_id' });
  const nominal = asInt(body.nominal, { required: true, field: 'nominal', min: 1 });
  const tanggal = asDate(body.tanggal, { field: 'tanggal' }) || wibDateToday();
  const p = await db.one('SELECT id FROM pelanggan WHERE id = ?', pelangganId);
  if (!p) throw err(400, 'invalid_pelanggan', 'Pelanggan tidak ditemukan');
  const res = await db.exec(
    `INSERT INTO kasbon (pelanggan_id, transaksi_id, nominal, status, tanggal, jatuh_tempo, dicatat_oleh, catatan)
     VALUES (?, ?, ?, 'belum_lunas', ?, ?, ?, ?)`,
    pelangganId, body.transaksi_id || null, nominal, tanggal, body.jatuh_tempo || null, user.id, body.catatan || null
  );
  await writeAudit(db, { userId: user.id, aksi: 'create', tabel: 'kasbon', recordId: res.lastRowId, dataAfter: { pelanggan_id: pelangganId, nominal, tanggal } });
  return { id: res.lastRowId, nominal, terbayar: 0, sisa: nominal, status: 'belum_lunas', tanggal };
}

export async function updateKasbon(db, request, ctx, idStr) {
  const { user } = ctx.auth;
  const id = asInt(idStr, { required: true, field: 'id' });
  const body = await readBody(request);
  const old = await db.one('SELECT * FROM kasbon WHERE id = ?', id);
  if (!old) throw err(404, 'not_found', 'Kasbon tidak ditemukan');

  const sets = [];
  const vals = [];
  if (body.jatuh_tempo !== undefined) { sets.push('jatuh_tempo = ?'); vals.push(body.jatuh_tempo || null); }
  if (body.catatan !== undefined) { sets.push('catatan = ?'); vals.push(body.catatan || null); }

  if (body.status === 'lunas' && old.status !== 'lunas') {
    const sisa = Number(old.nominal) - Number(old.terbayar || 0);
    if (sisa <= 0) throw err(409, 'already_lunas', 'Kasbon sudah lunas; tidak ada sisa tagihan');
    const sesi = await requireOpenSession(db);
    const akun = body.akun ? (await getAccount(db, body.akun)).nama_akun : 'Tunai Laci';
    const key = `kasbon_pelunasan:${id}:${akun}`;
    await db.exec(
      `INSERT OR IGNORE INTO mutasi_saldo
         (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, created_at)
       VALUES (?, ?, ?, 'kasbon_pelunasan', ?, ?, ?)`,
      sesi.id, akun, sisa, id, key, nowIso()
    );
    sets.push("status = 'lunas'");
    sets.push('lunas_at = ?');
    vals.push(nowIso());
    sets.push('terbayar = ?');
    vals.push(Number(old.nominal));
  } else if (body.status === 'belum_lunas' && old.status === 'lunas') {
    throw err(409, 'lunas_immutable', 'Pelunasan kasbon tidak bisa dibatalkan; gunakan koreksi/reversal resmi');
  }

  if (!sets.length) throw err(400, 'no_changes', 'Tidak ada perubahan');
  vals.push(id);
  await db.exec(`UPDATE kasbon SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  await writeAudit(db, { userId: user.id, aksi: 'update', tabel: 'kasbon', recordId: id, dataBefore: old, dataAfter: body });
  const after = await db.one('SELECT * FROM kasbon WHERE id = ?', id);
  return { id, message: 'Kasbon diperbarui', terbayar: Number(after.terbayar || 0), sisa: Number(after.nominal) - Number(after.terbayar || 0), status: after.status };
}

// Pembayaran sebagian / pelunasan kasbon (item 10). Satu pembayaran =
// satu baris kasbon_pembayaran. status 'sebagian' diwakili
// status='belum_lunas' + terbayar>0 (tidak mengubah CHECK constraint).
export async function payKasbon(db, request, ctx, idStr) {
  const { user } = ctx.auth;
  const id = asInt(idStr, { required: true, field: 'id' });
  const body = await readBody(request);
  const old = await db.one('SELECT * FROM kasbon WHERE id = ?', id);
  if (!old) throw err(404, 'not_found', 'Kasbon tidak ditemukan');

  const nominal = asInt(body.nominal, { required: true, field: 'nominal', min: 1 });
  const sisa = Number(old.nominal) - Number(old.terbayar || 0);
  if (sisa <= 0) throw err(409, 'already_lunas', 'Kasbon sudah lunas; tidak ada sisa tagihan');
  if (nominal > sisa) throw err(400, 'overpayment', `Pembayaran melebihi sisa tagihan (${sisa})`);

  const metode = asEnum(body.metode, ['tunai', 'transfer', 'bon'], { defaultVal: 'tunai', field: 'metode' });
  const tanggal = asDate(body.tanggal, { field: 'tanggal' }) || wibDateToday();

  let akun = null;
  if (body.akun_id !== undefined && body.akun_id !== null && body.akun_id !== '') {
    akun = await getAccount(db, body.akun_id);
  }

  const res = await db.exec(
    `INSERT INTO kasbon_pembayaran (kasbon_id, nominal, metode, akun_id, dicatat_oleh, tanggal, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, nominal, metode, akun ? akun.nama_akun : null, user.id, tanggal, nowIso()
  );

  const terbayar = Number(old.terbayar || 0) + nominal;
  const lunas = terbayar >= Number(old.nominal);
  if (lunas) {
    await db.exec("UPDATE kasbon SET terbayar = ?, status = 'lunas', lunas_at = ? WHERE id = ?", terbayar, nowIso(), id);
  } else {
    await db.exec('UPDATE kasbon SET terbayar = ? WHERE id = ?', terbayar, id);
  }

  if (akun) {
    const sesi = await requireOpenSession(db);
    const key = `kasbon_pelunasan:${id}:${res.lastRowId}:${akun.nama_akun}`;
    await db.exec(
      `INSERT OR IGNORE INTO mutasi_saldo
         (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, created_at)
       VALUES (?, ?, ?, 'kasbon_pelunasan', ?, ?, ?)`,
      sesi.id, akun.nama_akun, nominal, res.lastRowId, key, nowIso()
    );
  }

  await writeAudit(db, {
    userId: user.id, aksi: 'create', tabel: 'kasbon_pembayaran', recordId: res.lastRowId,
    dataAfter: { kasbon_id: id, nominal, metode, akun_id: akun ? akun.nama_akun : null, tanggal },
  });

  return { id: res.lastRowId, kasbon_id: id, nominal, metode, terbayar, sisa: Number(old.nominal) - terbayar, status: lunas ? 'lunas' : 'belum_lunas', tanggal };
}