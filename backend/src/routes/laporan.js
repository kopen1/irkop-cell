import { err } from '../lib/errors.js';
import { wibDateToUtcRange, isValidCalendarDate } from '../lib/time.js';
import { LEDGER_AKUN } from '../financial/akun.js';

function formatBulan(tahun, mon) {
  return `${tahun}-${String(mon).padStart(2, '0')}`;
}

function monthRange(bulan) {
  const m = /^(\d{4})-(\d{2})$/.exec(bulan || '');
  if (!m) throw err(400, 'invalid_filter', 'bulan harus format YYYY-MM');
  const tahun = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) throw err(400, 'invalid_filter', 'bulan harus 01-12');
  const startDay = `${tahun}-${String(mon).padStart(2, '0')}-01`;
  const end = new Date(Date.UTC(tahun, mon, 1)); // first of next month
  const nextMonth = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const a = wibDateToUtcRange(startDay);
  const b = wibDateToUtcRange(nextMonth);
  return {
    tahun,
    mon,
    startUtc: a.startUtc,
    endUtc: b.startUtc,
    startDate: startDay,
    endDate: b.endUtc ? `${tahun}-${String(mon).padStart(2, '0')}-${new Date(Date.UTC(tahun, mon, 0)).getUTCDate()}` : startDay,
  };
}

function yearRange(tahunStr) {
  const tahun = Number(tahunStr);
  if (!Number.isInteger(tahun) || tahun < 2000 || tahun > 2100) {
    throw err(400, 'invalid_filter', 'tahun tidak valid');
  }
  const a = wibDateToUtcRange(`${tahun}-01-01`);
  const b = wibDateToUtcRange(`${tahun + 1}-01-01`);
  return { tahun, startUtc: a.startUtc, endUtc: b.startUtc };
}

function scalarSum(rows, key) {
  const r = rows?.[0] ? Number(rows[0][key] ?? 0) : 0;
  return r;
}

export async function reportBulanan(db, request, ctx) {
  const url = new URL(request.url);
  const bulan = url.searchParams.get('bulan');
  const range = monthRange(bulan || currentBulanWib());
  const startD = `${range.tahun}-${String(range.mon).padStart(2, '0')}-01`;
  const endD = lastDayDate(range.tahun, range.mon);

  const tx = await db.one(
    `SELECT COUNT(*) AS jumlah, COALESCE(SUM(laba), 0) AS laba
       FROM transaksi WHERE deleted_at IS NULL AND tanggal_transaksi >= ? AND tanggal_transaksi <= ?`,
    startD, endD
  );
  const laba = scalarSum([tx], 'laba');
  // Omzet = PENJUALAN saja (item subtotal). Nominal titipan (kirim uang/tarik/
  // transfer) TIDAK dihitung omzet — ditampilkan terpisah sebagai arus dana.
  const omzetRow = await db.one(
    `SELECT COALESCE(SUM(ti.subtotal), 0) AS omzet
       FROM transaksi t JOIN transaksi_item ti ON ti.transaksi_id = t.id
      WHERE t.deleted_at IS NULL AND t.tanggal_transaksi >= ? AND t.tanggal_transaksi <= ?`,
    startD, endD
  );
  const omzet = scalarSum([omzetRow], 'omzet');

  const kategori = await db.many(
    `SELECT k.id AS kategori_id,
            COALESCE(k.nama, CASE WHEN ti.service_hp_id IS NOT NULL THEN 'Service HP' ELSE 'Tanpa Kategori' END) AS nama_kategori,
            COUNT(*) AS jumlah_item, SUM(ti.qty) AS qty, SUM(ti.subtotal) AS omzet
       FROM transaksi t
       JOIN transaksi_item ti ON ti.transaksi_id = t.id
       LEFT JOIN produk p ON p.id = ti.produk_id
       LEFT JOIN kategori_produk k ON k.id = p.kategori_id
      WHERE t.deleted_at IS NULL AND t.tanggal_transaksi >= ? AND t.tanggal_transaksi <= ?
      GROUP BY k.id, k.nama ORDER BY omzet DESC`,
    startD, endD
  );

  // Arus dana: nilai titipan yang pindah (bukan pendapatan) + admin fee.
  const kirimUangRow = await db.one(
    `SELECT COALESCE(SUM(ti.nominal_referensi * ti.qty), 0) AS kirim_uang
       FROM transaksi t
       JOIN transaksi_item ti ON ti.transaksi_id = t.id
       LEFT JOIN produk p ON p.id = ti.produk_id
       LEFT JOIN kategori_produk k ON k.id = p.kategori_id
      WHERE t.deleted_at IS NULL AND t.jenis IS NULL AND ti.nominal_referensi IS NOT NULL
        AND COALESCE(k.nama, '') NOT LIKE '%tarik%'
        AND t.tanggal_transaksi >= ? AND t.tanggal_transaksi <= ?`,
    startD, endD
  );
  const adminDanaRow = await db.one(
    `SELECT
       COALESCE(SUM(CASE WHEN jenis = 'tariktunai' THEN total ELSE 0 END), 0) AS tarik_tunai,
       COALESCE(SUM(CASE WHEN jenis = 'transfer' THEN total - COALESCE(laba, 0) ELSE 0 END), 0) AS transfer
       FROM transaksi WHERE deleted_at IS NULL AND jenis IN ('tariktunai','transfer')
        AND tanggal_transaksi >= ? AND tanggal_transaksi <= ?`,
    startD, endD
  );
  const adminFeeRow = await db.one(
    `SELECT COALESCE(SUM(laba), 0) AS admin FROM transaksi
      WHERE deleted_at IS NULL AND jenis IN ('tariktunai','transfer')
        AND tanggal_transaksi >= ? AND tanggal_transaksi <= ?`,
    startD, endD
  );

  const kasbon = await db.one(
    `SELECT
       COUNT(CASE WHEN tanggal >= ? AND tanggal <= ? THEN 1 END) AS baru,
       COALESCE(SUM(CASE WHEN tanggal >= ? AND tanggal <= ? THEN nominal END), 0) AS nominal_baru,
       COUNT(CASE WHEN status = 'lunas' AND lunas_at >= ? AND lunas_at < ? THEN 1 END) AS lunas,
       COUNT(CASE WHEN status = 'belum_lunas' THEN 1 END) AS belum_lunas,
       COALESCE(SUM(CASE WHEN status = 'belum_lunas' THEN nominal END), 0) AS nominal_belum_lunas
      FROM kasbon`,
    startD, endD, startD, endD, range.startUtc, range.endUtc
  );

  const pengeluaran = await db.one(
    `SELECT COUNT(*) AS jumlah, COALESCE(SUM(nominal), 0) AS total
       FROM pengeluaran WHERE deleted_at IS NULL AND tanggal >= ? AND tanggal <= ?`,
    startD, endD
  );
  const pengeluaranTotal = scalarSum([pengeluaran], 'total');
  const net = laba - pengeluaranTotal;

  const prev = monthRange(formatBulan(prevMonth(range.tahun, range.mon).tahun, prevMonth(range.tahun, range.mon).mon));
  const prevTx = await db.one(
    `SELECT COALESCE(SUM(laba), 0) AS laba
       FROM transaksi WHERE deleted_at IS NULL AND tanggal_transaksi >= ? AND tanggal_transaksi <= ?`,
    `${prev.tahun}-${String(prev.mon).padStart(2, '0')}-01`,
    lastDayDate(prev.tahun, prev.mon)
  );
  const prevOmzet = await db.one(
    `SELECT COALESCE(SUM(ti.subtotal), 0) AS omzet
       FROM transaksi t JOIN transaksi_item ti ON ti.transaksi_id = t.id
      WHERE t.deleted_at IS NULL AND t.tanggal_transaksi >= ? AND t.tanggal_transaksi <= ?`,
    `${prev.tahun}-${String(prev.mon).padStart(2, '0')}-01`,
    lastDayDate(prev.tahun, prev.mon)
  );
  const prevPend = await db.one(
    "SELECT COALESCE(SUM(nominal), 0) AS total FROM pengeluaran WHERE deleted_at IS NULL AND tanggal >= ? AND tanggal <= ?",
    `${prev.tahun}-${String(prev.mon).padStart(2, '0')}-01`,
    lastDayDate(prev.tahun, prev.mon)
  );

  // Rincian per tanggal: transaksi/omzet/laba, pengeluaran, beli stok, net.
  const txHarian = await db.many(
    `SELECT tanggal_transaksi AS tanggal, COUNT(*) AS jumlah_transaksi, COALESCE(SUM(laba), 0) AS laba
       FROM transaksi WHERE deleted_at IS NULL AND tanggal_transaksi >= ? AND tanggal_transaksi <= ?
       GROUP BY tanggal_transaksi`,
    startD, endD
  );
  const omzetHarian = await db.many(
    `SELECT t.tanggal_transaksi AS tanggal, COALESCE(SUM(ti.subtotal), 0) AS omzet
       FROM transaksi t JOIN transaksi_item ti ON ti.transaksi_id = t.id
      WHERE t.deleted_at IS NULL AND t.tanggal_transaksi >= ? AND t.tanggal_transaksi <= ?
      GROUP BY t.tanggal_transaksi`,
    startD, endD
  );
  const pengHarian = await db.many(
    `SELECT tanggal, COALESCE(SUM(nominal), 0) AS pengeluaran FROM pengeluaran
      WHERE deleted_at IS NULL AND tanggal >= ? AND tanggal <= ? GROUP BY tanggal`,
    startD, endD
  );
  const beliHarian = await db.many(
    `SELECT tanggal, COALESCE(SUM(total), 0) AS beli_stok FROM pembelian_stok
      WHERE deleted_at IS NULL AND tanggal >= ? AND tanggal <= ? GROUP BY tanggal`,
    startD, endD
  );
  const harianMap = new Map();
  const ensureHarian = (t) => {
    if (!harianMap.has(t)) {
      harianMap.set(t, { tanggal: t, jumlah_transaksi: 0, omzet: 0, laba: 0, pengeluaran: 0, beli_stok: 0 });
    }
    return harianMap.get(t);
  };
  for (const r of txHarian) {
    const h = ensureHarian(r.tanggal);
    h.jumlah_transaksi = Number(r.jumlah_transaksi);
    h.laba = Number(r.laba);
  }
  for (const r of omzetHarian) ensureHarian(r.tanggal).omzet = Number(r.omzet);
  for (const r of pengHarian) ensureHarian(r.tanggal).pengeluaran = Number(r.pengeluaran);
  for (const r of beliHarian) ensureHarian(r.tanggal).beli_stok = Number(r.beli_stok);
  const harian = [...harianMap.values()]
    .map((h) => ({ ...h, net: h.laba - h.pengeluaran }))
    .sort((a, b) => (a.tanggal < b.tanggal ? -1 : 1));

  const arusDana = {
    kirim_uang: scalarSum([kirimUangRow], 'kirim_uang'),
    tarik_tunai: scalarSum([adminDanaRow], 'tarik_tunai'),
    transfer: scalarSum([adminDanaRow], 'transfer'),
  };
  arusDana.total = arusDana.kirim_uang + arusDana.tarik_tunai + arusDana.transfer;

  // Saldo akun: awal bulan (opening sesi pertama) & akhir bulan (opening +
  // mutasi sesi terakhir di bulan itu). Ledger dikecualikan.
  const firstSesi = await db.one(
    'SELECT id FROM kasir_sesi WHERE tanggal >= ? AND tanggal <= ? ORDER BY tanggal, id LIMIT 1',
    startD, endD
  );
  const lastSesi = await db.one(
    'SELECT id FROM kasir_sesi WHERE tanggal >= ? AND tanggal <= ? ORDER BY tanggal DESC, id DESC LIMIT 1',
    startD, endD
  );
  const saldoAkunMap = new Map();
  if (firstSesi) {
    const openingAwal = await db.many(
      "SELECT nama_akun, saldo_sistem FROM kasir_saldo WHERE kasir_sesi_id = ? AND tipe = 'opening'",
      firstSesi.id
    );
    for (const o of openingAwal) {
      if (LEDGER_AKUN.includes(o.nama_akun)) continue;
      saldoAkunMap.set(o.nama_akun, { nama_akun: o.nama_akun, saldo_awal: Number(o.saldo_sistem), saldo_akhir: 0 });
    }
  }
  if (lastSesi) {
    const openingAkhir = await db.many(
      "SELECT nama_akun, saldo_sistem FROM kasir_saldo WHERE kasir_sesi_id = ? AND tipe = 'opening'",
      lastSesi.id
    );
    const mutAkhir = await db.many(
      'SELECT nama_akun, SUM(jumlah) AS total FROM mutasi_saldo WHERE kasir_sesi_id = ? GROUP BY nama_akun',
      lastSesi.id
    );
    const akhirMap = {};
    for (const o of openingAkhir) if (!LEDGER_AKUN.includes(o.nama_akun)) akhirMap[o.nama_akun] = Number(o.saldo_sistem);
    for (const m of mutAkhir) {
      if (LEDGER_AKUN.includes(m.nama_akun)) continue;
      akhirMap[m.nama_akun] = (akhirMap[m.nama_akun] || 0) + Number(m.total);
    }
    for (const [akun, saldo] of Object.entries(akhirMap)) {
      if (!saldoAkunMap.has(akun)) saldoAkunMap.set(akun, { nama_akun: akun, saldo_awal: 0, saldo_akhir: 0 });
      saldoAkunMap.get(akun).saldo_akhir = saldo;
    }
  }
  const saldoAkun = [...saldoAkunMap.values()].sort((a, b) => (a.nama_akun < b.nama_akun ? -1 : 1));
  const totalSaldoAwal = saldoAkun.reduce((s, a) => s + a.saldo_awal, 0);
  const totalSaldoAkhir = saldoAkun.reduce((s, a) => s + a.saldo_akhir, 0);

  return {
    periode: 'bulanan',
    bulan: `${range.tahun}-${String(range.mon).padStart(2, '0')}`,
    jumlah_transaksi: scalarSum([tx], 'jumlah'),
    omzet,
    laba,
    pendapatan_admin: scalarSum([adminFeeRow], 'admin'),
    arus_dana: arusDana,
    saldo_akun: saldoAkun,
    total_saldo_awal: totalSaldoAwal,
    total_saldo_akhir: totalSaldoAkhir,
    rekap_kategori: kategori,
    rincian_harian: harian,
    kasbon: {
      baru: scalarSum([kasbon], 'baru'),
      nominal_baru: scalarSum([kasbon], 'nominal_baru'),
      lunas: scalarSum([kasbon], 'lunas'),
      belum_lunas: scalarSum([kasbon], 'belum_lunas'),
      nominal_belum_lunas: scalarSum([kasbon], 'nominal_belum_lunas'),
    },
    pengeluaran: { jumlah: scalarSum([pengeluaran], 'jumlah'), total: pengeluaranTotal },
    net,
    perbandingan_bulan_sebelumnya: {
      bulan: `${prev.tahun}-${String(prev.mon).padStart(2, '0')}`,
      omzet: scalarSum([prevOmzet], 'omzet'),
      laba: scalarSum([prevTx], 'laba'),
      pengeluaran: scalarSum([prevPend], 'total'),
    },
  };
}

export async function reportTahunan(db, request, ctx) {
  const url = new URL(request.url);
  const range = yearRange(url.searchParams.get('tahun') || String(new Date().getUTCFullYear()));
  const { tahun } = range;

  const tx = await db.one(
    `SELECT COUNT(*) AS jumlah, COALESCE(SUM(laba), 0) AS laba
       FROM transaksi WHERE deleted_at IS NULL AND tanggal_transaksi >= ? AND tanggal_transaksi <= ?`,
    `${tahun}-01-01`, `${tahun}-12-31`
  );
  const laba = scalarSum([tx], 'laba');
  const omzetRow = await db.one(
    `SELECT COALESCE(SUM(ti.subtotal), 0) AS omzet
       FROM transaksi t JOIN transaksi_item ti ON ti.transaksi_id = t.id
      WHERE t.deleted_at IS NULL AND t.tanggal_transaksi >= ? AND t.tanggal_transaksi <= ?`,
    `${tahun}-01-01`, `${tahun}-12-31`
  );

  const kategori = await db.many(
    `SELECT k.id AS kategori_id,
            COALESCE(k.nama, CASE WHEN ti.service_hp_id IS NOT NULL THEN 'Service HP' ELSE 'Tanpa Kategori' END) AS nama_kategori,
            SUM(ti.qty) AS qty, SUM(ti.subtotal) AS omzet
       FROM transaksi t
       JOIN transaksi_item ti ON ti.transaksi_id = t.id
       LEFT JOIN produk p ON p.id = ti.produk_id
       LEFT JOIN kategori_produk k ON k.id = p.kategori_id
      WHERE t.deleted_at IS NULL AND t.tanggal_transaksi >= ? AND t.tanggal_transaksi <= ?
      GROUP BY k.id, k.nama ORDER BY omzet DESC`,
    `${tahun}-01-01`, `${tahun}-12-31`
  );

  const pengeluaran = await db.one(
    `SELECT COUNT(*) AS jumlah, COALESCE(SUM(nominal), 0) AS total
       FROM pengeluaran WHERE deleted_at IS NULL AND tanggal >= ? AND tanggal <= ?`,
    `${tahun}-01-01`, `${tahun}-12-31`
  );
  const pengeluaranTotal = scalarSum([pengeluaran], 'total');

  const breakdown12 = [];
  for (let m = 1; m <= 12; m += 1) {
    const mr = monthRange(`${tahun}-${String(m).padStart(2, '0')}`);
    const mt = await db.one(
      `SELECT COUNT(*) AS jumlah, COALESCE(SUM(laba), 0) AS laba
         FROM transaksi WHERE deleted_at IS NULL AND tanggal_transaksi >= ? AND tanggal_transaksi <= ?`,
      mr.startDate, mr.endDate
    );
    const mo = await db.one(
      `SELECT COALESCE(SUM(ti.subtotal), 0) AS omzet
         FROM transaksi t JOIN transaksi_item ti ON ti.transaksi_id = t.id
        WHERE t.deleted_at IS NULL AND t.tanggal_transaksi >= ? AND t.tanggal_transaksi <= ?`,
      mr.startDate, mr.endDate
    );
    const mp = await db.one(
      "SELECT COALESCE(SUM(nominal), 0) AS total FROM pengeluaran WHERE deleted_at IS NULL AND tanggal >= ? AND tanggal <= ?",
      mr.startDate, mr.endDate
    );
    const mLaba = scalarSum([mt], 'laba');
    const mPend = scalarSum([mp], 'total');
    breakdown12.push({
      bulan: `${tahun}-${String(m).padStart(2, '0')}`,
      omzet: scalarSum([mo], 'omzet'),
      jumlah_transaksi: scalarSum([mt], 'jumlah'),
      laba: mLaba,
      pengeluaran: mPend,
      net: mLaba - mPend,
    });
  }

  return {
    periode: 'tahunan',
    tahun,
    jumlah_transaksi: scalarSum([tx], 'jumlah'),
    omzet: scalarSum([omzetRow], 'omzet'),
    laba,
    pengeluaran: { jumlah: scalarSum([pengeluaran], 'jumlah'), total: pengeluaranTotal },
    net: laba - pengeluaranTotal,
    breakdown_12_bulan: breakdown12,
    ranking_kategori_terlaris: kategori,
  };
}

// Produk terlaris per periode (bulanan/tahunan): qty terjual, jumlah transaksi,
// omzet, dan laba. Pakai snapshot transaksi_item agar produk lama/rename tetap
// terhitung. Item "tarik" tidak menambah omzet dari nominal_referensi (uang
// titipan, bukan omzet) — konsisten dengan rekap kategori.
export async function produkTerlaris(db, request, ctx) {
  const url = new URL(request.url);
  const bulan = url.searchParams.get('bulan');
  const tahun = url.searchParams.get('tahun');
  let startD;
  let endD;
  let label;
  if (bulan) {
    const range = monthRange(bulan);
    startD = `${range.tahun}-${String(range.mon).padStart(2, '0')}-01`;
    endD = lastDayDate(range.tahun, range.mon);
    label = bulan;
  } else if (tahun) {
    const range = yearRange(tahun);
    startD = `${range.tahun}-01-01`;
    endD = `${range.tahun}-12-31`;
    label = String(range.tahun);
  } else {
    throw err(400, 'invalid_filter', 'bulan atau tahun wajib diisi');
  }
  const limit = Math.min(Number(url.searchParams.get('limit') || '50'), 200);

  const rows = await db.many(
    `SELECT COALESCE(k.nama, CASE WHEN ti.service_hp_id IS NOT NULL THEN 'Service HP' ELSE 'Tanpa Kategori' END) AS nama_kategori,
            ti.produk_id AS produk_id,
            ti.nama_produk_snapshot AS nama_produk,
            SUM(ti.qty) AS qty,
            COUNT(DISTINCT ti.transaksi_id) AS jumlah_transaksi,
            SUM(ti.subtotal) AS omzet,
            SUM((ti.harga_snapshot - COALESCE(ti.harga_modal_snapshot, 0)) * ti.qty) AS laba
       FROM transaksi t
       JOIN transaksi_item ti ON ti.transaksi_id = t.id
       LEFT JOIN produk p ON p.id = ti.produk_id
       LEFT JOIN kategori_produk k ON k.id = p.kategori_id
      WHERE t.deleted_at IS NULL AND t.tanggal_transaksi >= ? AND t.tanggal_transaksi <= ?
      GROUP BY ti.nama_produk_snapshot, ti.produk_id, k.nama
      ORDER BY qty DESC, omzet DESC
      LIMIT ?`,
    startD, endD, limit
  );

  return {
    periode: bulan ? 'bulanan' : 'tahunan',
    label,
    items: rows.map((r, i) => ({
      peringkat: i + 1,
      produk_id: r.produk_id,
      nama_produk: r.nama_produk,
      nama_kategori: r.nama_kategori,
      qty: Number(r.qty),
      jumlah_transaksi: Number(r.jumlah_transaksi),
      omzet: Number(r.omzet),
      laba: Number(r.laba),
    })),
  };
}

// Nilai stok fisik saat ini (hanya kategori lacak_stok=1; aksesoris & voucher).
// Dihitung dari master produk: stok × modal dan stok × harga jual.
export async function nilaiStok(db, request, ctx) {
  const rows = await db.many(
    `SELECT COALESCE(k.nama, 'Tanpa Kategori') AS nama_kategori,
            p.id AS produk_id, p.kode, p.nama,
            p.stok, p.harga, COALESCE(p.harga_modal, 0) AS harga_modal,
            p.stok * COALESCE(p.harga_modal, 0) AS nilai_modal,
            p.stok * p.harga AS nilai_jual
       FROM produk p
       LEFT JOIN kategori_produk k ON k.id = p.kategori_id
      WHERE p.deleted_at IS NULL AND COALESCE(k.lacak_stok, 0) = 1
      ORDER BY k.nama, p.nama`
  );
  const byKat = new Map();
  for (const r of rows) {
    if (!byKat.has(r.nama_kategori)) {
      byKat.set(r.nama_kategori, { nama_kategori: r.nama_kategori, jumlah_produk: 0, qty: 0, nilai_modal: 0, nilai_jual: 0 });
    }
    const g = byKat.get(r.nama_kategori);
    g.jumlah_produk += 1;
    g.qty += Number(r.stok);
    g.nilai_modal += Number(r.nilai_modal);
    g.nilai_jual += Number(r.nilai_jual);
  }
  const per_kategori = [...byKat.values()].map((g) => ({ ...g, potensi_laba: g.nilai_jual - g.nilai_modal }));
  const total = per_kategori.reduce(
    (a, g) => ({ qty: a.qty + g.qty, nilai_modal: a.nilai_modal + g.nilai_modal, nilai_jual: a.nilai_jual + g.nilai_jual }),
    { qty: 0, nilai_modal: 0, nilai_jual: 0 }
  );
  total.potensi_laba = total.nilai_jual - total.nilai_modal;

  return {
    items: rows.map((r) => ({
      produk_id: r.produk_id, kode: r.kode, nama: r.nama, nama_kategori: r.nama_kategori,
      stok: Number(r.stok), harga: Number(r.harga), harga_modal: Number(r.harga_modal),
      nilai_modal: Number(r.nilai_modal), nilai_jual: Number(r.nilai_jual),
      potensi_laba: Number(r.nilai_jual) - Number(r.nilai_modal),
    })),
    per_kategori,
    total,
  };
}

// Rekonsiliasi bulanan. Identitas:
//   ΔUang = Laba − ΔStok(modal) − Pengeluaran_operasional − ΔPiutang
// ΔStok = pembelian_stok − COGS stok fisik. Selisih di luar toleransi
// ditandai 'bahaya' (uang kurang) atau 'perhatian' (uang lebih).
export async function rekonsiliasi(db, request, ctx) {
  const url = new URL(request.url);
  const bulan = url.searchParams.get('bulan') || currentBulanWib();
  const range = monthRange(bulan);
  const startD = `${range.tahun}-${String(range.mon).padStart(2, '0')}-01`;
  const endD = lastDayDate(range.tahun, range.mon);
  const toleransi = Math.max(0, Number(url.searchParams.get('toleransi') || '20000'));

  const tx = await db.one(
    `SELECT COUNT(*) AS jumlah, COALESCE(SUM(total), 0) AS omzet, COALESCE(SUM(laba), 0) AS laba
       FROM transaksi WHERE deleted_at IS NULL AND tanggal_transaksi >= ? AND tanggal_transaksi <= ?`,
    startD, endD
  );
  const laba = scalarSum([tx], 'laba');

  const peng = await db.one(
    'SELECT COALESCE(SUM(nominal), 0) AS total FROM pengeluaran WHERE deleted_at IS NULL AND tanggal >= ? AND tanggal <= ?',
    startD, endD
  );
  const pengeluaran = scalarSum([peng], 'total');

  const cogsRow = await db.one(
    `SELECT COALESCE(SUM(ti.harga_modal_snapshot * ti.qty), 0) AS cogs
       FROM transaksi t
       JOIN transaksi_item ti ON ti.transaksi_id = t.id
       JOIN produk p ON p.id = ti.produk_id
       JOIN kategori_produk k ON k.id = p.kategori_id
      WHERE t.deleted_at IS NULL AND t.tanggal_transaksi >= ? AND t.tanggal_transaksi <= ?
        AND COALESCE(t.jenis, '') != 'produkdigital' AND k.lacak_stok = 1`,
    startD, endD
  );
  const cogs = scalarSum([cogsRow], 'cogs');

  const beliRow = await db.one(
    `SELECT COALESCE(SUM(psi.subtotal), 0) AS beli
       FROM pembelian_stok ps JOIN pembelian_stok_item psi ON psi.pembelian_id = ps.id
      WHERE ps.deleted_at IS NULL AND ps.tanggal >= ? AND ps.tanggal <= ?`,
    startD, endD
  );
  const beli = scalarSum([beliRow], 'beli');
  const delta_stok = beli - cogs;

  const kasbonBaru = await db.one('SELECT COALESCE(SUM(nominal), 0) AS n FROM kasbon WHERE tanggal >= ? AND tanggal <= ?', startD, endD);
  const kasbonBayar = await db.one('SELECT COALESCE(SUM(nominal), 0) AS n FROM kasbon_pembayaran WHERE tanggal >= ? AND tanggal <= ?', startD, endD);
  const delta_piutang = scalarSum([kasbonBaru], 'n') - scalarSum([kasbonBayar], 'n');

  const aktualRow = await db.one(
    `SELECT COALESCE(SUM(ms.jumlah), 0) AS n
       FROM mutasi_saldo ms
       JOIN kasir_sesi ks ON ks.id = ms.kasir_sesi_id
       JOIN akun_master a ON lower(a.nama_akun) = lower(ms.nama_akun)
      WHERE ks.tanggal >= ? AND ks.tanggal <= ? AND a.tipe != 'lainnya'
        AND ms.nama_akun NOT IN ('Saldo Akun', 'Total Saldo', 'Laba')`,
    startD, endD
  );
  const aktual = scalarSum([aktualRow], 'n');

  const expected = laba - delta_stok - pengeluaran - delta_piutang;
  const selisih = aktual - expected;
  let status = 'aman';
  if (selisih < -toleransi) status = 'bahaya';
  else if (selisih > toleransi) status = 'perhatian';

  const perAkunRows = await db.many(
    `SELECT ms.nama_akun, COALESCE(SUM(ms.jumlah), 0) AS total
       FROM mutasi_saldo ms JOIN kasir_sesi ks ON ks.id = ms.kasir_sesi_id
      WHERE ks.tanggal >= ? AND ks.tanggal <= ?
      GROUP BY ms.nama_akun ORDER BY ms.nama_akun`,
    startD, endD
  );

  return {
    periode: bulan,
    jumlah_transaksi: scalarSum([tx], 'jumlah'),
    omzet: scalarSum([tx], 'omzet'),
    laba,
    pengeluaran_operasional: pengeluaran,
    cogs_stok_fisik: cogs,
    pembelian_stok: beli,
    delta_stok,
    kasbon_baru: scalarSum([kasbonBaru], 'n'),
    kasbon_bayar: scalarSum([kasbonBayar], 'n'),
    delta_piutang,
    delta_uang_aktual: aktual,
    delta_uang_seharusnya: expected,
    selisih,
    toleransi,
    status,
    per_akun: perAkunRows.map((r) => ({ nama_akun: r.nama_akun, total: Number(r.total) })),
  };
}

function jenisMutasi(ms) {
  if (ms.sumber_tipe === 'transaksi') return 'Penjualan/Transaksi';
  if (ms.sumber_tipe === 'pengeluaran') return 'Pengeluaran';
  if (ms.sumber_tipe === 'kasbon_pelunasan') return 'Kasbon';
  if (ms.sumber_tipe === 'reversal') return 'Reversal/Koreksi';
  if (ms.sumber_tipe === 'penyesuaian') {
    if (ms.kategori === 'transfer_internal') return 'Transfer antar akun';
    if (ms.kategori === 'pembelian_stok') return 'Beli Stok';
    return 'Penyesuaian';
  }
  return ms.sumber_tipe;
}

// Buku Kas: SATU daftar semua pergerakan uang (penjualan, pengeluaran, beli
// stok, transfer antar akun, kasbon, reversal) agar tidak ada yang "hilang"
// saat direkap. Hanya akun uang (ledger Laba/Saldo Akun dikecualikan).
export async function bukuKas(db, request, ctx) {
  const url = new URL(request.url);
  const bulan = url.searchParams.get('bulan') || currentBulanWib();
  const range = monthRange(bulan);
  const startD = `${range.tahun}-${String(range.mon).padStart(2, '0')}-01`;
  const endD = lastDayDate(range.tahun, range.mon);

  const rows = await db.many(
    `SELECT ms.id, ks.tanggal, ms.nama_akun, ms.jumlah, ms.sumber_tipe, ms.kategori, ms.sumber_id,
            t.kode_transaksi, pg.deskripsi AS pengeluaran_deskripsi,
            ps.catatan AS beli_catatan, ts.dari_akun, ts.ke_akun, ts.catatan AS transfer_catatan
       FROM mutasi_saldo ms
       JOIN kasir_sesi ks ON ks.id = ms.kasir_sesi_id
       LEFT JOIN transaksi t ON ms.sumber_tipe = 'transaksi' AND t.id = ms.sumber_id
       LEFT JOIN pengeluaran pg ON ms.sumber_tipe = 'pengeluaran' AND pg.id = ms.sumber_id
       LEFT JOIN pembelian_stok ps ON ms.sumber_tipe = 'penyesuaian' AND ms.kategori = 'pembelian_stok' AND ps.id = ms.sumber_id
       LEFT JOIN transfer_saldo ts ON ms.sumber_tipe = 'penyesuaian' AND ms.kategori = 'transfer_internal' AND ts.id = ms.sumber_id
      WHERE ks.tanggal >= ? AND ks.tanggal <= ?
        AND ms.nama_akun NOT IN ('Saldo Akun', 'Total Saldo', 'Laba')
      ORDER BY ks.tanggal, ms.id`,
    startD, endD
  );

  const jenisMap = new Map();
  const akunMap = new Map();
  const detail = [];
  let totalMasuk = 0;
  let totalKeluar = 0;
  for (const r of rows) {
    const jumlah = Number(r.jumlah);
    const jenis = jenisMutasi(r);
    if (!jenisMap.has(jenis)) jenisMap.set(jenis, { jenis, masuk: 0, keluar: 0, net: 0 });
    const j = jenisMap.get(jenis);
    if (jumlah > 0) { j.masuk += jumlah; totalMasuk += jumlah; } else { j.keluar += jumlah; totalKeluar += jumlah; }
    j.net += jumlah;

    if (!akunMap.has(r.nama_akun)) akunMap.set(r.nama_akun, { nama_akun: r.nama_akun, masuk: 0, keluar: 0, net: 0 });
    const a = akunMap.get(r.nama_akun);
    if (jumlah > 0) a.masuk += jumlah; else a.keluar += jumlah;
    a.net += jumlah;

    let ref = '';
    if (r.kode_transaksi) ref = r.kode_transaksi;
    else if (r.pengeluaran_deskripsi) ref = r.pengeluaran_deskripsi;
    else if (r.dari_akun || r.ke_akun) ref = `${r.dari_akun || '?'} → ${r.ke_akun || '?'}`;
    else if (r.beli_catatan) ref = r.beli_catatan;
    detail.push({ id: r.id, tanggal: r.tanggal, jenis, referensi: ref, nama_akun: r.nama_akun, jumlah });
  }

  return {
    periode: bulan,
    per_jenis: [...jenisMap.values()],
    per_akun: [...akunMap.values()],
    total_masuk: totalMasuk,
    total_keluar: totalKeluar,
    net: totalMasuk + totalKeluar,
    detail,
  };
}

export async function exportLaporan(db, request, ctx) {
  const url = new URL(request.url);
  const cakupan = url.searchParams.get('cakupan'); // bulan | tahun
  const bulan = url.searchParams.get('bulan');
  const tahun = url.searchParams.get('tahun');
  let range;
  let label;
  let startD;
  let endD;
  if (cakupan === 'bulan') {
    range = monthRange(bulan || currentBulanWib());
    label = `${range.tahun}-${String(range.mon).padStart(2, '0')}`;
    startD = `${range.tahun}-${String(range.mon).padStart(2, '0')}-01`;
    endD = lastDayDate(range.tahun, range.mon);
  } else if (cakupan === 'tahun') {
    range = yearRange(tahun || String(new Date().getUTCFullYear()));
    label = String(range.tahun);
    startD = `${range.tahun}-01-01`;
    endD = `${range.tahun}-12-31`;
  } else {
    throw err(400, 'invalid_filter', 'cakupan harus bulan atau tahun');
  }

  const trans = await db.many(
    `SELECT t.kode_transaksi, t.tanggal_transaksi, t.created_at, t.metode_bayar, t.konfirmasi_pembayaran,
            t.total, t.laba, t.manual_entry, COALESCE(p.nama, '') AS pelanggan
       FROM transaksi t LEFT JOIN pelanggan p ON p.id = t.pelanggan_id
      WHERE t.deleted_at IS NULL AND t.tanggal_transaksi >= ? AND t.tanggal_transaksi <= ? ORDER BY t.tanggal_transaksi, t.id`,
    startD, endD
  );
  const pend = await db.many(
    'SELECT tanggal, deskripsi, kategori, nominal, metode_bayar, akun_sumber FROM pengeluaran WHERE deleted_at IS NULL AND tanggal >= ? AND tanggal <= ? ORDER BY tanggal',
    startD, endD
  );
  const beli = await db.many(
    `SELECT ps.tanggal, ps.catatan, ps.akun_sumber, ps.total, u.nama AS oleh
       FROM pembelian_stok ps LEFT JOIN users u ON u.id = ps.dibuat_oleh
      WHERE ps.deleted_at IS NULL AND ps.tanggal >= ? AND ps.tanggal <= ? ORDER BY ps.tanggal, ps.id`,
    startD, endD
  );
  const transfer = await db.many(
    `SELECT tanggal, dari_akun, ke_akun, nominal, catatan FROM transfer_saldo
      WHERE deleted_at IS NULL AND tanggal >= ? AND tanggal <= ? ORDER BY tanggal, id`,
    startD, endD
  );

  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [];
  lines.push(['JENIS', 'ID', 'TANGGAL/WAKTU', 'PELANGGAN/DESKRIPSI', 'METODE', 'NOMINAL', 'LABA', 'CATATAN/EKSTRA'].join(','));
  for (const t of trans) {
    lines.push(['TRANSAKSI', t.kode_transaksi, t.tanggal_transaksi, t.pelanggan, t.metode_bayar, t.total, t.laba, `${t.manual_entry ? 'manual' : ''} ${t.konfirmasi_pembayaran}`].map(esc).join(','));
  }
  for (const p of pend) {
    lines.push(['PENGELUARAN', '', p.tanggal, p.deskripsi, `${p.metode_bayar}:${p.akun_sumber}`, p.nominal, '', p.kategori || ''].map(esc).join(','));
  }
  for (const p of beli) {
    lines.push(['BELI_STOK', '', p.tanggal, p.catatan || 'Beli stok', `sumber:${p.akun_sumber}`, p.total, '', p.oleh || ''].map(esc).join(','));
  }
  for (const p of transfer) {
    lines.push(['TRANSFER_SALDO', '', p.tanggal, `${p.dari_akun} → ${p.ke_akun}`, 'internal', p.nominal, '', p.catatan || ''].map(esc).join(','));
  }
  const csv = '\uFEFF' + lines.join('\n');

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="irkop-laporan-${label}.csv"`,
    },
  });
}

export async function rekapPerAkun(db, request, ctx) {
  const url = new URL(request.url);
  const bulan = url.searchParams.get('bulan') || currentBulanWib();
  const mr = monthRange(bulan);
  const startD = mr.startDate;
  const endD = mr.endDate;

  const rows = await db.many(
    `SELECT ms.nama_akun AS nama_akun, SUM(ms.jumlah) AS total
       FROM mutasi_saldo ms
       JOIN transaksi t ON t.id = ms.sumber_id AND ms.sumber_tipe = 'transaksi'
      WHERE t.deleted_at IS NULL AND t.tanggal_transaksi >= ? AND t.tanggal_transaksi <= ?
      GROUP BY ms.nama_akun`,
    startD, endD
  );
  const perAkun = {};
  for (const r of rows) perAkun[r.nama_akun] = Number(r.total);

  const IGNORE = ['Tunai Laci', 'Saldo Akun', 'Laba'];
  const tunai = perAkun['Tunai Laci'] || 0;
  const saldoAkun = perAkun['Saldo Akun'] || 0;
  const labaAkun = perAkun['Laba'] || 0;
  const transfer = Object.entries(perAkun)
    .filter(([k]) => !IGNORE.includes(k))
    .reduce((s, [, v]) => s + v, 0);

  const adminRow = await db.one(
    `SELECT COALESCE(SUM(ms.jumlah), 0) AS a
       FROM mutasi_saldo ms
       JOIN transaksi t ON t.id = ms.sumber_id AND ms.sumber_tipe = 'transaksi'
      WHERE ms.kategori = 'pendapatan_admin' AND t.deleted_at IS NULL
        AND t.tanggal_transaksi >= ? AND t.tanggal_transaksi <= ?`,
    startD, endD
  );
  const labaCol = await db.one(
    'SELECT COALESCE(SUM(laba), 0) AS l FROM transaksi WHERE deleted_at IS NULL AND tanggal_transaksi >= ? AND tanggal_transaksi <= ?',
    startD, endD
  );

  return {
    periode: bulan,
    tunai,
    saldo_akun: saldoAkun,
    transfer,
    admin: Number(adminRow.a),
    laba: Number(labaCol.l),
    per_akun: perAkun,
  };
}

function currentBulanWib() {
  const d = new Date(new Date().getTime() + 7 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function lastDayDate(tahun, mon) {
  return `${tahun}-${String(mon).padStart(2, '0')}-${String(new Date(Date.UTC(tahun, mon, 0)).getUTCDate()).padStart(2, '0')}`;
}

function prevMonth(tahun, mon) {
  if (mon === 1) return { tahun: tahun - 1, mon: 12 };
  return { tahun, mon: mon - 1 };
}