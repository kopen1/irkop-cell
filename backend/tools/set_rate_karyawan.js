// Set rate gaji karyawan per weekday (tipe custom_harian), lalu regenerate
// gaji_harian sesuai rate itu (mengikuti logika getRateForUser di aplikasi).
import { DatabaseSync } from 'node:sqlite';

const DB = new URL('../.dev-data/irkop.db', import.meta.url).pathname;
const HARI = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
// Rate per hari (sesuai keterangan pemilik): karyawan masuk jam 16:00 pada
// Selasa/Kamis/Jumat -> 40rb, hari lain buka jam 13:00 -> 60rb.
const RATE = {
  senin: 60000, selasa: 40000, rabu: 60000,
  kamis: 40000, jumat: 40000, sabtu: 60000, minggu: 60000,
};
const db = new DatabaseSync(DB);
const f = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const kar = db.prepare("SELECT id, nama FROM users WHERE role='karyawan' ORDER BY id LIMIT 1").get();
if (!kar) { console.error('tidak ada user karyawan'); process.exit(1); }
const now = new Date().toISOString();

db.prepare(
  `INSERT INTO karyawan_rate (user_id, tipe, rate_flat, created_at, updated_at)
   VALUES (?, 'custom_harian', NULL, ?, ?)
   ON CONFLICT(user_id) DO UPDATE SET tipe='custom_harian', rate_flat=NULL, updated_at=?`
).run(kar.id, now, now);
db.prepare('DELETE FROM karyawan_rate_harian WHERE user_id = ?').run(kar.id);
for (const hari of HARI) {
  db.prepare('INSERT INTO karyawan_rate_harian (user_id, hari, rate) VALUES (?, ?, ?)').run(kar.id, hari, RATE[hari]);
}
console.log(`rate ${kar.nama} disimpan (custom_harian):`);
for (const hari of ['senin','selasa','rabu','kamis','jumat','sabtu','minggu']) {
  console.log(`   ${hari.padEnd(8)} Rp ${f(RATE[hari])}`);
}

const upd = db.prepare(
  `UPDATE gaji_harian SET nominal = ?, sumber = 'auto', catatan = ?, updated_at = ? WHERE user_id = ? AND tanggal = ?`
);
let total = 0, baris = 0;
for (const s of db.prepare("SELECT tanggal FROM kasir_sesi WHERE status='tutup' ORDER BY tanggal").all()) {
  const hari = HARI[new Date(`${s.tanggal}T00:00:00Z`).getUTCDay()];
  const nominal = RATE[hari];
  upd.run(nominal, `[auto] rate ${hari}`, new Date().toISOString(), kar.id, s.tanggal);
  total += nominal;
  baris += 1;
}
console.log(`\ngaji karyawan di-update: ${baris} hari, total Rp ${f(total)}`);

const cek = db.prepare(
  `SELECT g.tanggal, g.nominal, g.catatan FROM gaji_harian g
     JOIN users u ON u.id = g.user_id WHERE u.role='karyawan' ORDER BY g.tanggal`
);
console.log('\ntanggal        hari        nominal');
for (const r of cek.all()) {
  const hari = HARI[new Date(`${r.tanggal}T00:00:00Z`).getUTCDay()];
  console.log(`  ${r.tanggal}   ${hari.padEnd(9)} ${f(r.nominal).padStart(7)}   ${r.catatan}`);
}
db.close();
