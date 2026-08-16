import { err } from '../lib/errors.js';
import { wibDateToUtcRange, isValidCalendarDate } from '../lib/time.js';

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
    `SELECT COUNT(*) AS jumlah, COALESCE(SUM(total), 0) AS omzet, COALESCE(SUM(laba), 0) AS laba
       FROM transaksi WHERE deleted_at IS NULL AND tanggal_transaksi >= ? AND tanggal_transaksi <= ?`,
    startD, endD
  );
  const laba = scalarSum([tx], 'laba');

  const kategori = await db.many(
    `SELECT k.id AS kategori_id, COALESCE(k.nama, 'Tanpa Kategori') AS nama_kategori,
            COUNT(*) AS jumlah_item, SUM(ti.qty) AS qty, SUM(ti.subtotal) AS omzet
       FROM transaksi t
       JOIN transaksi_item ti ON ti.transaksi_id = t.id
       LEFT JOIN produk p ON p.id = ti.produk_id
       LEFT JOIN kategori_produk k ON k.id = p.kategori_id
      WHERE t.deleted_at IS NULL AND t.tanggal_transaksi >= ? AND t.tanggal_transaksi <= ?
      GROUP BY k.id, k.nama ORDER BY omzet DESC`,
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
    `SELECT COALESCE(SUM(total), 0) AS omzet, COALESCE(SUM(laba), 0) AS laba
       FROM transaksi WHERE deleted_at IS NULL AND tanggal_transaksi >= ? AND tanggal_transaksi <= ?`,
    `${prev.tahun}-${String(prev.mon).padStart(2, '0')}-01`,
    lastDayDate(prev.tahun, prev.mon)
  );
  const prevPend = await db.one(
    "SELECT COALESCE(SUM(nominal), 0) AS total FROM pengeluaran WHERE deleted_at IS NULL AND tanggal >= ? AND tanggal <= ?",
    `${prev.tahun}-${String(prev.mon).padStart(2, '0')}-01`,
    lastDayDate(prev.tahun, prev.mon)
  );

  return {
    periode: 'bulanan',
    bulan: `${range.tahun}-${String(range.mon).padStart(2, '0')}`,
    jumlah_transaksi: scalarSum([tx], 'jumlah'),
    omzet: scalarSum([tx], 'omzet'),
    laba,
    rekap_kategori: kategori,
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
      omzet: scalarSum([prevTx], 'omzet'),
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
    `SELECT COUNT(*) AS jumlah, COALESCE(SUM(total), 0) AS omzet, COALESCE(SUM(laba), 0) AS laba
       FROM transaksi WHERE deleted_at IS NULL AND tanggal_transaksi >= ? AND tanggal_transaksi <= ?`,
    `${tahun}-01-01`, `${tahun}-12-31`
  );
  const laba = scalarSum([tx], 'laba');

  const kategori = await db.many(
    `SELECT k.id AS kategori_id, COALESCE(k.nama, 'Tanpa Kategori') AS nama_kategori,
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
      `SELECT COUNT(*) AS jumlah, COALESCE(SUM(total), 0) AS omzet, COALESCE(SUM(laba), 0) AS laba
         FROM transaksi WHERE deleted_at IS NULL AND tanggal_transaksi >= ? AND tanggal_transaksi <= ?`,
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
      omzet: scalarSum([mt], 'omzet'),
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
    omzet: scalarSum([tx], 'omzet'),
    laba,
    pengeluaran: { jumlah: scalarSum([pengeluaran], 'jumlah'), total: pengeluaranTotal },
    net: laba - pengeluaranTotal,
    breakdown_12_bulan: breakdown12,
    ranking_kategori_terlaris: kategori,
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