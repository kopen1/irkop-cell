import { nowIso } from '../lib/time.js';
import { writeAudit } from '../lib/audit.js';

export const HARI = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];

// Gaji karyawan per shift, ditentukan jam buka: buka < batas -> awal (shift
// panjang 13:00–21:00), buka >= batas -> akhir (shift 16:00–21:00).
export const GAJI_SHIFT = { batasJam: 16, awal: 60000, akhir: 45000 };
// Gaji owner: upah jaga toko per hari (tetap) + persentase laba service.
// Nilai(cls) diambil dari tabel settings / bagi_hasil_service supaya bisa
// diubah dari UI. Angka di bawah hanya fallback bila setting belum ada.
export const GAJI_OWNER = { jaga: 50000, servicePct: 50 };

// Upah owner dari settings (default GAJI_OWNER.jaga).
export async function getOwnerUpah(db) {
  const row = await db.one("SELECT value FROM settings WHERE key = 'owner_upah_harian'");
  const v = row ? Number(row.value) : NaN;
  return Number.isFinite(v) && v >= 0 ? Math.round(v) : GAJI_OWNER.jaga;
}

// Persentase bagi hasil service untuk satu orang (0 bila belum diatur).
export async function getPersenService(db, userId) {
  const row = await db.one('SELECT persen FROM bagi_hasil_service WHERE user_id = ?', userId);
  return row ? Math.max(0, Math.min(100, Number(row.persen) || 0)) : 0;
}

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

// Laba service satu tanggal. Kalau teknisiId diisi, hanya servis yang
// dikerjakan orang itu.
async function sumServiceLaba(db, tanggal, teknisiId = null) {
  const params = [tanggal];
  let filter = '';
  if (teknisiId != null) {
    filter = ' AND s.teknisi_id = ?';
    params.push(teknisiId);
  }
  const row = await db.one(
    `SELECT COALESCE(SUM((ti.harga_snapshot - COALESCE(ti.harga_modal_snapshot, 0)) * ti.qty), 0) AS laba
       FROM transaksi t
       JOIN transaksi_item ti ON ti.transaksi_id = t.id
       JOIN service_hp s ON s.id = ti.service_hp_id
      WHERE t.deleted_at IS NULL AND t.tanggal_transaksi = ? AND ti.service_hp_id IS NOT NULL${filter}`,
    ...params
  );
  return Number(row ? row.laba : 0);
}

// Semua servis pada satu tanggal, dikelompokkan per teknisi.
// Kunci 'null' = servis tanpa teknisi (tidak dibagi ke siapa pun).
export async function serviceLabaPerTeknisi(db, tanggal) {
  const rows = await db.many(
    `SELECT s.teknisi_id AS teknisi_id,
            COALESCE(SUM((ti.harga_snapshot - COALESCE(ti.harga_modal_snapshot, 0)) * ti.qty), 0) AS laba
       FROM transaksi t
       JOIN transaksi_item ti ON ti.transaksi_id = t.id
       JOIN service_hp s ON s.id = ti.service_hp_id
      WHERE t.deleted_at IS NULL AND t.tanggal_transaksi = ? AND ti.service_hp_id IS NOT NULL
      GROUP BY s.teknisi_id`,
    tanggal
  );
  const map = new Map();
  for (const r of rows) map.set(r.teknisi_id ?? 'null', Number(r.laba));
  return map;
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

// Upah owner: nominal tetap (GAJI_OWNER.jaga), tidak ikut shift.
// Shift 60k/45k hanya untuk karyawan (GAJI_SHIFT).
function ownerShiftRate() {
  return GAJI_OWNER.jaga;
}

// Hitung gaji owner untuk satu tanggal: upah jaga per hari (tetap) + % laba service.
// Laba service dihitung dari TANGGAL TRANSAKSI service (saat selesai/dibayar).
// Upah harian: admin memakai settings global; karyawan memakai rate-nya.
export async function getUpahUntukUser(db, userId) {
  const u = await db.one("SELECT id, role FROM users WHERE id = ?", userId);
  if (!u) return 0;
  if (u.role === 'admin') return getOwnerUpah(db);
  const rate = await getRateForUser(db, userId, new Date().toISOString().slice(0, 10));
  return rate && rate.nominal != null ? Number(rate.nominal) : 0;
}

// Semua admin. Gaji owner TIDAM dikunci ke satu akun: setiap admin yang punya
// porsi di bagi_hasil_service mendapat akrunya masing-masing.
export async function daftarOwner(db) {
  return db.many("SELECT id, nama, role FROM users WHERE role = 'admin' AND aktif = 1 ORDER BY nama");
}

export async function hitungGajiOwner(db, tanggal, jamBukaIn, ownerIdIn = null) {
  let jamBuka = jamBukaIn;
  if (jamBuka === null || jamBuka === undefined) jamBuka = await openingHour(db, tanggal);
  // Tanpa ownerId: jumlahkan semua admin (global), bukan hanya admin pertama.
  if (ownerIdIn == null) {
    const semua = await daftarOwner(db);
    let totalGaji = 0;
    const rincian = [];
    for (const o of semua) {
      const satu = await hitungGajiOwner(db, tanggal, jamBuka, o.id);
      if (satu.total > 0) rincian.push(satu);
      totalGaji += satu.total;
    }
    return {
      tanggal, jam_buka: jamBuka, total: totalGaji, owners: rincian,
      upah: rincian.length ? rincian[0].upah : await getOwnerUpah(db),
      semua_admin: semua.map((o) => ({ id: o.id, nama: o.nama })),
    };
  }
  const ownerId = Number(ownerIdIn);
  const info = await db.one('SELECT id, nama, role FROM users WHERE id = ?', ownerId);
  const upah = await getUpahUntukUser(db, ownerId);
  // Pakai persen dari DB; belum ada baris -> fallback ke bawaan.
  let persen = await getPersenService(db, ownerId);
  if (!persen) persen = GAJI_OWNER.servicePct;
  const serviceLaba = await sumServiceLaba(db, tanggal, ownerId);
  const serviceShare = Math.round((serviceLaba * persen) / 100);
  return {
    tanggal,
    user_id: ownerId,
    nama: info ? info.nama : null,
    role: info ? info.role : null,
    jam_buka: jamBuka,
    upah,
    jaga: upah,
    service_laba: serviceLaba,
    service_pct: persen,
    service_share: serviceShare,
    total: upah + serviceShare,
  };
}

// Ringkasan bagi hasil service semua orang pada satu tanggal.
export async function hitungBagiHasilService(db, tanggal) {
  const map = await serviceLabaPerTeknisi(db, tanggal);
  const rows = await db.many(
    `SELECT b.user_id, u.nama, u.role, b.persen
       FROM bagi_hasil_service b JOIN users u ON u.id = b.user_id
      ORDER BY u.nama`
  );
  const items = [];
  let totalLaba = 0, totalShare = 0;
  for (const r of rows) {
    const laba = map.get(r.user_id) ?? 0;
    const share = Math.round((laba * Math.max(0, Math.min(100, Number(r.persen) || 0))) / 100);
    totalLaba += laba;
    totalShare += share;
    items.push({ user_id: r.user_id, nama: r.nama, role: r.role, persen: Number(r.persen) || 0, service_laba: laba, share });
  }
  // Servis tanpa teknisi tetap bagian toko, tapi tetap dilaporkan.
  const tanpaTeknisi = map.get('null') ?? 0;
  totalLaba += tanpaTeknisi;
  return { tanggal, items, total_service_laba: totalLaba, total_share: totalShare, sisa_toko: totalLaba - totalShare, service_tanpa_teknisi: tanpaTeknisi };
}

// Akru gaji owner otomatis (dipanggil saat Closing). Hanya menambah baris gaji
// (belum dibayar) — pembayaran dilakukan terpisah saat "Bayar Gaji".
export async function ensureOwnerGajiAutoInput(db, { tanggal, jamBuka, kasirSesiId }) {
  // Setiap admin (owner) dihitung terpisah — tidak dikunci ke satu akun.
  const owners = await daftarOwner(db);
  if (!owners.length) return null;
  const dibuat = [];
  for (const owner of owners) {
    const hitung = await hitungGajiOwner(db, tanggal, jamBuka, owner.id);
    if (hitung.total <= 0) continue;
    const res = await db.exec(
      `INSERT OR IGNORE INTO gaji_harian (user_id, tanggal, nominal, sumber, catatan, created_at)
       VALUES (?, ?, ?, 'auto', ?, ?)`,
      owner.id,
      tanggal,
      hitung.total,
      `[owner] upah ${hitung.upah} + ${hitung.service_pct}% service ${hitung.service_share}`,
      nowIso()
    );
    if (res.changes === 0) continue;
    const row = await getGaji(db, owner.id, tanggal);
    dibuat.push(row);
    await writeAudit(db, {
      userId: null,
      aksi: 'auto_input_gaji_owner',
      tabel: 'gaji_harian',
      recordId: row.id,
      dataAfter: { user_id: owner.id, tanggal, nominal: hitung.total, sumber: 'auto', kasir_sesi_id: kasirSesiId },
    });
  }
  return dibuat;
}