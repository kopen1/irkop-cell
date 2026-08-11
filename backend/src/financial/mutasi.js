import { err } from '../lib/errors.js';
import { getAccount } from './akun.js';

export const MUTASI_TIPE = ['transaksi', 'pengeluaran', 'kasbon_pelunasan', 'penyesuaian', 'reversal'];

async function findMutationByKey(db, mutationKey) {
  return db.one('SELECT * FROM mutasi_saldo WHERE mutation_key = ?', mutationKey);
}

export async function createMutation(db, {
  kasirSesiId,
  namaAkun,
  jumlah,
  sumberTipe,
  sumberId,
  mutationKey,
}) {
  if (!MUTASI_TIPE.includes(sumberTipe)) {
    throw err(500, 'invalid_mutation_type', `sumber_tipe '${sumberTipe}' tidak diketahui`);
  }
  if (!Number.isInteger(jumlah) || jumlah === 0) {
    throw err(500, 'invalid_mutation_amount', 'jumlah mutasi harus integer non-zero');
  }
  await getAccount(db, namaAkun);

  const existing = await findMutationByKey(db, mutationKey);
  if (existing) {
    return { id: existing.id, existing: true };
  }

  const res = await db.exec(
    `INSERT OR IGNORE INTO mutasi_saldo
       (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    kasirSesiId,
    namaAkun,
    jumlah,
    sumberTipe,
    sumberId,
    mutationKey,
    new Date().toISOString()
  );

  if (res.changes === 0) {
    const row = await findMutationByKey(db, mutationKey);
    return { id: row.id, existing: true };
  }

  return { id: res.lastRowId, existing: false };
}

export async function sumMutationBySession(db, kasirSesiId, namaAkun) {
  const row = await db.one(
    'SELECT COALESCE(SUM(jumlah), 0) AS total FROM mutasi_saldo WHERE kasir_sesi_id = ? AND nama_akun = ?',
    kasirSesiId,
    namaAkun
  );
  return row ? Number(row.total) : 0;
}

export async function sumMutationBySource(db, sumberTipe, sumberId) {
  const row = await db.one(
    'SELECT COALESCE(SUM(jumlah), 0) AS total FROM mutasi_saldo WHERE sumber_tipe = ? AND sumber_id = ?',
    sumberTipe,
    sumberId
  );
  return row ? Number(row.total) : 0;
}

export async function listMutationsBySession(db, kasirSesiId) {
  return db.many(
    'SELECT * FROM mutasi_saldo WHERE kasir_sesi_id = ? ORDER BY id',
    kasirSesiId
  );
}