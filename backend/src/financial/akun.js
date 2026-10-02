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

// Saldo sistem sebuah akun pada satu sesi = opening sesi itu + seluruh mutasi
// di sesi tersebut. Sama persis dengan cara sessionStatus() menghitung
// saldo_sistem, jadi angka di form dan angka di backend selalu cocok.
export async function saldoSistemSesi(db, sesiId, namaAkun) {
  const row = await db.one(
    `SELECT COALESCE((SELECT saldo_sistem FROM kasir_saldo
                       WHERE kasir_sesi_id = ? AND nama_akun = ? AND tipe = 'opening'), 0)
          + COALESCE((SELECT SUM(jumlah) FROM mutasi_saldo
                       WHERE kasir_sesi_id = ? AND nama_akun = ?), 0) AS saldo`,
    sesiId, namaAkun, sesiId, namaAkun
  );
  return Number(row?.saldo || 0);
}

// Penjaga saldo: tolak operasi yang menyebabkan saldo akun minus.
export async function ensureSaldoCukup({ db, sesiId, akun, nominal, alasan }) {
  const saldo = await saldoSistemSesi(db, sesiId, akun);
  if (nominal > saldo) {
    throw err(
      400,
      'insufficient_balance',
      `Saldo ${akun} tidak cukup untuk ${alasan}: tersedia ${formatRupiah(saldo)}, dibutuhkan ${formatRupiah(nominal)}`
    );
  }
  return saldo;
}

// -Rp1.234.567 — format manual, tidak bergantung pada locale worker.
// Tanda minus WAJIB ikut: kalau saldo akun minus, user harus lihat minusnya
// supaya tidak mengira saldo itu positif.
export function formatRupiah(n) {
  const v = Math.trunc(Number(n) || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return v < 0 ? `-Rp${s}` : `Rp${s}`;
}
