import { err } from '../lib/errors.js';

export async function listActiveAccounts(db) {
  return db.many('SELECT id, nama_akun, tipe, aktif FROM akun_master WHERE aktif = 1 ORDER BY id');
}

export async function getAccount(db, namaAkun) {
  if (!namaAkun) throw err(400, 'missing_account', 'nama_akun wajib diisi');
  const acc = await db.one('SELECT * FROM akun_master WHERE nama_akun = ?', namaAkun);
  if (!acc) throw err(400, 'invalid_account', `Akun '${namaAkun}' tidak ditemukan`);
  if (acc.aktif !== 1) throw err(400, 'inactive_account', `Akun '${namaAkun}' tidak aktif`);
  return acc;
}