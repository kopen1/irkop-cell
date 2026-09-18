import { nowIso } from '../lib/time.js';
import { writeAudit } from '../lib/audit.js';

export const HARI = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];

// Gaji karyawan per shift, ditentukan jam buka: buka < batas -> awal (shift
// panjang 13:00–21:00), buka >= batas -> akhir (shift 16:00–21:00).
export const GAJI_SHIFT = { batasJam: 16, awal: 60000, akhir: 45000 };
// Gaji owner: upah jaga toko (5 jam) + persentase laba service.
export const GAJI_OWNER = { jaga: 45000, servicePct: 50 };

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

export async function ensureGajiAutoInput(db, { user, tanggal, kasirSesiId, jamBuka }) {
  if (user.role !== 'karyawan') return null;

  // Prioritas: rate karyawan (jika diatur) -> jika tidak, gaji per shift dari
  // jam buka. Buka < batas = 60k (13:00), >= batas = 45k (16:00).
  let nominal = null;
  let sumberNominal = null;
  const rate = await getRateForUser(db, user.id, tanggal);
  if (rate && rate.nominal !== null && rate.nominal !== undefined) {
    nominal = rate.nominal;
    sumberNominal = 'rate';
  } else if (jamBuka !== null && jamBuka !== undefined) {
    nominal = Number(jamBuka) < GAJI_SHIFT.batasJam ? GAJI_SHIFT.awal : GAJI_SHIFT.akhir;
    sumberNominal = `shift_${jamBuka < GAJI_SHIFT.batasJam ? 'awal' : 'akhir'}`;
  }
  if (nominal === null) return null;

  const existing = await getGaji(db, user.id, tanggal);
  if (existing) return existing;

  const res = await db.exec(
    `INSERT OR IGNORE INTO gaji_harian (user_id, tanggal, nominal, sumber, catatan, created_at)
     VALUES (?, ?, ?, 'auto', ?, ?)`,
    user.id,
    tanggal,
    nominal,
    `[auto] ${sumberNominal}`,
    nowIso()
  );
  if (res.changes === 0) return getGaji(db, user.id, tanggal);

  const row = await getGaji(db, user.id, tanggal);
  await writeAudit(db, {
    userId: null,
    aksi: 'auto_input_gaji',
    tabel: 'gaji_harian',
    recordId: row.id,
    dataAfter: { user_id: user.id, tanggal, nominal, sumber: 'auto', kasir_sesi_id: kasirSesiId },
  });
  return row;
}

async function sumServiceLaba(db, tanggal) {
  const row = await db.one(
    `SELECT COALESCE(SUM((ti.harga_snapshot - COALESCE(ti.harga_modal_snapshot, 0)) * ti.qty), 0) AS laba
       FROM transaksi t
       JOIN transaksi_item ti ON ti.transaksi_id = t.id
      WHERE t.deleted_at IS NULL AND t.tanggal_transaksi = ? AND ti.service_hp_id IS NOT NULL`,
    tanggal
  );
  return Number(row ? row.laba : 0);
}

// Jam buka (WIB) satu tanggal, dari kasir_sesi.dibuka_at.
async function openingHour(db, tanggal) {
  const sesi = await db.one(
    'SELECT dibuka_at FROM kasir_sesi WHERE tanggal = ? ORDER BY id DESC LIMIT 1',
    tanggal
  );
  if (!sesi || !sesi.dibuka_at) return null;
  const d = new Date(sesi.dibuka_at);
  if (Number.isNaN(d.getTime())) return null;
  return (d.getUTCHours() + 7) % 24;
}

// Upah owner mengikuti jam buka (opsi 1): <batas = 60k, >=batas = 45k.
function ownerShiftRate(jamBuka) {
  if (jamBuka === null || jamBuka === undefined) return GAJI_OWNER.jaga;
  return Number(jamBuka) < GAJI_SHIFT.batasJam ? GAJI_SHIFT.awal : GAJI_SHIFT.akhir;
}

// Hitung gaji owner untuk satu tanggal: upah (ikut jam buka) + % laba service.
// Laba service dihitung dari TANGGAL TRANSAKSI service (saat selesai/dibayar).
export async function hitungGajiOwner(db, tanggal, jamBukaIn) {
  let jamBuka = jamBukaIn;
  if (jamBuka === null || jamBuka === undefined) jamBuka = await openingHour(db, tanggal);
  const upah = ownerShiftRate(jamBuka);
  const serviceLaba = await sumServiceLaba(db, tanggal);
  const serviceShare = Math.round((serviceLaba * GAJI_OWNER.servicePct) / 100);
  return {
    tanggal,
    jam_buka: jamBuka,
    upah,
    jaga: upah,
    service_laba: serviceLaba,
    service_pct: GAJI_OWNER.servicePct,
    service_share: serviceShare,
    total: upah + serviceShare,
  };
}

// Akru gaji owner otomatis (dipanggil saat Closing). Hanya menambah baris gaji
// (belum dibayar) — pembayaran dilakukan terpisah saat "Bayar Gaji".
export async function ensureOwnerGajiAutoInput(db, { tanggal, jamBuka, kasirSesiId }) {
  const owner = await db.one("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  if (!owner) return null;
  const hitung = await hitungGajiOwner(db, tanggal, jamBuka);
  if (hitung.total <= 0) return null;

  const res = await db.exec(
    `INSERT OR IGNORE INTO gaji_harian (user_id, tanggal, nominal, sumber, catatan, created_at)
     VALUES (?, ?, ?, 'auto', ?, ?)`,
    owner.id,
    tanggal,
    hitung.total,
    `[owner] upah ${hitung.upah} + ${hitung.service_pct}% service ${hitung.service_share}`,
    nowIso()
  );
  if (res.changes === 0) return getGaji(db, owner.id, tanggal);

  const row = await getGaji(db, owner.id, tanggal);
  await writeAudit(db, {
    userId: null,
    aksi: 'auto_input_gaji_owner',
    tabel: 'gaji_harian',
    recordId: row.id,
    dataAfter: { user_id: owner.id, tanggal, nominal: hitung.total, sumber: 'auto', kasir_sesi_id: kasirSesiId },
  });
  return row;
}