// Halaman Laporan (PRD 5.4): periode BULANAN & TAHUNAN saja (tanpa harian).
//
// Sumber data = API Contract Team 1:
//   GET /api/laporan/bulan?bulan=YYYY-MM
//   GET /api/laporan/tahun?tahun=YYYY
//   GET /api/laporan/export?cakupan=bulan|tahun&bulan=&tahun=  → CSV (Excel-compatible)
// Export PDF dibuat sisi klien via browser print (per kontrak: backend hanya CSV).
// Frontend TIDAK menghitung omzet/laba/net; hanya menampilkan nilai resmi backend.
import { useEffect, useState } from 'react';
import { api, downloadFile } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useSiteName } from '../hooks/useSiteName';
import { todayWIB, formatRupiah, formatSignedRupiah } from '../lib/format';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Field, Input, Select } from '../components/ui/Field';
import { Table } from '../components/ui/Table';
import { Loader, ErrorState, EmptyState } from '../components/ui/States';
import { Modal } from '../components/ui/Modal';
import { Icon } from '../components/ui/Icon';
import TransaksiForm from '../components/transaksi/TransaksiForm';

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function monthName(ym) {
  if (!ym) return '-';
  const s = String(ym).trim();
  const m = /^\d{4}-\d{2}$/.test(s) ? Number(s.split('-')[1]) : /^\d{1,2}$/.test(s) ? Number(s) : null;
  if (m === null || m < 1 || m > 12) return ym || '-';
  const y = /^\d{4}-\d{2}$/.test(s) ? s.split('-')[0] : null;
  return `${MONTH_NAMES[m - 1]}${y ? ' ' + y : ''}`;
}

function deltaPct(before, after) {
  if (!before) return null;
  return ((after - before) / before) * 100;
}

function deltaPctText(delta) {
  if (delta === null || delta === undefined) return '-';
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
}

function openPrint(title, html, siteName = 'Iirkop Cell') {
  const style = [
    'body{font-family:system-ui,sans-serif;margin:24px;color:#111}',
    'h1{font-size:18px;margin:0 0 4px}',
    'p.meta{color:#555;font-size:12px;margin:0 0 16px}',
    'table{width:100%;border-collapse:collapse;font-size:12px}',
    'th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}',
    'th{background:#f2f2f2}',
    '.r{text-align:right}',
    '.sum td{font-weight:700;background:#f7f7f7}',
    'h2{font-size:14px;margin:20px 0 8px}',
  ].join('\n');
  const w = window.open('', '_blank', 'width=900,height=650');
  if (!w) return false;
  const meta = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  w.document.write(
    '<!doctype html><html><head><meta charset="utf-8"><title>' + title + '</title><style>' + style + '</style></head>' +
      '<body><h1>' + title + '</h1><p class="meta">' + siteName + ' — ' + title +
      ' · dicetak ' + meta + ' WIB · data sumber: backend</p>' + html + '</body></html>'
  );
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
  return true;
}

export default function LaporanPage() {
  const toast = useToast();
  const today = todayWIB();
  const [period, setPeriod] = useState('bulanan'); // bulanan | tahunan
  const [year, setYear] = useState(today.slice(0, 4));
  const [month, setMonth] = useState(today.slice(5, 7));
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [produk, setProduk] = useState({ status: 'loading', items: [], error: null });
  const [nilaiStok, setNilaiStok] = useState({ status: 'loading', data: null, error: null });
  const [rekon, setRekon] = useState({ status: 'idle', data: null, error: null });
  const [bukuKas, setBukuKas] = useState({ status: 'idle', data: null, error: null });
  const siteName = useSiteName();

  const isBulanan = period === 'bulanan';
  const periodeLabel = isBulanan ? monthName(year + '-' + month) : String(year);
  const bulanParam = year + '-' + month;

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setData(null);
    setError(null);
    const params = isBulanan ? { bulan: bulanParam } : { tahun: year };
    api
      .get(isBulanan ? '/laporan/bulan' : '/laporan/tahun', params)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setStatus('success');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err);
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [period, year, month, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setProduk({ status: 'loading', items: [], error: null });
    const params = isBulanan ? { bulan: bulanParam } : { tahun: year };
    api
      .get('/laporan/produk-terlaris', { ...params, limit: 50 })
      .then((res) => {
        if (!cancelled) setProduk({ status: 'success', items: res.items || [], error: null });
      })
      .catch((err) => {
        if (!cancelled) setProduk({ status: 'error', items: [], error: err });
      });
    return () => {
      cancelled = true;
    };
  }, [period, year, month, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setNilaiStok((s) => ({ ...s, status: 'loading' }));
    api
      .get('/laporan/nilai-stok')
      .then((res) => { if (!cancelled) setNilaiStok({ status: 'success', data: res, error: null }); })
      .catch((err) => { if (!cancelled) setNilaiStok({ status: 'error', data: null, error: err }); });
    return () => { cancelled = true; };
  }, [refresh]);

  useEffect(() => {
    if (!isBulanan) return undefined;
    let cancelled = false;
    setRekon({ status: 'loading', data: null, error: null });
    api
      .get('/laporan/rekonsiliasi', { bulan: bulanParam })
      .then((res) => { if (!cancelled) setRekon({ status: 'success', data: res, error: null }); })
      .catch((err) => { if (!cancelled) setRekon({ status: 'error', data: null, error: err }); });
    return () => { cancelled = true; };
  }, [period, year, month, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isBulanan) return undefined;
    let cancelled = false;
    setBukuKas({ status: 'loading', data: null, error: null });
    api
      .get('/laporan/buku-kas', { bulan: bulanParam })
      .then((res) => { if (!cancelled) setBukuKas({ status: 'success', data: res, error: null }); })
      .catch((err) => { if (!cancelled) setBukuKas({ status: 'error', data: null, error: err }); });
    return () => { cancelled = true; };
  }, [period, year, month, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCsv() {
    try {
      const filename = 'irkop-laporan-' + period + '-' + (isBulanan ? bulanParam : year) + '.csv';
      await downloadFile('/laporan/export', { cakupan: isBulanan ? 'bulan' : 'tahun', bulan: bulanParam, tahun: year }, filename);
      toast.success('Export CSV berhasil diunduh.');
    } catch (err) {
      toast.error(err && err.message ? err.message : 'Gagal mengekspor CSV.');
    }
  }

  function handlePdf() {
    const per = data && data.periode;
    let html = '';
    let title = '';
    if (per === 'bulanan') {
      title = 'Bulanan ' + monthName(data.bulan);
      html = buildPrintHtml(data, false);
    } else if (per === 'tahunan') {
      title = 'Tahunan ' + data.tahun;
      html = buildPrintHtml(data, true);
    }
    if (!html) {
      toast.error('Data laporan belum tersedia untuk dicetak.');
      return;
    }
    if (!openPrint(title, html, siteName)) {
      toast.error('Popup diblokir browser. Izinkan popup lalu coba lagi.');
    }
  }

  function buildPrintHtml(r, annual) {
    const cells = [
      ['Jumlah Transaksi', String(r.jumlah_transaksi || 0)],
      ['Omzet', formatRupiah(r.omzet || 0)],
      ['Laba', formatRupiah(r.laba || 0)],
      ['Pengeluaran', formatRupiah((r.pengeluaran && r.pengeluaran.total) || 0)],
      ['Net (Laba − Pengeluaran)', formatRupiah(r.net || 0)],
    ];
    let html = '<h2>Ringkasan</h2><table><thead><tr><th>Komponen</th><th class="r">Nilai</th></tr></thead><tbody>';
    for (const c of cells) html += '<tr><td>' + c[0] + '</td><td class="r">' + c[1] + '</td></tr>';
    html += '</tbody></table>';

    const saldoAkun = r.saldo_akun || [];
    if (saldoAkun.length) {
      html += '<h2>Saldo Akun</h2><table><thead><tr><th>Akun</th><th class="r">Saldo Awal</th><th class="r">Saldo Akhir</th></tr></thead><tbody>';
      for (const a of saldoAkun) {
        html += '<tr><td>' + a.nama_akun + '</td><td class="r">' + formatRupiah(a.saldo_awal || 0) + '</td><td class="r">' + formatRupiah(a.saldo_akhir || 0) + '</td></tr>';
      }
      html += '<tr class="sum"><td>Total uang</td><td class="r">' + formatRupiah(r.total_saldo_awal || 0) + '</td><td class="r">' + formatRupiah(r.total_saldo_akhir || 0) + '</td></tr>';
      html += '</tbody></table>';
    }

    const kategori = r.rekap_kategori || [];
    if (kategori.length) {
      html += '<h2>Rekap Kategori</h2><table><thead><tr><th>Kategori</th><th>Jumlah Item</th><th>Qty</th><th class="r">Omzet</th></tr></thead><tbody>';
      for (const k of kategori) {
        html += '<tr><td>' + k.nama_kategori + '</td><td>' + (k.jumlah_item || 0) + '</td><td>' + (k.qty || 0) + '</td><td class="r">' + formatRupiah(k.omzet || 0) + '</td></tr>';
      }
      html += '</tbody></table>';
    }

    const harian = r.rincian_harian || [];
    if (harian.length) {
      html += '<h2>Rincian Harian</h2><table><thead><tr><th>Tanggal</th><th>Trx</th><th class="r">Omzet</th><th class="r">Laba</th><th class="r">Pengeluaran</th><th class="r">Beli Stok</th><th class="r">Net</th></tr></thead><tbody>';
      for (const h of harian) {
        html += '<tr><td>' + h.tanggal + '</td><td>' + (h.jumlah_transaksi || 0) + '</td><td class="r">' + formatRupiah(h.omzet || 0) + '</td><td class="r">' + formatRupiah(h.laba || 0) + '</td><td class="r">' + formatRupiah(h.pengeluaran || 0) + '</td><td class="r">' + formatRupiah(h.beli_stok || 0) + '</td><td class="r">' + formatRupiah(h.net || 0) + '</td></tr>';
      }
      html += '</tbody></table>';
    }

    if (r.arus_dana) {
      html += '<h2>Arus Dana (bukan omzet)</h2><table><thead><tr><th>Jenis</th><th class="r">Nominal</th></tr></thead><tbody>';
      html += '<tr><td>Kirim uang (nominal titipan)</td><td class="r">' + formatRupiah(r.arus_dana.kirim_uang || 0) + '</td></tr>';
      html += '<tr><td>Tarik tunai</td><td class="r">' + formatRupiah(r.arus_dana.tarik_tunai || 0) + '</td></tr>';
      html += '<tr><td>Transfer</td><td class="r">' + formatRupiah(r.arus_dana.transfer || 0) + '</td></tr>';
      html += '<tr class="sum"><td>Total Arus Dana</td><td class="r">' + formatRupiah(r.arus_dana.total || 0) + '</td></tr>';
      html += '<tr><td>Pendapatan admin (fee)</td><td class="r">' + formatRupiah(r.pendapatan_admin || 0) + '</td></tr>';
      html += '</tbody></table>';
    }

    if (!annual) {
      const kasbon = r.kasbon || {};
      html += '<h2>Kasbon</h2><table><tbody>';
      html += '<tr><td>Kasbon Baru</td><td>' + (kasbon.baru || 0) + '</td><td class="r">' + formatRupiah(kasbon.nominal_baru || 0) + '</td></tr>';
      html += '<tr><td>Belum Lunas</td><td>' + (kasbon.belum_lunas || 0) + '</td><td class="r">' + formatRupiah(kasbon.nominal_belum_lunas || 0) + '</td></tr>';
      html += '</tbody></table>';
      const perb = r.perbandingan_bulan_sebelumnya;
      if (perb && perb.bulan) {
        html += '<h2>Perbandingan Bulan Sebelumnya (' + monthName(perb.bulan) + ')</h2><table><tbody>';
        html += '<tr><td>Omzet</td><td class="r">' + formatRupiah(perb.omzet || 0) + '</td></tr>';
        html += '<tr><td>Laba</td><td class="r">' + formatRupiah(perb.laba || 0) + '</td></tr>';
        html += '<tr><td>Pengeluaran</td><td class="r">' + formatRupiah(perb.pengeluaran || 0) + '</td></tr>';
        html += '</tbody></table>';
      }
    } else {
      const rank = r.ranking_kategori_terlaris || [];
      if (rank.length) {
        html += '<h2>Ranking Kategori Terlaris</h2><table><thead><tr><th>Kategori</th><th>Qty</th><th class="r">Omzet</th></tr></thead><tbody>';
        for (const c of rank) {
          html += '<tr><td>' + c.nama_kategori + '</td><td>' + (c.qty || 0) + '</td><td class="r">' + formatRupiah(c.omzet || 0) + '</td></tr>';
        }
        html += '</tbody></table>';
      }
    }
    const pl = produk.items || [];
    if (pl.length) {
      html += '<h2>Produk Terlaris</h2><table><thead><tr><th>#</th><th>Produk</th><th>Kategori</th><th>Qty</th><th class="r">Omzet</th><th class="r">Laba</th></tr></thead><tbody>';
      for (const p of pl) {
        html += '<tr><td>' + p.peringkat + '</td><td>' + p.nama_produk + '</td><td>' + p.nama_kategori + '</td><td>' + p.qty + '</td><td class="r">' + formatRupiah(p.omzet || 0) + '</td><td class="r">' + formatRupiah(p.laba || 0) + '</td></tr>';
      }
      html += '</tbody></table>';
    }

    const bkd = bukuKas.data;
    if (bkd && bkd.per_jenis?.length) {
      html += '<h2>Buku Kas (semua pergerakan)</h2><table><thead><tr><th>Jenis</th><th class="r">Masuk</th><th class="r">Keluar</th><th class="r">Net</th></tr></thead><tbody>';
      for (const j of bkd.per_jenis) {
        html += '<tr><td>' + j.jenis + '</td><td class="r">' + formatRupiah(j.masuk) + '</td><td class="r">' + formatRupiah(j.keluar) + '</td><td class="r">' + formatRupiah(j.net) + '</td></tr>';
      }
      html += '</tbody></table>';
    }
    return html;
  }

  const stats = data
    ? [
        { label: 'Jumlah Transaksi', value: String(data.jumlah_transaksi || 0) },
        { label: 'Omzet', value: formatRupiah(data.omzet || 0) },
        { label: 'Laba', value: formatRupiah(data.laba || 0) },
        { label: 'Pengeluaran', value: formatRupiah((data.pengeluaran && data.pengeluaran.total) || 0) },
        { label: 'Net (Laba − Pengeluaran)', value: formatRupiah(data.net || 0) },
      ]
    : [];

  const kategoriRows = (data && data.rekap_kategori || []).map((k, i) => ({
    key: k.kategori_id || i,
    nama: k.nama_kategori,
    jumlah_item: k.jumlah_item || 0,
    qty: k.qty || 0,
    omzet: k.omzet || 0,
  }));

  const harianRows = (data && data.rincian_harian || []).map((h) => ({ ...h, key: h.tanggal }));

  const kasbon = (data && data.kasbon) || {};
  const kasbonRows = [
    { label: 'Kasbon Baru', qty: kasbon.baru || 0, nominal: kasbon.nominal_baru || 0 },
    { label: 'Belum Lunas', qty: kasbon.belum_lunas || 0, nominal: kasbon.nominal_belum_lunas || 0 },
    { label: 'Lunas', qty: kasbon.lunas || 0, nominal: null },
  ];

  const perb = data && data.perbandingan_bulan_sebelumnya;
  const perbRows = [
    { key: 'omzet', label: 'Omzet', value: (perb && perb.omzet) || 0, delta: deltaPct(perb && perb.omzet, data && data.omzet) },
    { key: 'laba', label: 'Laba', value: (perb && perb.laba) || 0, delta: deltaPct(perb && perb.laba, data && data.laba) },
    {
      key: 'pengeluaran',
      label: 'Pengeluaran',
      value: (perb && perb.pengeluaran) || 0,
      delta: deltaPct(perb && perb.pengeluaran, data && data.pengeluaran && data.pengeluaran.total),
    },
  ];

  const breakdownRows = (data && data.breakdown_12_bulan || []).map((b) => ({
    key: b.bulan,
    bulan: monthName(b.bulan),
    jumlah: b.jumlah_transaksi || 0,
    omzet: b.omzet || 0,
    laba: b.laba || 0,
    pengeluaran: b.pengeluaran || 0,
    net: b.net || 0,
  }));

  const rankRows = (data && data.ranking_kategori_terlaris || []).map((c, i) => ({
    key: (c.kategori_id || i) + '-' + c.nama_kategori,
    nama: c.nama_kategori,
    qty: c.qty || 0,
    omzet: c.omzet || 0,
  }));

  const produkRows = (produk.items || []).map((p) => ({
    ...p,
    key: String(p.produk_id ?? 'svc') + '-' + p.nama_produk,
  }));

  const stokTotal = nilaiStok.data?.total;
  const nilaiStokRows = (nilaiStok.data?.per_kategori || []).map((g) => ({ ...g, key: g.nama_kategori }));
  if (stokTotal) {
    nilaiStokRows.push({
      key: '__total',
      nama_kategori: 'TOTAL',
      qty: stokTotal.qty,
      nilai_modal: stokTotal.nilai_modal,
      nilai_jual: stokTotal.nilai_jual,
      potensi_laba: stokTotal.potensi_laba,
    });
  }

  const bk = bukuKas.data;
  const bukuJenisRows = (bk?.per_jenis || []).map((j) => ({ ...j, key: j.jenis }));
  const bukuAkunRows = (bk?.per_akun || []).map((a) => ({ ...a, key: a.nama_akun }));

  const rk = rekon.data;
  const rekonRows = rk
    ? [
        { key: 'laba', label: 'Laba', value: rk.laba },
        { key: 'peng', label: 'Pengeluaran operasional', value: -rk.pengeluaran_operasional },
        { key: 'stok', label: 'Δ Stok (beli − COGS)', value: -rk.delta_stok },
        { key: 'piutang', label: 'Δ Piutang (kasbon)', value: -rk.delta_piutang },
        { key: 'expected', label: 'Δ Uang seharusnya', value: rk.delta_uang_seharusnya, bold: true },
        { key: 'actual', label: 'Δ Uang aktual (mutasi)', value: rk.delta_uang_aktual, bold: true },
      ]
    : [];

  const hasContent = data && (data.jumlah_transaksi || data.omzet || data.pengeluaran || data.net);

  return (
    <div className="page">
      <PageHeader
        title="Laporan"
        subtitle="Periode Bulanan dan Tahunan. Filter Harian tidak tersedia (di luar scope PRD 5.4). Nilai finansial dari backend."
      />

      <div className="filter-bar">
        <div className="flex gap-2" style={{ alignItems: 'flex-end', flexBasis: '100%' }}>
          <button type="button" className={'tab ' + (isBulanan ? 'active' : '')} onClick={() => setPeriod('bulanan')}>Bulanan</button>
          <button type="button" className={'tab ' + (!isBulanan ? 'active' : '')} onClick={() => setPeriod('tahunan')}>Tahunan</button>
        </div>
        <Field label="Tahun">
          <Input type="number" min="2020" max="2100" value={year} onChange={(e) => setYear(e.target.value)} />
        </Field>
        {isBulanan && (
          <Field label="Bulan">
            <Select value={month} onChange={(e) => setMonth(e.target.value)}>
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                <option key={m} value={m}>
                  {MONTH_NAMES[Number(m) - 1]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="filter-actions">
          <Button variant="secondary" onClick={handlePdf} disabled={status !== 'success'}>
            <Icon name="printer" size={15} /> Cetak / PDF
          </Button>
          <Button variant="secondary" onClick={handleCsv} disabled={status !== 'success'}>
            <Icon name="download" size={15} /> Export Excel (CSV)
          </Button>
        </div>
      </div>

      {status === 'loading' && <Loader label={'Memuat laporan ' + periodeLabel + '...'} />}

      {status === 'error' && (
        <ErrorState
          error={error}
          onRetry={() => {
            setStatus('loading');
            setError(null);
          }}
        />
      )}

      {status === 'success' && data && !hasContent && (
        <Card>
          <EmptyState
            title={'Belum ada data untuk ' + periodeLabel}
            description="Belum ada transaksi atau pengeluaran pada periode ini."
            icon="laporan"
          />
        </Card>
      )}

      {status === 'success' && data && hasContent && (
        <>
          <div className="stat-grid mt-4">
            {stats.map((s) => (
              <div key={s.label} className="stat-card">
                <div className="stat-label">{s.label}</div>
                <div className="stat-value">{s.value}</div>
              </div>
            ))}
          </div>

          {isBulanan && (
            <>
              <Card className="mt-4" title="Rekap Kategori" subtitle="Snapshot transaksi_item periode ini">
                <Table
                  columns={[
                    { key: 'nama', header: 'Kategori' },
                    { key: 'jumlah_item', header: 'Jumlah Item', align: 'right', render: (r) => <span className="num">{r.jumlah_item}</span> },
                    { key: 'qty', header: 'Qty', align: 'right', render: (r) => <span className="num">{r.qty}</span> },
                    { key: 'omzet', header: 'Omzet', align: 'right', render: (r) => <span className="num">{formatRupiah(r.omzet)}</span> },
                  ]}
                  rows={kategoriRows}
                  empty={<EmptyState title="Belum ada item terjual di periode ini" icon="barang" />}
                />
              </Card>

              <Card className="mt-4" title="Rincian Harian">
                <Table
                  columns={[
                    { key: 'tanggal', header: 'Tanggal', render: (r) => <span className="text-sm">{r.tanggal}</span> },
                    { key: 'jumlah_transaksi', header: 'Trx', align: 'right', render: (r) => <span className="num">{r.jumlah_transaksi}</span> },
                    { key: 'omzet', header: 'Omzet', align: 'right', render: (r) => <span className="num">{formatRupiah(r.omzet)}</span> },
                    { key: 'laba', header: 'Laba', align: 'right', render: (r) => <span className="num">{formatRupiah(r.laba)}</span> },
                    { key: 'pengeluaran', header: 'Pengeluaran', align: 'right', render: (r) => <span className="num text-danger">{formatRupiah(r.pengeluaran)}</span> },
                    { key: 'beli_stok', header: 'Beli Stok', align: 'right', render: (r) => <span className="num text-muted">{formatRupiah(r.beli_stok)}</span> },
                    { key: 'net', header: 'Net', align: 'right', render: (r) => <span className="num">{formatSignedRupiah(r.net)}</span> },
                  ]}
                  rows={harianRows}
                  empty={<EmptyState title="Belum ada pergerakan harian" icon="laporan" />}
                />
              </Card>

              <Card className="mt-4" title="Arus Dana (bukan omzet)">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr><th>Jenis</th><th className="col-right">Nominal</th></tr>
                    </thead>
                    <tbody>
                      <tr><td>Kirim uang (nominal titipan)</td><td className="col-right num">{formatRupiah(data.arus_dana?.kirim_uang || 0)}</td></tr>
                      <tr><td>Tarik tunai</td><td className="col-right num">{formatRupiah(data.arus_dana?.tarik_tunai || 0)}</td></tr>
                      <tr><td>Transfer</td><td className="col-right num">{formatRupiah(data.arus_dana?.transfer || 0)}</td></tr>
                      <tr><td style={{ fontWeight: 700 }}>Total Arus Dana</td><td className="col-right num" style={{ fontWeight: 700 }}>{formatRupiah(data.arus_dana?.total || 0)}</td></tr>
                      <tr><td>Pendapatan admin (fee)</td><td className="col-right num">{formatRupiah(data.pendapatan_admin || 0)}</td></tr>
                    </tbody>
                  </table>
                </div>
                <p className="field-hint mt-2">Nominal titipan (kirim uang/tarik/transfer) bukan pendapatan, jadi tidak dihitung Omzet.</p>
              </Card>

              <Card className="mt-4" title="Saldo Akun (awal → akhir bulan)">
                <Table
                  columns={[
                    { key: 'nama_akun', header: 'Akun', render: (r) => <span style={{ fontWeight: 600 }}>{r.nama_akun}</span> },
                    { key: 'saldo_awal', header: 'Saldo Awal', align: 'right', render: (r) => <span className="num">{formatRupiah(r.saldo_awal)}</span> },
                    { key: 'saldo_akhir', header: 'Saldo Akhir', align: 'right', render: (r) => <span className="num font-bold">{formatRupiah(r.saldo_akhir)}</span> },
                  ]}
                  rows={(data.saldo_akun || []).map((a) => ({ ...a, key: a.nama_akun }))}
                  empty={<EmptyState title="Belum ada saldo" icon="akun" />}
                />
                <div className="flex justify-between mt-3 text-sm">
                  <span className="text-secondary">Total uang awal</span>
                  <b className="num">{formatRupiah(data.total_saldo_awal || 0)}</b>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-secondary">Total uang akhir</span>
                  <b className="num">{formatRupiah(data.total_saldo_akhir || 0)}</b>
                </div>
              </Card>

              <div className="grid-2 mt-4">
                <Card title="Kasbon" subtitle="Ringkasan kasbon periode ini">
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr><th>Status</th><th className="col-right">Jumlah</th><th className="col-right">Nominal</th></tr>
                      </thead>
                      <tbody>
                        {kasbonRows.map((r) => (
                          <tr key={r.label}>
                            <td>{r.label}</td>
                            <td className="col-right num">{r.qty}</td>
                            <td className="col-right num">{r.nominal === null ? '-' : formatRupiah(r.nominal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Card title="Perbandingan Bulan Sebelumnya" subtitle={perb ? monthName(perb.bulan) : 'Tidak ada data'}>
                  {perb && perb.bulan ? (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr><th>Komponen</th><th className="col-right">Bulan Lalu</th><th className="col-right">Perubahan</th></tr>
                        </thead>
                        <tbody>
                          {perbRows.map((r) => (
                            <tr key={r.key}>
                              <td>{r.label}</td>
                              <td className="col-right num">{formatRupiah(r.value)}</td>
                              <td className="col-right num">{deltaPctText(r.delta)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <EmptyState title="Belum ada perbandingan" description="Tidak ada data bulan sebelumnya untuk dibandingkan." icon="clock" />
                  )}
                </Card>
              </div>
            </>
          )}

          {!isBulanan && (
            <>
              <Card className="mt-4" title="Breakdown 12 Bulan" subtitle={'Perbandingan per bulan pada ' + data.tahun}>
                <Table
                  columns={[
                    { key: 'bulan', header: 'Bulan' },
                    { key: 'jumlah', header: 'Transaksi', align: 'right', render: (r) => <span className="num">{r.jumlah}</span> },
                    { key: 'omzet', header: 'Omzet', align: 'right', render: (r) => <span className="num">{formatRupiah(r.omzet)}</span> },
                    { key: 'laba', header: 'Laba', align: 'right', render: (r) => <span className="num">{formatRupiah(r.laba)}</span> },
                    { key: 'pengeluaran', header: 'Pengeluaran', align: 'right', render: (r) => <span className="num">{formatRupiah(r.pengeluaran)}</span> },
                    { key: 'net', header: 'Net', align: 'right', render: (r) => <span className="num">{formatRupiah(r.net)}</span> },
                  ]}
                  rows={breakdownRows}
                  empty={<EmptyState title="Belum ada data bulanan" description="Belum ada transaksi atau pengeluaran tercatat tahun ini." icon="laporan" />}
                />
              </Card>

              <Card className="mt-4" title="Ranking Kategori Terlaris" subtitle={'Top kategori selama ' + data.tahun}>
                <Table
                  columns={[
                    { key: 'nama', header: 'Kategori' },
                    { key: 'qty', header: 'Qty', align: 'right', render: (r) => <span className="num">{r.qty}</span> },
                    { key: 'omzet', header: 'Omzet', align: 'right', render: (r) => <span className="num">{formatRupiah(r.omzet)}</span> },
                  ]}
                  rows={rankRows}
                  empty={<EmptyState title="Belum ada penjualan tercatat" description="Data akan tampil setelah ada transaksi pada periode ini." icon="barang" />}
                />
              </Card>
            </>
          )}

          <Card className="mt-4" title="Produk Terlaris" subtitle={`Produk paling banyak terjual — ${periodeLabel}`}>
            {produk.status === 'loading' ? (
              <Loader />
            ) : produk.status === 'error' ? (
              <ErrorState error={produk.error} onRetry={() => setRefresh((r) => r + 1)} />
            ) : (
              <Table
                columns={[
                  { key: 'peringkat', header: '#', align: 'right', render: (r) => <span className="num">{r.peringkat}</span> },
                  { key: 'nama_produk', header: 'Produk', render: (r) => <span style={{ fontWeight: 600 }}>{r.nama_produk}</span> },
                  { key: 'nama_kategori', header: 'Kategori', render: (r) => <span className="text-sm text-muted">{r.nama_kategori}</span> },
                  { key: 'qty', header: 'Qty Terjual', align: 'right', render: (r) => <span className="num">{r.qty}</span> },
                  { key: 'jumlah_transaksi', header: 'Transaksi', align: 'right', render: (r) => <span className="num">{r.jumlah_transaksi}</span> },
                  { key: 'omzet', header: 'Omzet', align: 'right', render: (r) => <span className="num">{formatRupiah(r.omzet)}</span> },
                  { key: 'laba', header: 'Laba', align: 'right', render: (r) => <span className="num">{formatRupiah(r.laba)}</span> },
                ]}
                rows={produkRows}
                empty={<EmptyState title="Belum ada produk terjual" description="Data muncul setelah ada transaksi pada periode ini." icon="barang" />}
              />
            )}
          </Card>
        </>
      )}

      {status === 'success' && (
        <Card className="mt-4" title="Nilai Stok (modal & jual)">
          {nilaiStok.status === 'loading' ? (
            <Loader />
          ) : nilaiStok.status === 'error' ? (
            <ErrorState error={nilaiStok.error} onRetry={() => setRefresh((r) => r + 1)} />
          ) : (
            <Table
              columns={[
                { key: 'nama_kategori', header: 'Kategori', render: (r) => <span style={{ fontWeight: r.key === '__total' ? 700 : 600 }}>{r.nama_kategori}</span> },
                { key: 'qty', header: 'Qty', align: 'right', render: (r) => <span className="num" style={{ fontWeight: r.key === '__total' ? 700 : 400 }}>{r.qty}</span> },
                { key: 'nilai_modal', header: 'Nilai Modal', align: 'right', render: (r) => <span className="num" style={{ fontWeight: r.key === '__total' ? 700 : 400 }}>{formatRupiah(r.nilai_modal)}</span> },
                { key: 'nilai_jual', header: 'Nilai Jual', align: 'right', render: (r) => <span className="num" style={{ fontWeight: r.key === '__total' ? 700 : 400 }}>{formatRupiah(r.nilai_jual)}</span> },
                { key: 'potensi_laba', header: 'Potensi Laba', align: 'right', render: (r) => <span className="num" style={{ fontWeight: r.key === '__total' ? 700 : 400 }}>{formatRupiah(r.potensi_laba)}</span> },
              ]}
              rows={nilaiStokRows}
              empty={<EmptyState title="Belum ada stok terlacak" description="Isi stok & aktifkan 'lacak stok' pada kategori." icon="barang" />}
            />
          )}
        </Card>
      )}

      {status === 'success' && isBulanan && (
        <Card className="mt-4" title={`Rekonsiliasi Bulanan — ${monthName(bulanParam)}`}>
          {rekon.status === 'loading' ? (
            <Loader />
          ) : rekon.status === 'error' ? (
            <ErrorState error={rekon.error} onRetry={() => setRefresh((r) => r + 1)} />
          ) : rk ? (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Komponen</th><th className="col-right">Nilai</th></tr>
                  </thead>
                  <tbody>
                    {rekonRows.map((r) => (
                      <tr key={r.key}>
                        <td style={{ fontWeight: r.bold ? 700 : 400 }}>{r.label}</td>
                        <td className="col-right num" style={{ fontWeight: r.bold ? 700 : 400 }}>{formatSignedRupiah(r.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between items-center mt-3">
                <span className="text-sm text-secondary">
                  Selisih (aktual − seharusnya), toleransi {formatRupiah(rk.toleransi)}
                </span>
                <span
                  className="num font-bold"
                  style={{ color: rk.status === 'aman' ? 'var(--success)' : rk.status === 'bahaya' ? 'var(--danger)' : 'var(--warning)' }}
                >
                  {formatSignedRupiah(rk.selisih)} · {rk.status.toUpperCase()}
                </span>
              </div>
            </>
          ) : null}
        </Card>
      )}

      {status === 'success' && isBulanan && (
        <Card className="mt-4" title={`Buku Kas — ${monthName(bulanParam)}`}>
          {bukuKas.status === 'loading' ? (
            <Loader />
          ) : bukuKas.status === 'error' ? (
            <ErrorState error={bukuKas.error} onRetry={() => setRefresh((r) => r + 1)} />
          ) : bk ? (
            <>
              <h4 className="card-title-sm mb-2">Ringkasan per Jenis</h4>
              <Table
                columns={[
                  { key: 'jenis', header: 'Jenis', render: (r) => <span style={{ fontWeight: 600 }}>{r.jenis}</span> },
                  { key: 'masuk', header: 'Masuk', align: 'right', render: (r) => <span className="num text-success">{formatRupiah(r.masuk)}</span> },
                  { key: 'keluar', header: 'Keluar', align: 'right', render: (r) => <span className="num text-danger">{formatRupiah(r.keluar)}</span> },
                  { key: 'net', header: 'Net', align: 'right', render: (r) => <span className="num">{formatSignedRupiah(r.net)}</span> },
                ]}
                rows={bukuJenisRows}
                empty={<EmptyState title="Belum ada pergerakan" icon="laporan" />}
              />
              <h4 className="card-title-sm mb-2" style={{ marginTop: 16 }}>Per Akun</h4>
              <Table
                columns={[
                  { key: 'nama_akun', header: 'Akun', render: (r) => <span style={{ fontWeight: 600 }}>{r.nama_akun}</span> },
                  { key: 'masuk', header: 'Masuk', align: 'right', render: (r) => <span className="num text-success">{formatRupiah(r.masuk)}</span> },
                  { key: 'keluar', header: 'Keluar', align: 'right', render: (r) => <span className="num text-danger">{formatRupiah(r.keluar)}</span> },
                  { key: 'net', header: 'Net', align: 'right', render: (r) => <span className="num">{formatSignedRupiah(r.net)}</span> },
                ]}
                rows={bukuAkunRows}
                empty={<EmptyState title="Belum ada pergerakan" icon="akun" />}
              />
              <div className="flex justify-between items-center mt-3 text-sm text-secondary">
                <span>Total masuk {formatRupiah(bk.total_masuk)} · total keluar {formatRupiah(bk.total_keluar)}</span>
                <b className="num">Net {formatSignedRupiah(bk.net)}</b>
              </div>
            </>
          ) : null}
        </Card>
      )}

      <Card className="mt-4" title="Tambah/Edisi Transaksi Manual">
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={() => setCreateOpen(true)}>
            <Icon name="plus" size={14} /> Tambah Transaksi Manual
          </Button>
        </div>
        <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Tambah Transaksi Manual" size="lg">
          <TransaksiForm manualEntry={true} showKategoriFilter={false} tanggalTransaksi={todayWIB()} onSaved={() => { setCreateOpen(false); setRefresh((r) => r + 1); }} onCancel={() => setCreateOpen(false)} />
        </Modal>
      </Card>
    </div>
  );
}