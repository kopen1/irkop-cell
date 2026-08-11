import { nowIso } from '../lib/time.js';
import { writeAudit } from '../lib/audit.js';

export const HARI = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];

export function dayNameOf(date) {
  return HARI[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

export async function getRateForUser(db, userId, tanggal) {
  const rate = await db.one('SELECT * FROM karyawan_rate WHERE user_id = ?', userId);
  if (!rate) return null;
  if (rate.tipe === 'flat') {
    return { tipe: 'flat', nominal: rate.rate_flat };
  }
  const hari = dayNameOf(tanggal);
  const daily = await db.one(
    'SELECT rate FROM karyawan_rate_harian WHERE user_id = ? AND hari = ?',
    userId,
    hari
  );
  return { tipe: 'custom_harian', hari, nominal: daily ? daily.rate : null };
}

export async function getGaji(db, userId, tanggal) {
  return db.one('SELECT * FROM gaji_harian WHERE user_id = ? AND tanggal = ?', userId, tanggal);
}

export async function ensureGajiAutoInput(db, { user, tanggal, kasirSesiId }) {
  if (user.role !== 'karyawan') return null;
  const rate = await getRateForUser(db, user.id, tanggal);
  if (!rate || rate.nominal === null || rate.nominal === undefined) return null;

  const existing = await getGaji(db, user.id, tanggal);
  if (existing) return existing;

  const res = await db.exec(
    `INSERT OR IGNORE INTO gaji_harian (user_id, tanggal, nominal, sumber, created_at)
     VALUES (?, ?, ?, 'auto', ?)`,
    user.id,
    tanggal,
    rate.nominal,
    nowIso()
  );
  if (res.changes === 0) return getGaji(db, user.id, tanggal);

  const row = await getGaji(db, user.id, tanggal);
  await writeAudit(db, {
    userId: null,
    aksi: 'auto_input_gaji',
    tabel: 'gaji_harian',
    recordId: row.id,
    dataAfter: { user_id: user.id, tanggal, nominal: rate.nominal, sumber: 'auto', kasir_sesi_id: kasirSesiId },
  });
  return row;
}