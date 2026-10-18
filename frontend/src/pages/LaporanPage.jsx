// Halaman Laporan (PRD 5.4): Laporan Keuangan Lengkap
// - Bulanan/Tahunan: ringkasan omzet, laba, pengeluaran, net
// - Akun: rekap per akun (mutasi_saldo)
// - Rekonsiliasi: uang keluar vs masuk
// - Buku Kas: semua pergerakan kasir
// - Buku Besar: detail per akun (ledger)
// - Laporan Laba Rugi: pendapatan - beban = laba bersih
// - Laporan Neraca: aset vs ekuitas
// Sumber data: backend /api/laporan/*
// Export: CSV via /laporan/export

import { useEffect, useMemo, useState } from 'react';
import { api, downloadFile } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { useSiteName } from '../hooks/useSiteName';
import { todayWIB, formatRupiah, formatSignedRupiah } from '../lib/format';
import { kategoriColor } from '../lib/kategoriColor';
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

function formatRp(v) {
  return formatRupiah(Number(v || 0));
}

function deltaPct(before, after) {
  if (!before || before === 0) return null;
  return ((after - before) / before) * 100;
}

function deltaPctText(delta) {
  if (delta === null || delta === undefined) return '-';
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
}

function openPrint(title, html, siteName = 'IRKOP CELL') {
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
  const w = window.open('', '_blank', 'width=950,height=700');
  if (!w) return false;
  const meta = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  w.document.write(
    '<!doctype html><html><head><meta charset="utf-8"><title>' + title + '</title><style>' + style + '</style></head>' +
      '<body><h1>' + title + '</h1><p class="meta">' + siteName + ' — ' + title + ' · dicetak ' + meta + ' WIB · data sumber: backend</p>' +
      html + '</body></html>'
  );
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
  return true;
}

export default function LaporanPage() {
  const toast = useToast();
  const { can } = useAuth();
  const today = todayWIB();
  const [period, setPeriod] = useState('bulanan');
  const [year, setYear] = useState(today.slice(0, 4));
  const [month, setMonth] = useState(today.slice(5, 7));
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [produk, setProduk] = useState({ status: 'loading', items: [], error: null });
  const [nilaiStok, setNilaiStok] = useState({ status: 'loading', data: null, error: null });
  const [rekon, setRekon] = useState({ status: 'idle', data: null, error: null });
  const [bukuKas, setBukuKas] = useState({ status: 'idle', data: null, error: null });
  const [bukuBesar, setBukuBesar] = useState({ status: 'idle', data: null, error: null });
  const [labaRugi, setLabaRugi] = useState({ status: 'idle', data: null, error: null });
  const [neraca, setNeraca] = useState({ status: 'idle', data: null, error: null });
  const [bukuBesarAkun, setBukuBesarAkun] = useState('');
  const [bbTanggalDari, setBbTanggalDari] = useState('');
  const [bbTanggalSampai, setBbTanggalSampai] = useState('');
  const [showHarian, setShowHarian] = useState(false);
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
    api.get(isBulanan ? '/laporan/bulan' : '/laporan/tahun', params)
      .then((res) => {
        if (!cancelled) { setData(res); setStatus('success'); }
      })
      .catch((err) => { if (!cancelled) { setError(err); setStatus('error'); } });
    return () => { cancelled = true; };
  }, [period, year, month, refresh]);

  useEffect(() => {
    let cancelled = false;
    setProduk({ status: 'loading', items: [], error: null });
    const params = isBulanan ? { bulan: bulanParam } : { tahun: year };
    api.get('/laporan/produk-terlaris', { ...params, limit: 50 })
      .then((res) => { if (!cancelled) setProduk({ status: 'success', items: res.items || [], error: null }); })
      .catch((err) => { if (!cancelled) setProduk({ status: 'error', items: [], error: err }); });
    return () => { cancelled = true; };
  }, [period, year, month, refresh]);

  useEffect(() => {
    let cancelled = false;
    setNilaiStok((s) => ({ ...s, status: 'loading' }));
    api.get('/laporan/nilai-stok')
      .then((res) => { if (!cancelled) setNilaiStok({ status: 'success', data: res, error: null }); })
      .catch((err) => { if (!cancelled) setNilaiStok({ status: 'error', data: null, error: err }); });
    return () => { cancelled = true; };
  }, [refresh]);

  useEffect(() => {
    if (!isBulanan) return undefined;
    let cancelled = false;
    setRekon({ status: 'loading', data: null, error: null });
    api.get('/laporan/rekonsiliasi', { bulan: bulanParam })
      .then((res) => { if (!cancelled) setRekon({ status: 'success', data: res, error: null }); })
      .catch((err) => { if (!cancelled) setRekon({ status: 'error', data: null, error: err }); });
    return () => { cancelled = true; };
  }, [period, year, month, refresh]);

  useEffect(() => {
    if (!isBulanan) return undefined;
    let cancelled = false;
    setBukuKas({ status: 'loading', data: null, error: null });
    api.get('/laporan/buku-kas', { bulan: bulanParam })
      .then((res) => { if (!cancelled) setBukuKas({ status: 'success', data: res, error: null }); })
      .catch((err) => { if (!cancelled) setBukuKas({ status: 'error', data: null, error: err }); });
    return () => { cancelled = true; };
  }, [period, year, month, refresh]);

  useEffect(() => {
    if (!isBulanan) return undefined;
    let cancelled = false;
    setLabaRugi({ status: 'loading', data: null, error: null });
    setNeraca({ status: 'loading', data: null, error: null });
    const startD = `${year}-${month}-01`;
    api.get('/laporan/laporan-laba-rugi', { bulan: bulanParam })
      .then((res) => { if (!cancelled) setLabaRugi({ status: 'success', data: res, error: null }); })
      .catch((err) => { if (!cancelled) setLabaRugi({ status: 'error', data: null, error: err }); });
    api.get('/laporan/laporan-neraca', { tanggal: startD })
      .then((res) => { if (!cancelled) setNeraca({ status: 'success', data: res, error: null }); })
      .catch((err) => { if (!cancelled) setNeraca({ status: 'error', data: null, error: err }); });
    return () => { cancelled = true; };
  }, [period, year, month, refresh]);

  useEffect(() => {
    if (!isBulanan) return undefined;
    let cancelled = false;
    setBukuBesar({ status: 'loading', data: null, error: null });
    const startD = `${year}-${month}-01`;
    const lastDay = new Date(Number(year), Number(month), 0).getDate();
    const endD = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
    api.get('/laporan/buku-besar', {
      akun: bukuBesarAkun || 'Tunai Laci',
      tanggal_dari: bbTanggalDari || startD,
      tanggal_sampai: bbTanggalSampai || endD,
    })
      .then((res) => { if (!cancelled) setBukuBesar({ status: 'success', data: res, error: null }); })
      .catch((err) => { if (!cancelled) setBukuBesar({ status: 'error', data: null, error: err }); });
    return () => { cancelled = true; };
  }, [period, year, month, refresh, bukuBesarAkun, bbTanggalDari, bbTanggalSampai]);

  const handleRefresh = () => setRefresh((r) => r + 1);

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

  const q = isBulanan ? bulanParam : year;
  const stats = data ? [
    { label: 'Jumlah Transaksi', value: String(data.jumlah_transaksi || 0) },
    { label: 'Omzet', value: formatRupiah(data.omzet || 0) },
    { label: 'Laba', value: formatRupiah(data.laba || 0) },
    { label: 'Pengeluaran', value: formatRupiah((data.pengeluaran && data.pengeluaran.total) || 0) },
    { label: 'Net (Laba − Pengeluaran)', value: formatRupiah(data.net || 0) },
    ...(isBulanan
      ? [
          { label: 'Gaji Belum Dibayar', value: formatRupiah((data.gaji_belum_dibayar && data.gaji_belum_dibayar.total) || 0) },
          { label: 'Laba Bersih', value: formatRupiah((data.laba_bersih ?? data.net) || 0), tone: (data.laba_bersih ?? 0) < 0 ? 'danger' : 'success' },
        ]
      : []
    ),
  ] : [];

  const kategoriRows = (data && data.rekap_kategori || []).map((k, i) => ({
    key: k.kategori_id || i,
    nama: k.nama_kategori,
    jumlah_item: k.jumlah_item || 0,
    qty: k.qty || 0,
    omzet: k.omzet || 0,
  }));

  const harianRows = (data && data.rincian_harian || []).map((h) => ({ ...h, key: h.tanggal }));

  const saldoAkunRows = (data && data.saldo_akun || []).map((a) => ({ ...a, key: a.nama_akun }));
  const totalSaldoAwal = (data && data.total_saldo_awal) || 0;
  const totalSaldoAkhir = (data && data.total_saldo_akhir) || 0;

  const kasbon = (data && data.kasbon) || {};
  const kasbonRows = [
    { key: 'baru', label: 'Kasbon Baru', qty: kasbon.baru || 0, nominal: kasbon.nominal_baru || 0 },
    { key: 'belum_lunas', label: 'Belum Lunas', qty: kasbon.belum_lunas || 0, nominal: kasbon.nominal_belum_lunas || 0 },
    { key: 'lunas', label: 'Lunas', qty: kasbon.lunas || 0, nominal: null },
  ];

  const perb = data && data.perbandingan_bulan_sebelumnya;
  const perbRows = [
    { key: 'omzet', label: 'Omzet', value: (perb && perb.omzet) || 0, delta: deltaPct(perb && perb.omzet, data && data.omzet) },
    { key: 'laba', label: 'Laba', value: (perb && perb.laba) || 0, delta: deltaPct(perb && perb.laba, data && data.laba) },
    { key: 'pengeluaran', label: 'Pengeluaran', value: (perb && perb.pengeluaran) || 0, delta: deltaPct(perb && perb.pengeluaran, data && data.pengeluaran && data.pengeluaran.total) },
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

  const lr = labaRugi.data;
  const labaRugiRows = lr
    ? [
        { key: 'pendapatan', label: 'Pendapatan (omzet)', nilai: lr.pendapatan || 0 },
        { key: 'hpp', label: 'HPP / Modal', nilai: -(lr.hpp || 0) },
        { key: 'bruto', label: 'Laba Bruto', nilai: lr.laba_bruto || 0, bold: true },
        { key: 'beban', label: 'Beban operasional (pengeluaran)', nilai: -(lr.beban_pengeluaran || 0) },
        { key: 'gaji', label: 'Beban gaji belum dibayar', nilai: -(lr.beban_gaji_belum_dibayar || 0) },
        { key: 'bersih', label: 'Laba Bersih', nilai: lr.laba_bersih || 0, bold: true, tone: (lr.laba_bersih || 0) < 0 ? 'danger' : 'success' },
      ]
    : [];

  const nr = neraca.data;
  const neracaAsetRows = nr
    ? [
        ...(nr.aset?.akun || []).map((a) => ({ key: 'akun-' + a.nama_akun, label: a.nama_akun, nilai: a.saldo })),
        { key: 'kasbon', label: 'Piutang kasbon (belum lunas)', nilai: nr.aset?.piutang_kasbon || 0 },
        { key: 'stok', label: 'Nilai stok (modal)', nilai: nr.aset?.nilai_stok || 0 },
        { key: 'total-aset', label: 'Total Aset', nilai: nr.aset?.total || 0, bold: true },
      ]
    : [];
  const neracaLiabRows = nr
    ? [
        { key: 'gaji', label: 'Gaji belum dibayar', nilai: nr.liabilitas?.gaji_belum_dibayar || 0 },
        { key: 'total-liab', label: 'Total Liabilitas', nilai: nr.liabilitas?.total || 0, bold: true },
        { key: 'ekuitas', label: 'Ekuitas (Aset − Liabilitas)', nilai: nr.ekuitas?.total || 0, bold: true, tone: (nr.ekuitas?.total || 0) < 0 ? 'danger' : 'success' },
      ]
    : [];

  const hasContent = data && (data.jumlah_transaksi || data.omzet || data.pengeluaran || data.net);

  return (
    <div className="page">
      <PageHeader
        title="Laporan Keuangan"
        subtitle={`Periode ${periodeLabel} · Sumber: backend (mutasi_saldo, transaksi, pengeluaran, gaji_harian)`}
        actions={
          can('laporan') && (
            <div className="page-actions-desktop desktop-only">
              <Button variant="secondary" onClick={handleRefresh} loading={status === 'loading'}>
                <Icon name="refresh" size={14} /> Muat Ulang
              </Button>
              <Button variant="secondary" onClick={handlePdf} disabled={status !== 'success'}>
                <Icon name="print" size={15} /> Cetak / PDF
              </Button>
              <Button variant="secondary" onClick={handleCsv} disabled={status !== 'success'}>
                <Icon name="download" size={15} /> Export CSV
              </Button>
            </div>
          )
        }
      />

      <div className="filter-bar">
        <div className="flex flex-col gap-2" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="flex gap-2">
            <button type="button" className={`tab ${period === 'bulanan' ? 'active' : ''}`} onClick={() => setPeriod('bulanan')}>Bulanan</button>
            <button type="button" className={`tab ${period === 'tahunan' ? 'active' : ''}`} onClick={() => setPeriod('tahunan')}>Tahunan</button>
          </div>
          <Field label="Tahun">
            <Input type="number" min="2020" max="2100" value={year} onChange={(e) => setYear(e.target.value)} />
          </Field>
          {isBulanan && (
            <Field label="Bulan">
              <Select value={month} onChange={(e) => setMonth(e.target.value)}>
                {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                  <option key={m} value={m}>{MONTH_NAMES[Number(m) - 1]}</option>
                ))}
              </Select>
            </Field>
          )}
          <div className="flex flex-col gap-2" style={{ alignSelf: 'flex-end' }}>
            <Button variant="secondary" onClick={handleRefresh} loading={status === 'loading'}>
              <Icon name="refresh" size={14} /> Muat Ulang
            </Button>
            <Button variant="secondary" onClick={handlePdf} disabled={status !== 'success'}>
              <Icon name="print" size={15} /> Cetak / PDF
            </Button>
            <Button variant="secondary" onClick={handleCsv} disabled={status !== 'success'}>
              <Icon name="download" size={15} /> Export CSV
            </Button>
          </div>
        </div>
      </div>

      {status === 'loading' && <Loader label="Memuat laporan ..." />}
      {status === 'error' && <ErrorState error={error} onRetry={() => { setStatus('loading'); setError(null); }} />}
      {status === 'success' && data && !hasContent && (
        <Card>
          <EmptyState title={`Belum ada data untuk ${periodeLabel}`} description="Belum ada transaksi atau pengeluaran pada periode ini." icon="laporan" />
        </Card>
      )}
      {status === 'success' && data && hasContent && (
        <>
          <div className="stat-grid mt-4">
            {stats.map((s) => (
              <div key={s.label} className="stat-card">
                <div className="stat-label">{s.label}</div>
                <div className={`stat-value num ${s.tone === 'danger' ? 'text-danger' : s.tone === 'success' ? 'text-success' : ''}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {isBulanan && (
            <>
              <Card className="mt-4" title="Rekap Kategori">
                <Table className="table-fit" columns={[
                  { key: 'nama', header: 'Kategori', render: (r) => { const c = kategoriColor(r.nama); return <span className="badge" style={{ background: c.bg, color: c.fg, fontWeight: 700 }}>{r.nama}</span>; } },
                  { key: 'jumlah_item', header: 'Jumlah Item', align: 'right', render: (r) => <span className="num">{r.jumlah_item}</span> },
                  { key: 'qty', header: 'Qty', align: 'right', render: (r) => <span className="num">{r.qty}</span> },
                  { key: 'omzet', header: 'Omzet', align: 'right', render: (r) => <span className="num">{formatRupiah(r.omzet)}</span> },
                ]} rows={kategoriRows} empty={<EmptyState title="Belum ada item terjual di periode ini" icon="barang" />} />
              </Card>

              <Card
                className="mt-4"
                title="Rincian Harian"
                actions={
                  <Button variant="ghost" size="sm" onClick={() => setShowHarian((v) => !v)}>
                    {showHarian ? 'Sembunyikan' : 'Tampilkan'}
                  </Button>
                }
              >
                {showHarian ? (
                  <Table className="table-fit" columns={[
                    { key: 'tanggal', header: 'Tanggal', render: (r) => <span className="text-sm">{r.tanggal}</span> },
                    { key: 'jumlah_transaksi', header: 'Trx', align: 'right', className: 'hide-mobile', render: (r) => <span className="num">{r.jumlah_transaksi}</span> },
                    { key: 'omzet', header: 'Omzet', align: 'right', render: (r) => <span className="num">{formatRupiah(r.omzet)}</span> },
                    { key: 'laba', header: 'Laba', align: 'right', render: (r) => <span className="num">{formatRupiah(r.laba)}</span> },
                    { key: 'pengeluaran', header: 'Pengeluaran', align: 'right', className: 'hide-mobile', render: (r) => <span className="num text-danger">{formatRupiah(r.pengeluaran)}</span> },
                    { key: 'beli_stok', header: 'Beli Stok', align: 'right', className: 'hide-mobile', render: (r) => <span className="num text-muted">{formatRupiah(r.beli_stok)}</span> },
                    { key: 'net', header: 'Net', align: 'right', render: (r) => <span className="num">{formatSignedRupiah(r.net)}</span> },
                  ]} rows={harianRows} empty={<EmptyState title="Belum ada pergerakan harian" icon="laporan" />} />
                ) : (
                  <p className="field-hint">
                    {harianRows.length} hari · Omzet {formatRupiah(harianRows.reduce((s, r) => s + (r.omzet || 0), 0))} · Laba {formatRupiah(harianRows.reduce((s, r) => s + (r.laba || 0), 0))} — tekan "Tampilkan" untuk rincian per tanggal.
                  </p>
                )}
              </Card>

              <Card className="mt-4" title="Arus Dana (bukan omzet)">
                <Table className="table-fit" columns={[
                  { key: 'label', header: 'Jenis', render: (r) => <span style={r.tebal ? { fontWeight: 700 } : undefined}>{r.label}</span> },
                  { key: 'nilai', header: 'Nominal', align: 'right', render: (r) => <span className={`num ${r.tebal ? 'font-bold' : ''}`}>{formatRupiah(r.nilai)}</span> },
                ]} rows={[
                  { key: 'kirim', label: 'Kirim uang (nominal titipan)', nilai: data.arus_dana?.kirim_uang || 0 },
                  { key: 'tarik', label: 'Tarik tunai', nilai: data.arus_dana?.tarik_tunai || 0 },
                  { key: 'transfer', label: 'Transfer', nilai: data.arus_dana?.transfer || 0 },
                  { key: 'total', label: 'Total Arus Dana', nilai: data.arus_dana?.total || 0, tebal: true },
                  { key: 'admin', label: 'Pendapatan admin (fee)', nilai: data.pendapatan_admin || 0 },
                ]} empty={<EmptyState title="Tidak ada data arus dana" icon="wallet" />} />
                <p className="field-hint mt-2">Nominal titipan (kirim uang/tarik/transfer) bukan pendapatan, jadi tidak dihitung Omzet.</p>
              </Card>

              <Card className="mt-4" title="Saldo Akun (awal → akhir bulan)">
                <Table className="table-fit" columns={[
                  { key: 'nama_akun', header: 'Akun', render: (r) => <span className="flex items-center gap-2"><span className={`badge badge-${r.tipe === 'tunai' ? 'success' : 'warning'}`}>{r.tipe === 'tunai' ? 'Tunai' : 'Non-tunai'}</span> <span style={{ fontWeight: 600 }}>{r.nama_akun}</span></span> },
                  { key: 'saldo_awal', header: 'Saldo Awal', align: 'right', render: (r) => <span className="num">{formatRupiah(r.saldo_awal)}</span> },
                  { key: 'saldo_akhir', header: 'Saldo Akhir', align: 'right', render: (r) => <span className={`num font-bold ${r.tipe === 'tunai' ? 'text-success' : 'text-warning'}`}>{formatRupiah(r.saldo_akhir)}</span> },
                ]} rows={saldoAkunRows} empty={<EmptyState title="Tidak ada akun" icon="wallet" />} />
                <div className="mt-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Total Saldo Awal</span>
                    <span className="num font-bold">{formatRupiah(totalSaldoAwal || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-sm">Total Saldo Akhir</span>
                    <span className="num font-bold">{formatRupiah(totalSaldoAkhir || 0)}</span>
                  </div>
                </div>
              </Card>

              <Card className="mt-4" title="Laporan Laba Rugi">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm text-muted">Periode: {periodeLabel}</span>
                </div>
                {labaRugi.status === 'loading' && <Loader label="Memuat laba rugi ..." />}
                {labaRugi.status === 'error' && <ErrorState error={labaRugi.error} onRetry={handleRefresh} />}
                {labaRugi.status === 'success' && (
                  <Table className="table-fit" columns={[
                    { key: 'label', header: 'Komponen', render: (r) => <span style={{ fontWeight: r.bold ? 700 : 400 }}>{r.label}</span> },
                    { key: 'nilai', header: 'Nilai', align: 'right', render: (r) => <span className={`num ${r.bold ? 'font-bold' : ''} ${r.tone === 'danger' ? 'text-danger' : r.tone === 'success' ? 'text-success' : ''}`}>{formatRupiah(r.nilai)}</span> },
                  ]} rows={labaRugiRows} empty={<EmptyState title="Tidak ada data laba rugi" icon="laporan" />} />
                )}
              </Card>

              <Card className="mt-4" title="Laporan Neraca (Balance Sheet)">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm text-muted">Tanggal: {nr?.tanggal || '-'}</span>
                </div>
                {neraca.status === 'loading' && <Loader label="Memuat neraca ..." />}
                {neraca.status === 'error' && <ErrorState error={neraca.error} onRetry={handleRefresh} />}
                {neraca.status === 'success' && (
                  <>
                    <Table className="table-fit" columns={[
                      { key: 'label', header: 'Aset', render: (r) => <span style={{ fontWeight: r.bold ? 700 : 600 }}>{r.label}</span> },
                      { key: 'nilai', header: 'Nilai', align: 'right', render: (r) => <span className={`num ${r.bold ? 'font-bold' : ''}`}>{formatRupiah(r.nilai)}</span> },
                    ]} rows={neracaAsetRows} empty={<EmptyState title="Tidak ada data aset" icon="wallet" />} />
                    <Table className="table-fit mt-3" columns={[
                      { key: 'label', header: 'Liabilitas & Ekuitas', render: (r) => <span style={{ fontWeight: r.bold ? 700 : 600 }}>{r.label}</span> },
                      { key: 'nilai', header: 'Nilai', align: 'right', render: (r) => <span className={`num ${r.bold ? 'font-bold' : ''} ${r.tone === 'danger' ? 'text-danger' : r.tone === 'success' ? 'text-success' : ''}`}>{formatRupiah(r.nilai)}</span> },
                    ]} rows={neracaLiabRows} empty={<EmptyState title="Tidak ada data ekuitas" icon="wallet" />} />
                  </>
                )}
              </Card>

              <Card className="mt-4" title="Buku Besar (General Ledger)">
                <div className="flex flex-col gap-3">
                  <Field label="Akun" style={{ maxWidth: 300 }}>
                    <Input type="text" placeholder="Ketik nama akun..." value={bukuBesarAkun || ''} onChange={(e) => setBukuBesarAkun(e.target.value)} />
                  </Field>
                  <Field label="Dari Tanggal" style={{ maxWidth: 200 }}>
                    <Input type="date" value={bbTanggalDari || ''} onChange={(e) => setBbTanggalDari(e.target.value)} />
                  </Field>
                  <Field label="Sampai Tanggal" style={{ maxWidth: 200 }}>
                    <Input type="date" value={bbTanggalSampai || ''} onChange={(e) => setBbTanggalSampai(e.target.value)} />
                  </Field>
                </div>
                {bukuBesar.status === 'loading' && <Loader label="Memuat buku besar ..." />}
                {bukuBesar.status === 'error' && <ErrorState error={bukuBesar.error} onRetry={handleRefresh} />}
                {bukuBesar.status === 'success' && bukuBesar.data?.items?.length ? (
                  <>
                    <div className="flex justify-between mb-2">
                      <span className="text-sm text-muted">Saldo Awal</span>
                      <span className="num font-bold">{formatRupiah(bukuBesar.data.saldo_awal || 0)}</span>
                    </div>
                    <Table className="table-fit" columns={[
                      { key: 'tanggal', header: 'Tanggal', render: (r) => <span className="text-sm">{r.tanggal}</span> },
                      { key: 'nama_akun', header: 'Akun', render: (r) => <span style={{ fontWeight: 600 }}>{r.nama_akun}</span> },
                      { key: 'jenis_transaksi', header: 'Jenis', render: (r) => <span className="text-sm text-muted">{r.jenis_transaksi || '-'}</span> },
                      { key: 'kode_transaksi', header: 'Kode Transaksi', align: 'right', render: (r) => <span className="num text-sm font-mono">{r.kode_transaksi}</span> },
                      { key: 'jumlah', header: 'Jumlah', align: 'right', render: (r) => <span className={`num ${r.jumlah >= 0 ? 'text-success' : 'text-danger'}`}>{formatRupiah(r.jumlah)}</span> },
                      { key: 'saldo', header: 'Saldo', align: 'right', render: (r) => <span className="num font-bold">{formatRupiah(r.saldo)}</span> },
                    ]} rows={bukuBesar.data.items} empty={<EmptyState title="Pilih akun dan tanggal" icon="kasir" description="Pilih akun dan rentang tanggal untuk melihat buku besar." />} />
                    <div className="flex justify-between mt-2">
                      <span className="text-sm text-muted">Saldo Akhir</span>
                      <span className="num font-bold">{formatRupiah(bukuBesar.data.saldo_akhir || 0)}</span>
                    </div>
                  </>
                ) : null}
                {bukuBesar.status === 'success' && !bukuBesar.data?.items?.length && (
                  <EmptyState title="Pilih akun dan tanggal" icon="kasir" description="Pilih akun dan rentang tanggal untuk melihat buku besar." />
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}