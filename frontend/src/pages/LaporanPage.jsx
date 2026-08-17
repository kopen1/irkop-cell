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
import { todayWIB, formatRupiah } from '../lib/format';
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
  }, [period, year, month]); // eslint-disable-line react-hooks/exhaustive-deps

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

    const kategori = r.rekap_kategori || [];
    if (kategori.length) {
      html += '<h2>Rekap Kategori</h2><table><thead><tr><th>Kategori</th><th>Jumlah Item</th><th>Qty</th><th class="r">Omzet</th></tr></thead><tbody>';
      for (const k of kategori) {
        html += '<tr><td>' + k.nama_kategori + '</td><td>' + (k.jumlah_item || 0) + '</td><td>' + (k.qty || 0) + '</td><td class="r">' + formatRupiah(k.omzet || 0) + '</td></tr>';
      }
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
        </>
      )}

      <Card className="mt-4" title="Catatan Tambah/Edisi Transaksi Manual">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Tambah transaksi manual untuk kasus lupa dicatat (PRD 5.4). Transaksi akan ditandai <code>manual_entry</code> dan tercatat pada <code>tanggal_transaksi</code> (WIB).
          </span>
          <Button variant="secondary" onClick={() => setCreateOpen(true)}>
            <Icon name="plus" size={14} /> Tambah Transaksi Manual
          </Button>
        </div>
        <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Tambah Transaksi Manual" size="lg">
          <TransaksiForm manualEntry={true} showKategoriFilter={false} tanggalTransaksi={todayWIB()} onSaved={() => { setCreateOpen(false); setStatus('loading'); run(); }} onCancel={() => setCreateOpen(false)} />
        </Modal>
      </Card>
    </div>
  );
}