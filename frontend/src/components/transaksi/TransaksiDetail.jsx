// Detail transaksi + preview struk & print dialog browser (PRD 5.2).
// Struk hanya menampilkan data transaksi yang dikembalikan backend.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { useSiteName } from '../../hooks/useSiteName';
import { formatDateTime, formatRupiah, formatSignedRupiah, labelMetode, labelKonfirmasi } from '../../lib/format';
import { Button } from '../ui/Button';
import { Select } from '../ui/Field';
import { KonfirmasiBadge } from '../ui/Badge';

const KONFIRMASI_OPTIONS = [
  { value: 'tidak_perlu', label: 'Tidak Perlu' },
  { value: 'menunggu', label: 'Menunggu' },
  { value: 'otomatis', label: 'Otomatis' },
  { value: 'manual', label: 'Manual' },
];

function buildStruk(t, konterNama) {
  const lines = [];
  lines.push((konterNama || 'Iirkop Cell').toUpperCase());
  lines.push('Jl. Kasir — PPOB & Service HP');
  lines.push('================================');
  lines.push(`No: ${t.id}`);
  lines.push(`Jam: ${formatDateTime(t.created_at)}`);
  lines.push(`${labelMetode(t.metode_bayar)} — ${labelKonfirmasi(t.konfirmasi_pembayaran)}`);
  lines.push('--------------------------------');
  (t.items || []).forEach((it) => {
    lines.push(`${it.nama_produk_snapshot || it.nama_produk || '-'}`);
    lines.push(
      `  ${it.qty} x ${formatRupiah(it.harga_snapshot ?? it.harga ?? 0)}${it.nominal_referensi ? `\n  Kirim: ${formatRupiah(it.nominal_referensi)}` : ''}`
    );
    lines.push(`     . . . . . . . . . . . . . . . .`);
  });
  lines.push('--------------------------------');
  lines.push(`TOTAL   ${formatRupiah(t.total)}`);
  lines.push('================================');
  lines.push('Terima kasih');
  return lines.join('\n');
}

export function StrukPreview({ transaksi }) {
  const siteName = useSiteName();
  const struk = useMemo(() => (transaksi ? buildStruk(transaksi, siteName) : ''), [transaksi, siteName]);
  if (!transaksi) return null;

  const print = () => {
    const win = window.open('', '_blank', 'width=320,height=600');
    if (!win) {
      alert('Popup diblokir. Izinkan popup untuk mencetak struk.');
      return;
    }
    win.document.write(`<!doctype html><html><head><title>Struk ${transaksi.id}</title>
      <style>
        body{font-family:'Courier New',monospace;font-size:12px;margin:16px;width:280px;white-space:pre-wrap}
        @media print{body{margin:0}}
      </style></head><body><pre>${struk.replace(/</g, '&lt;')}</pre>
      <script>window.onload=()=>setTimeout(()=>window.print(),200);</script></body></html>`);
    win.document.close();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="table-wrap" style={{ maxHeight: '46vh', overflowY: 'auto' }}>
        <table className="table" style={{ minWidth: 0 }}>
          <thead>
            <tr>
              <th>Produk</th>
              <th className="col-right">Qty</th>
              <th className="col-right">Harga</th>
              <th className="col-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {(transaksi.items || []).map((it, i) => (
              <tr key={i}>
                <td>
                  {it.nama_produk_snapshot || it.nama_produk || '-'}
                  {it.service_hp_id ? (
                    <div className="text-xs text-muted">Service HP #{it.service_hp_id} — biaya jasa</div>
                  ) : null}
                  {it.nominal_referensi ? (
                    <div className="text-xs text-muted">Kirim uang: {formatRupiah(it.nominal_referensi)} {it.akun_sumber ? `(via ${it.akun_sumber})` : ''}</div>
                  ) : null}
                </td>
                <td className="col-right num">{it.qty}</td>
                <td className="col-right num">{formatRupiah(it.harga_snapshot ?? it.harga ?? 0)}</td>
                <td className="col-right num">{formatRupiah(it.subtotal)}</td>
              </tr>
            ))}
          </tbody>
          {transaksi.diskon ? (
            <tfoot>
              <tr>
                <td colSpan="3" className="text-right">Diskon</td>
                <td className="col-right num">−{formatRupiah(transaksi.diskon)}</td>
              </tr>
            </tfoot>
          ) : null}
          <tfoot>
            <tr>
              <td colSpan="3" className="text-right"><strong>TOTAL</strong></td>
              <td className="col-right num"><strong>{formatRupiah(transaksi.total)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div
        className="card"
        style={{ background: 'var(--bg-surface-alt)', padding: 'var(--space-3)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}
      >
        {struk}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={print}>
          Cetak Struk
        </Button>
      </div>
    </div>
  );
}

// Ledger mutasi_saldo (sumber kebenaran backend). Menampilkan tiap baris
// dengan tanda & akun yang benar (DANA +/-, Tunai Laci, Laba, dsb). Baris
// reversal (pembatalan) ditandai agar tidak membingungkan dengan mutasi asli.
function MutasiSection({ mutasi, loading }) {
  if (!mutasi || mutasi.length === 0) {
    if (loading) {
      return (
        <div>
          <p className="text-xs text-muted">Mutasi Saldo</p>
          <p className="text-sm text-muted">Memuat mutasi…</p>
        </div>
      );
    }
    return null;
  }
  return (
    <div>
      <p className="text-xs text-muted">Mutasi Saldo (sumber: backend)</p>
      <div className="table-wrap" style={{ maxHeight: '40vh', overflowY: 'auto' }}>
        <table className="table" style={{ minWidth: 0 }}>
          <thead>
            <tr>
              <th>Akun</th>
              <th className="col-right">Mutasi</th>
            </tr>
          </thead>
          <tbody>
            {mutasi.map((m, i) => {
              const jumlah = Number(m.jumlah ?? 0);
              const isReversal = m.sumber_tipe === 'reversal';
              return (
                <tr key={m.id ?? `${m.nama_akun}:${m.mutation_key}:${i}`}>
                  <td>
                    {m.nama_akun}
                    {isReversal ? (
                      <span className="text-xs text-muted" style={{ marginLeft: 6 }}>· Pembatalan</span>
                    ) : null}
                  </td>
                  <td className={`col-right num ${jumlah < 0 ? 'text-danger' : 'text-success'}`}>
                    {formatSignedRupiah(jumlah)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TransaksiDetail({ transaksi, onConfirm, onBayarKurang }) {
  // Parent bisa mengirim data ringkasan dari list (tanpa mutasi_saldo).
  // Pastikan kita selalu menampilkan data otoritatif dari backend.
  const [data, setData] = useState(transaksi);
  const [loadingMutasi, setLoadingMutasi] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmValue, setConfirmValue] = useState(transaksi?.konfirmasi_pembayaran || 'manual');
  const { toast } = useToast();

  useEffect(() => {
    if (transaksi) setConfirmValue(transaksi.konfirmasi_pembayaran || 'manual');
  }, [transaksi]);

  useEffect(() => {
    if (!transaksi) {
      setData(null);
      return undefined;
    }
    setData(transaksi);
    if (!transaksi.mutasi_saldo && transaksi.id != null) {
      let cancelled = false;
      setLoadingMutasi(true);
      api
        .get(`/transaksi/${encodeURIComponent(transaksi.id)}`)
        .then((r) => {
          if (!cancelled) setData(r.transaksi || r);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoadingMutasi(false);
        });
      return () => {
        cancelled = true;
      };
    }
    setLoadingMutasi(false);
    return undefined;
  }, [transaksi]);

  const reload = useCallback(() => {
    if (!data?.id) return;
    api
      .get(`/transaksi/${encodeURIComponent(data.id)}`)
      .then((r) => {
        setData(r.transaksi || r);
        onConfirm?.();
      })
      .catch(() => {});
  }, [data?.id, onConfirm]);

  const hasKirimUang = (data?.items || []).some((it) => Number(it.nominal_referensi || 0) > 0);
  const isAdminTx = data?.jenis === 'transfer' || data?.jenis === 'tariktunai';
  const showKonfirmasi = data?.metode_bayar === 'transfer' || hasKirimUang || isAdminTx;

  const saveKonfirmasi = async () => {
    if (!data?.id || confirmBusy) return;
    setConfirmBusy(true);
    try {
      await api.put(`/transaksi/${encodeURIComponent(data.id)}/konfirmasi`, { konfirmasi_pembayaran: confirmValue });
      toast.success('Status konfirmasi diperbarui.');
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setConfirmBusy(false);
    }
  };

  if (!data) return null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="num" style={{ fontSize: '1.05rem', fontWeight: 800 }}>{data.id}</span>
        </div>
        <div className="flex items-center gap-2">
          <KonfirmasiBadge status={data.konfirmasi_pembayaran} />
          {data.status_bayar && data.status_bayar !== 'lunas' && (
            <span className="badge" style={{ background: 'var(--warning-soft)', color: 'var(--warning)', padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem' }}>
              {data.status_bayar === 'belum_bayar' ? 'Belum Bayar' : 'Sebagian'}
            </span>
          )}
        </div>
      </div>

      {/* Info Sisa Tagihan */}
      {data.sisa > 0 && (
        <div className="card" style={{ padding: 'var(--space-3)', background: 'var(--warning-soft)', border: '1px solid var(--warning)' }}>
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm" style={{ fontWeight: 600 }}>Sisa Tagihan</p>
              <p className="num" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--warning)' }}>
                {formatRupiah(data.sisa)}
              </p>
            </div>
            <Button onClick={() => onBayarKurang?.(data)} size="sm">
              <Icon name="wallet" size={14} /> Bayar Kurang
            </Button>
          </div>
        </div>
      )}

      {showKonfirmasi && (
        <div className="card" style={{ padding: 'var(--space-3)', background: 'var(--bg-surface-alt)', border: '1px solid var(--border)' }}>
          <p className="text-xs text-muted" style={{ marginBottom: 'var(--space-2)' }}>Status konfirmasi pembayaran (dapat diubah)</p>
          <div className="flex items-end gap-2">
            <div style={{ flex: 1, minWidth: 0 }}>
              <Select
                value={confirmValue}
                onChange={(e) => setConfirmValue(e.target.value)}
                aria-label="Status konfirmasi pembayaran"
              >
                {KONFIRMASI_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </div>
            <Button onClick={saveKonfirmasi} loading={confirmBusy}>Simpan</Button>
          </div>
        </div>
      )}
      <div className="grid-2">
        <div>
          <p className="text-xs text-muted">Tanggal/Jam (WIB)</p>
          <p className="text-sm">{formatDateTime(data.created_at)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Metode bayar</p>
          <p className="text-sm">{labelMetode(data.metode_bayar)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Pelanggan</p>
          <p className="text-sm">{data.pelanggan_nama || 'Umum / Tanpa Nama'}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Sumber</p>
          <p className="text-sm">{data.manual_entry ? 'Input manual (Laporan)' : 'Transaksi'}</p>
        </div>
      </div>
      {data.laba !== undefined && data.laba !== null && (
        <div>
          <p className="text-xs text-muted">Laba</p>
          <p className="num text-sm">{formatRupiah(data.laba)}</p>
        </div>
      )}
      <MutasiSection mutasi={data.mutasi_saldo} loading={loadingMutasi} />
      <StrukPreview transaksi={data} />
    </div>
  );
}
