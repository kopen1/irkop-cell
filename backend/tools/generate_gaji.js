// Akru gaji owner untuk periode yang sudah diimpor.
// Gaji owner = upah 50.000 + 50% laba service per tanggal (sudah otomatis
// di kode Closing, tapi sesi impor dibuat langsung 'tutup' jadi tidak pernah jalan).
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from '../src/lib/password.js';

const DB = new URL('../.dev-data/irkop.db', import.meta.url).pathname;
const db = new DatabaseSync(DB);
const GAJI_OWNER = { jaga: 50000, servicePct: 50 };
const GAJI_SHIFT = { batasJam: 16, awal: 60000, akhir: 45000 };
const NAMA_KARYAWAN = process.env.NAMA_KARYAWAN || 'Karyawan 1';
const USERNAME_KARYAWAN = process.env.USERNAME_KARYAWAN || 'kry1';
const PASSWORD_KARYAWAN = process.env.PASSWORD_KARYAWAN || 'kry11234';
const f = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const owner = db.prepare("SELECT id, nama FROM users WHERE role='admin' ORDER BY id LIMIT 1").get();
if (!owner) { console.error('tidak ada user admin'); process.exit(1); }

const sesi = db.prepare("SELECT id, tanggal FROM kasir_sesi WHERE status='tutup' ORDER BY tanggal").all();
const insGaji = db.prepare(
  `INSERT INTO gaji_harian (user_id, tanggal, nominal, sumber, catatan, created_at, updated_at)
   VALUES (?, ?, ?, 'auto', ?, ?, ?)
   ON CONFLICT(user_id, tanggal) DO UPDATE SET
     nominal = excluded.nominal, sumber = 'auto', catatan = excluded.catatan, updated_at = excluded.updated_at`
);
const now = new Date().toISOString();
let dibuat = 0, total = 0;
for (const s of sesi) {
  const row = db.prepare(
    `SELECT COALESCE(SUM((ti.harga_snapshot - COALESCE(ti.harga_modal_snapshot,0)) * ti.qty), 0) AS laba
       FROM transaksi t JOIN transaksi_item ti ON ti.transaksi_id = t.id
      WHERE t.deleted_at IS NULL AND t.tanggal_transaksi = ? AND ti.service_hp_id IS NOT NULL`
  ).get(s.tanggal);
  const labaService = Number(row.laba);
  const share = Math.round((labaService * GAJI_OWNER.servicePct) / 100);
  const nominal = GAJI_OWNER.jaga + share;
  insGaji.run(owner.id, s.tanggal, nominal,
    `[owner] upah ${GAJI_OWNER.jaga} + ${GAJI_OWNER.servicePct}% service ${share}`, now, now);
  dibuat += 1;
  total += nominal;
}
console.log(`gaji owner dibuat: ${dibuat} hari (${owner.nama})`);
console.log(`total upah owner : Rp ${f(total)}`);

// --- Karyawan: pakai shift default aplikasi (belum ada ratecustom) ---
let kar = db.prepare("SELECT id FROM users WHERE role='karyawan' ORDER BY id LIMIT 1").get();
if (!kar) {
  const now2 = new Date().toISOString();
  const hash = await hashPassword(PASSWORD_KARYAWAN);
  kar = db.prepare(
    `INSERT INTO users (nama, username, password_hash, role, aktif, created_at) VALUES (?, ?, ?, 'karyawan', 1, ?)`
  ).run(NAMA_KARYAWAN, USERNAME_KARYAWAN, hash, now2);
  kar = { id: Number(kar.lastInsertRowid) };
  db.prepare('INSERT OR IGNORE INTO user_permissions (user_id, halaman, created_at) VALUES (?, ?, ?)')
    .run(kar.id, 'kasir', now2);
  console.log(`\nkaryawan dibuat: "${NAMA_KARYAWAN}" (username ${USERNAME_KARYAWAN}, id ${kar.id})`);
} else {
  kar = { id: kar.id };
  console.log(`\nkaryawan: pakai user yang ada (id ${kar.id})`);
}

const insKar = db.prepare(
  `INSERT INTO gaji_harian (user_id, tanggal, nominal, sumber, catatan, created_at, updated_at)
   VALUES (?, ?, ?, 'auto', ?, ?, ?)
   ON CONFLICT(user_id, tanggal) DO UPDATE SET
     nominal = excluded.nominal, sumber = 'auto', catatan = excluded.catatan, updated_at = excluded.updated_at`
);
let hariK = 0, totalK = 0;
for (const s of sesi) {
  const row = db.prepare('SELECT dibuka_at FROM kasir_sesi WHERE tanggal = ?').get(s.tanggal);
  const d = row ? new Date(row.dibuka_at) : null;
  const jam = d && !Number.isNaN(d.getTime()) ? (d.getUTCHours() + 7) % 24 : null;
  const awal = jam !== null && jam < GAJI_SHIFT.batasJam;
  const nominal = jam === null ? GAJI_SHIFT.awal : (awal ? GAJI_SHIFT.awal : GAJI_SHIFT.akhir);
  insKar.run(kar.id, s.tanggal, nominal,
    `[auto] shift_${awal ? 'awal' : 'akhir'}${jam !== null ? ` (buka ${jam}:00)` : ''}`,
    new Date().toISOString(), new Date().toISOString());
  hariK += 1;
  totalK += nominal;
}
console.log(`gaji karyawan     : ${hariK} hari, total Rp ${f(totalK)}`);

const rekap = db.prepare(
  `SELECT u.nama, u.role, COUNT(*) n, COALESCE(SUM(g.nominal),0) s
     FROM gaji_harian g JOIN users u ON u.id = g.user_id
    GROUP BY u.id ORDER BY u.role DESC, u.nama`
);
console.log('\nrekap gaji 16-30 Sep:');
for (const r of rekap.all()) {
  console.log(`  ${r.nama.padEnd(12)} ${r.role.padEnd(9)} ${String(r.n).padStart(3)} hari  Rp ${f(r.s)}`);
}
db.close();
