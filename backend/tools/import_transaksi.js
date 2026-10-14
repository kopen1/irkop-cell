// Import transaksi dari CSV aplikasi lama (Google Sheets) ke SQLite lokal.
//
// Pakai:
//   node tools/import_transaksi.js <sheet.csv> [opsi]
// Opsi:
//   --dari=2026-09-16 --sampai=2026-09-30
//   --laci= --orderkuota= --dana= --seabank=   (saldo awal sesi pertama)
//
// Sesi berikutnya memakai saldo akhir sesi sebelumnya sebagai opening,
// sama seperti saran "saldo awal" di aplikasi.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const [, , csvPath, ...args] = process.argv;
const opt = Object.fromEntries(
  args.map((a) => /^--([a-z]+)=(.*)$/.exec(a)).filter(Boolean).map((m) => [m[1], m[2]])
);
const DARI = opt.dari || '2026-09-16';
const SAMPAI = opt.sampai || '2026-09-30';
const ADMIN_ID = Number(opt.admin || 1);
const AKUN_UANG = ['Tunai Laci', 'DANA', 'SeaBank', 'OrderKuota'];
const openingAwal = {
  'Tunai Laci': Number(opt.laci ?? 100000),
  DANA: Number(opt.dana ?? 375000),
  SeaBank: Number(opt.seabank ?? 375000),
  OrderKuota: Number(opt.orderkuota ?? 750000),
};
const DB = new URL('../.dev-data/irkop.db', import.meta.url).pathname;

const rp = (s) => {
  let t = String(s ?? '').replace(/Rp/gi, '').replace(/\./g, '').trim();
  const neg = t.startsWith('-');
  t = t.replace(/-/g, '').replace(/,/g, '');
  const v = parseInt(t, 10);
  return Number.isNaN(v) ? 0 : neg ? -v : v;
};
const tgl = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

// Parser CSV: nama produk bisa berisi koma di dalam tanda kutip
// (mis. "Unlimited 5,5GB 30HR"), jadi split(',) biasa tidak boleh dipakai.
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else { quoted = false; }
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const lines = readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
const head = parseCsvLine(lines[0]).map((h) => h.trim());
const data = lines.slice(1).map((line) => {
  const cells = parseCsvLine(line);
  const o = {};
  head.forEach((h, i) => { o[h] = (cells[i] ?? '').trim(); });
  return o;
});
const rows = data
  .map((r) => ({ ...r, tanggal: tgl(r.Tanggal) }))
  .filter((r) => r.tanggal && r.tanggal >= DARI && r.tanggal <= SAMPAI)
  .sort((a, b) => (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0));

if (!rows.length) {
  console.error(`tidak ada baris untuk ${DARI}..${SAMPAI}`);
  process.exit(1);
}

const db = new DatabaseSync(DB);
db.exec('PRAGMA foreign_keys = ON');

// ---------------------------------------------------------------- produk baru
const kategori = new Map(
  db.prepare('SELECT id, nama FROM kategori_produk').all().map((k) => [k.nama, k])
);
const KAT = { Saldo: 'Saldo', Voucher: 'Voucher', Aksesoris: 'Aksesoris', Servis: 'Service HP' };
const adaKode = new Set(db.prepare('SELECT kode FROM produk').all().map((r) => r.kode));
const insProd = db.prepare(
  `INSERT INTO produk (kode, nama, kategori_id, harga, harga_modal, stok, stok_minimum, satuan, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, 0, 0, 'pcs', ?, ?)`
);
const dibuat = [];
for (const r of rows) {
  const k = r.KodeBarang;
  if (!k || adaKode.has(k)) continue;
  const now = new Date().toISOString();
  insProd.run(k, r.NamaBarang || k, kategori.get(KAT[r.Kategori] || 'Saldo')?.id ?? null,
    rp(r.HargaJual), rp(r.HargaBeli), now, now);
  adaKode.add(k);
  dibuat.push(k);
}
if (dibuat.length) console.log(`produk baru (${dibuat.length}): ${dibuat.join(', ')}\n`);

const produkByKode = new Map(
  db.prepare(`SELECT p.id, p.kategori_id, k.lacak_stok
                FROM produk p LEFT JOIN kategori_produk k ON k.id = p.kategori_id`)
    .all().map((p) => [p.id, p])
);
const idByKode = new Map(
  db.prepare('SELECT id, kode FROM produk').all().map((p) => [p.kode, p.id])
);

// ---------------------------------------------------------------- pemetaan
// Akun sumber produk digital (keputusan pemilik):
//   DANA      -> kode "dana" / nama berisi "dana"
//   SeaBank   -> kode "bank" (Tf Bank)
//   OrderKuota-> sisa kategori Saldo (pulsa, Ovo, Gopay) + kategori Voucher
const akunSumber = (r) => {
  const k = r.KodeBarang.toLowerCase();
  const n = (r.NamaBarang || '').toLowerCase();
  if (k === 'bank' || n.includes('tf bank')) return 'SeaBank';
  if (k === 'dana' || n.includes('dana')) return 'DANA';
  return 'OrderKuota';
};

// ---------------------------------------------------------------- prepared
const insSesi = db.prepare(
  `INSERT INTO kasir_sesi (tanggal, status, dibuka_oleh, dibuka_at, ditutup_oleh, ditutup_at)
   VALUES (?, 'tutup', ?, ?, ?, ?)`
);
const insSaldo = db.prepare(
  `INSERT INTO kasir_saldo (kasir_sesi_id, nama_akun, saldo_sistem, tipe, created_at) VALUES (?, ?, ?, ?, ?)`
);
const insTx = db.prepare(
  `INSERT INTO transaksi (kode_transaksi, metode_bayar, konfirmasi_pembayaran, subtotal, diskon, total, laba,
                          kasir_sesi_id, dibuat_oleh, manual_entry, created_at, updated_at, tanggal_transaksi,
                          jenis, admin_type, mitra, sisa, status_bayar)
   VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 0, 'lunas')`
);
const insItem = db.prepare(
  `INSERT INTO transaksi_item (transaksi_id, produk_id, nama_produk_snapshot, harga_snapshot,
                               harga_modal_snapshot, qty, subtotal, akun_sumber)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const insMut = db.prepare(
  `INSERT INTO mutasi_saldo (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
// Service HP mewajibkan pelanggan; sheet lama tidak menyimpan nama pelanggan.
const insPelanggan = db.prepare(
  `INSERT INTO pelanggan (nama, telepon, total_belanja, frekuensi_transaksi, created_at, updated_at)
   VALUES ('Pelanggan Umum', '', 0, 0, ?, ?)`
);
let pelangganUmum = db.prepare("SELECT id FROM pelanggan WHERE nama = 'Pelanggan Umum'").get()?.id;
if (!pelangganUmum) {
  const ts0 = new Date().toISOString();
  pelangganUmum = Number(insPelanggan.run(ts0, ts0).lastInsertRowid);
  console.log(`pelanggan placeholder dibuat: "Pelanggan Umum" (id ${pelangganUmum})\n`);
}

const insService = db.prepare(
  `INSERT INTO service_hp (pelanggan_id, nama_device, deskripsi_kerusakan, status, sudah_dihubungi,
                           estimasi_biaya, biaya, tanggal_masuk, tanggal_selesai, harga_modal)
   VALUES (?, ?, 'Migrasi aplikasi lama', 'selesai', 1, ?, ?, ?, ?, ?)`
);
const updStok = db.prepare('UPDATE produk SET stok = stok + ?, updated_at = ? WHERE id = ?');
const lastTxId = db.prepare('SELECT id FROM transaksi WHERE kode_transaksi = ?');
const setSrvItem = db.prepare('UPDATE transaksi_item SET service_hp_id = ? WHERE id = last_insert_rowid()');

// ---------------------------------------------------------------- sesi
const tanggalUnik = [...new Set(rows.map((r) => r.tanggal))].sort();
const sesiId = new Map();
const openingSesi = new Map();
let saldo = { ...openingAwal };
let saldoBulanIni = { ...openingAwal };
let tanggalAktif = null;
const saldoTutup = new Map();

const flipSesi = (tanggal) => {
  if (tanggalAktif === tanggal) return;
  if (tanggalAktif) saldoTutup.set(tanggalAktif, { ...saldoBulanIni });
  tanggalAktif = tanggal;
};

for (const t of tanggalUnik) {
  const ts = `${t}T03:00:00.000Z`;
  const id = Number(insSesi.run(t, ADMIN_ID, ts, ADMIN_ID, ts).lastInsertRowid);
  sesiId.set(t, id);
  openingSesi.set(t, { ...saldoBulanIni });
  for (const [akun, nilai] of Object.entries(saldoBulanIni)) {
    insSaldo.run(id, akun, nilai, 'opening', ts);
  }
}

// ---------------------------------------------------------------- loop
const R = { tx: 0, item: 0, svc: 0, mut: 0, laba: 0, omzet: 0, stok: 0, gagal: 0, output: 0 };
const gagal = [];
const mutasi = (sesi, akun, jumlah, txId, key, now) => {
  insMut.run(sesi, akun, jumlah, 'transaksi', txId, `${key}:${akun.replace(/\s+/g, '')}`, now);
  saldo[akun] = (saldo[akun] || 0) + jumlah;
  if (AKUN_UANG.includes(akun)) saldoBulanIni[akun] = (saldoBulanIni[akun] || 0) + jumlah;
  R.mut += 1;
};
let seq = 0;
const perTanggal = new Map();

for (const r of rows) {
  flipSesi(r.tanggal);
  perTanggal.set(r.tanggal, (perTanggal.get(r.tanggal) || 0) + 1);
  const sesi = sesiId.get(r.tanggal);
  const kode = r.KodeBarang;
  const kat = r.Kategori || '';
  const qty = Math.max(1, parseInt(r.Jumlah, 10) || 1);
  const hargaSatuan = rp(r.HargaJual);
  const modalSatuan = rp(r.HargaBeli);
  const modal = modalSatuan * qty;
  const total = rp(r.Total);
  const laba = rp(r.Laba);
  const tf = (r.Pembayaran || '').trim().toUpperCase() === 'TF';
  const now = new Date().toISOString();
  seq += 1;
  const kodeTx = `TX-${r.tanggal.replace(/-/g, '')}-${String(seq).padStart(3, '0')}`;

  try {
    // (1) Output Saldo Lain -> mutasi saldo, bukan transaksi
    if (kode === 'output') {
      const akun = akunSumber(r);
      mutasi(sesi, akun, -modal, null, `mig-${r.IDTransaksi}`, now);
      R.output += 1;
      continue;
    }

    // (2) Tarik tunai (admin dalam): saldo masuk, laci keluar nominal-fee, laba = fee
    if (kode === 'Tt' || kat === 'Tarik Tunai') {
      const nominal = modalSatuan * qty;
      const fee = total;
      insTx.run(kodeTx, 'cash_tunai', 'tidak_perlu', fee, fee, fee, sesi, ADMIN_ID, now, now,
        r.tanggal, 'tariktunai', 'dalam', 'SeaBank');
      const id = Number(lastTxId.get(kodeTx).id);
      mutasi(sesi, 'SeaBank', nominal, id, kodeTx, now);
      mutasi(sesi, 'Tunai Laci', -(nominal - fee), id, kodeTx, now);
      mutasi(sesi, 'Laba', fee, id, kodeTx, now);
      R.tx += 1; R.laba += fee; R.omzet += fee;
      continue;
    }

    // (3) Service HP
    if (kode === 'Service' || kat === 'Servis') {
      const biaya = total;
      const svcId = Number(insService.run(pelangganUmum, r.NamaBarang || 'Service', biaya, biaya,
        r.tanggal, r.tanggal, modal).lastInsertRowid);
      insTx.run(kodeTx, 'tunai', 'tidak_perlu', biaya, biaya, laba, sesi, ADMIN_ID, now, now,
        r.tanggal, 'service', null, null);
      const id = Number(lastTxId.get(kodeTx).id);
      insItem.run(id, null, r.NamaBarang || 'Service', biaya, modal, qty, biaya, null);
      setSrvItem.run(svcId);
      mutasi(sesi, 'Tunai Laci', biaya, id, kodeTx, now);
      mutasi(sesi, 'Laba', laba, id, kodeTx, now);
      R.tx += 1; R.item += 1; R.svc += 1; R.laba += laba; R.omzet += biaya;
      continue;
    }

    // (4) Produk digital (kategori Saldo) atau penjualan fisik
    const digital = kat === 'Saldo';
    // Kolom Cash di sheet lama otoritatif: kalau isinya bukan 0, uang masuk
    // laci walau label Pembayaran=TF.
    const tfKeLaci = tf && rp(r.Cash) !== 0;
    const metode = tf && !tfKeLaci ? 'transfer' : 'tunai';
    const akun = digital ? akunSumber(r) : null;
    insTx.run(kodeTx, metode, tf ? 'manual' : 'tidak_perlu', total, total, laba, sesi, ADMIN_ID, now, now,
      r.tanggal, digital ? 'produkdigital' : null, null, null);
    const id = Number(lastTxId.get(kodeTx).id);
    const pid = idByKode.get(kode) ?? null;
    insItem.run(id, pid, r.NamaBarang || kode, hargaSatuan * qty, modalSatuan * qty, qty, total, akun);

    if (metode === 'tunai') mutasi(sesi, 'Tunai Laci', total, id, kodeTx, now);
    else mutasi(sesi, 'SeaBank', total, id, kodeTx, now);
    if (digital) mutasi(sesi, akun, -modal, id, kodeTx, now);
    mutasi(sesi, 'Laba', laba, id, kodeTx, now);

    // Stok hanya kategori berstok & bukan produk digital
    if (!digital && pid && produkByKode.get(pid)?.lacak_stok === 1) {
      updStok.run(-qty, now, pid);
      R.stok += qty;
    }
    R.tx += 1; R.item += 1; R.laba += laba; R.omzet += total;
  } catch (e) {
    R.gagal += 1;
    if (gagal.length < 8) gagal.push(`${r.tanggal} ${kode} ${r.NamaBarang}: ${e.message}`);
  }
}
saldoTutup.set(tanggalAktif, { ...saldoBulanIni });

// ---------------------------------------------------------------- closing
for (const [t, id] of sesiId) {
  const akhir = saldoTutup.get(t) || openingSesi.get(t);
  for (const akun of AKUN_UANG) {
    insSaldo.run(id, akun, akhir[akun] || 0, 'closing', new Date().toISOString());
  }
}

// ---------------------------------------------------------------- laporan
const c = (tq) => db.prepare(`SELECT COUNT(*) n FROM ${tq}`).get().n;
const f = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
console.log('=== HASIL IMPORT ===');
console.log(`periode        : ${DARI} .. ${SAMPAI}  (${rows.length} baris sheet)`);
console.log(`sesi kasir     : ${sesiId.size}`);
console.log(`transaksi      : ${R.tx}   (tabel: ${c('transaksi')})`);
console.log(`transaksi_item : ${R.item}  (tabel: ${c('transaksi_item')})`);
console.log(`service_hp     : ${R.svc}  (tabel: ${c('service_hp')})`);
console.log(`mutasi_saldo   : ${R.mut}  (tabel: ${c('mutasi_saldo')})`);
console.log(`output (mutasi): ${R.output}`);
console.log(`stok berkurang : ${R.stok} unit`);
console.log(`gagal          : ${R.gagal}`);
gagal.forEach((g) => console.log('   - ' + g));
console.log('');
console.log('opening sesi ' + DARI + ':');
for (const [k, v] of Object.entries(openingAwal)) console.log(`   ${k.padEnd(12)} ${f(v).padStart(12)}`);
console.log('');
console.log('saldo akhir ' + tanggalUnik[tanggalUnik.length - 1] + ':');
for (const k of [...AKUN_UANG, 'Laba']) console.log(`   ${k.padEnd(12)} ${f(saldo[k] ?? 0).padStart(12)}`);
db.close();
