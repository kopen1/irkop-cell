import { err } from '../lib/errors.js';

// Akun ledger bawaan (bukan akun uang) — tidak ditampilkan di Master Akun
// dan tidak perlu ada di tabel akun_master. Mutasi tetap dicatat berdasarkan
// nama_akun (tanpa FK), jadi transaksi/laporan tetap berjalan.
export const LEDGER_AKUN = ['Saldo Akun', 'Total Saldo', 'Laba'];
export const isLedgerAkun = (namaAkun) => LEDGER_AKUN.includes(String(namaAkun || '').trim());

const NOT_LEDGER = `nama_akun NOT IN (${LEDGER_AKUN.map(() => '?').join(',')})`;

export async function listActiveAccounts(db) {
  return db.many(
    `SELECT id, nama_akun, tipe, aktif FROM akun_master WHERE aktif = 1 AND ${NOT_LEDGER} ORDER BY id`,
    ...LEDGER_AKUN
  );
}

export async function listAllAccounts(db) {
  return db.many(
    `SELECT id, nama_akun, tipe, aktif FROM akun_master WHERE ${NOT_LEDGER} ORDER BY aktif DESC, id`,
    ...LEDGER_AKUN
  );
}

export async function getAccount(db, namaAkun) {
  if (!namaAkun) throw err(400, 'missing_account', 'nama_akun wajib diisi');
  if (isLedgerAkun(namaAkun)) {
    return { nama_akun: String(namaAkun).trim(), tipe: 'lainnya', aktif: 1 };
  }
  const acc = await db.one('SELECT * FROM akun_master WHERE lower(nama_akun) = lower(?)', namaAkun);
  if (!acc) throw err(400, 'invalid_account', `Akun '${namaAkun}' tidak ditemukan`);
  if (acc.aktif !== 1) throw err(400, 'inactive_account', `Akun '${namaAkun}' tidak aktif`);
  return acc;
}
