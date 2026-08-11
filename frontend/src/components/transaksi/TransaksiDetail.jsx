// Detail transaksi + preview struk & print dialog browser (PRD 5.2).
// Struk hanya menampilkan data transaksi yang dikembalikan backend.
import { useMemo } from 'react';
import { formatDateTime, formatRupiah, labelMetode, labelKonfirmasi } from '../../lib/format';
import { Button } from '../ui/Button';
import { KonfirmasiBadge } from '../ui/Badge';

function buildStruk(t, konterNama = 'Iirkop Cell') {
  const lines = [];
  lines.push(konterNama.toUpperCase());
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
  const struk = useMemo(() => (transaksi ? buildStruk(transaksi) : ''), [transaksi]);
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

export function TransaksiDetail({ transaksi }) {
  if (!transaksi) return null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="num" style={{ fontSize: '1.05rem', fontWeight: 800 }}>{transaksi.id}</span>
        </div>
        <KonfirmasiBadge status={transaksi.konfirmasi_pembayaran} />
      </div>
      <div className="grid-2">
        <div>
          <p className="text-xs text-muted">Tanggal/Jam (WIB)</p>
          <p className="text-sm">{formatDateTime(transaksi.created_at)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Metode bayar</p>
          <p className="text-sm">{labelMetode(transaksi.metode_bayar)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Pelanggan</p>
          <p className="text-sm">{transaksi.pelanggan_nama || 'Umum / Tanpa Nama'}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Sumber</p>
          <p className="text-sm">{transaksi.manual_entry ? 'Input manual (Laporan)' : 'Transaksi'}</p>
        </div>
      </div>
      {transaksi.laba !== undefined && transaksi.laba !== null && (
        <div>
          <p className="text-xs text-muted">Laba</p>
          <p className="num text-sm">{formatRupiah(transaksi.laba)}</p>
        </div>
      )}
      <StrukPreview transaksi={transaksi} />
    </div>
  );
}