// PaymentForm — form pembayaran split + bayar kurang
// Mendukung: Tunai, Transfer, Split Payment, Bayar Kurang
import { useState } from 'react';
import { api, newIdempotencyKey } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { formatRupiah, formatRupiahInput, parseRupiah } from '../../lib/format';
import { Button } from '../ui/Button';
import { Field, Input, Select } from '../ui/Field';
import { Icon } from '../ui/Icon';

export default function PaymentForm({ transaksi, onPaid, onCancel }) {
  const akun = useAsync(() => api.get('/akun'), { deps: [] });
  
  const [payments, setPayments] = useState([
    { metode: 'tunai', akun_id: '', nominal: '' }
  ]);
  const [catatan, setCatatan] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const sisa = transaksi.sisa || 0;
  const totalDibayar = payments.reduce((sum, p) => sum + (parseRupiah(p.nominal) || 0), 0);
  const sisaSetelahBayar = sisa - totalDibayar;

  const addPayment = () => {
    setPayments([...payments, { metode: 'tunai', akun_id: '', nominal: '' }]);
  };

  const removePayment = (idx) => {
    if (payments.length <= 1) return;
    setPayments(payments.filter((_, i) => i !== idx));
  };

  const updatePayment = (idx, patch) => {
    setPayments(payments.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    // Validasi
    if (totalDibayar <= 0) {
      setError('Minimal nominal pembayaran harus lebih dari 0.');
      return;
    }
    if (totalDibayar > sisa) {
      setError(`Total pembayaran (${formatRupiah(totalDibayar)}) melebihi sisa tagihan (${formatRupiah(sisa)}).`);
      return;
    }

    // Validasi transfer harus punya akun
    for (const p of payments) {
      if (p.metode === 'transfer' && !p.akun_id) {
        setError('Transfer wajib memilih akun tujuan.');
        return;
      }
    }

    setBusy(true);
    try {
      // Kirim setiap payment ke backend
      for (const p of payments) {
        const nominal = parseRupiah(p.nominal);
        if (nominal <= 0) continue;

        await api.post('/payments', {
          transaksi_id: transaksi.transaksi_id,
          metode: p.metode,
          akun_id: p.metode === 'transfer' ? p.akun_id : undefined,
          nominal,
          catatan: catatan || undefined,
        }, newIdempotencyKey());
      }
      onPaid();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Info Transaksi */}
      <div className="card" style={{ padding: 'var(--space-3)', background: 'var(--bg-surface-alt)' }}>
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-muted">Transaksi</span>
          <span className="font-mono text-sm">{transaksi.id}</span>
        </div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-muted">Total</span>
          <span className="num" style={{ fontWeight: 700 }}>{formatRupiah(transaksi.total)}</span>
        </div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-muted">Sisa Tagihan</span>
          <span className="num" style={{ fontWeight: 700, color: sisa > 0 ? 'var(--warning)' : 'var(--success)' }}>
            {formatRupiah(sisa)}
          </span>
        </div>
      </div>

      {/* Daftar Pembayaran */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <span className="field-label">Pembayaran</span>
          <Button type="button" variant="secondary" size="sm" onClick={addPayment}>
            <Icon name="plus" size={14} /> Tambah
          </Button>
        </div>
        
        <div className="flex flex-col gap-2">
          {payments.map((p, idx) => (
            <div key={idx} className="card" style={{ padding: 'var(--space-2)' }}>
              <div className="flex gap-2 items-end">
                <div style={{ flex: '0 0 120px' }}>
                  <Field label="Metode">
                    <Select value={p.metode} onChange={(e) => updatePayment(idx, { metode: e.target.value, akun_id: '' })}>
                      <option value="tunai">Tunai</option>
                      <option value="transfer">Transfer</option>
                    </Select>
                  </Field>
                </div>
                {p.metode === 'transfer' && (
                  <div style={{ flex: 1 }}>
                    <Field label="Akun">
                      <Select value={p.akun_id} onChange={(e) => updatePayment(idx, { akun_id: e.target.value })}>
                        <option value="">Pilih akun…</option>
                        {(akun.data?.items || []).map((a) => (
                          <option key={a.id} value={a.nama_akun}>{a.nama_akun}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <Field label="Nominal">
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={p.nominal}
                      onChange={(e) => updatePayment(idx, { nominal: formatRupiahInput(e.target.value) })}
                      placeholder="0"
                    />
                  </Field>
                </div>
                {payments.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => removePayment(idx)}>
                    <Icon name="trash" size={14} />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ringkasan */}
      <div className="card" style={{ padding: 'var(--space-3)', background: 'var(--bg-surface-alt)' }}>
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm">Total Dibayar</span>
          <span className="num" style={{ fontWeight: 600 }}>{formatRupiah(totalDibayar)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm">Sisa Setelah Bayar</span>
          <span className="num" style={{ fontWeight: 700, color: sisaSetelahBayar > 0 ? 'var(--warning)' : 'var(--success)' }}>
            {formatRupiah(sisaSetelahBayar)}
          </span>
        </div>
      </div>

      {/* Catatan */}
      <Field label="Catatan (opsional)">
        <Input
          type="text"
          value={catatan}
          onChange={(e) => setCatatan(e.target.value)}
          placeholder="Catatan pembayaran…"
        />
      </Field>

      {/* Error */}
      {error && <p className="field-error" role="alert">{error}</p>}

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" type="button" onClick={onCancel}>Batal</Button>
        <Button type="submit" loading={busy} disabled={totalDibayar <= 0 || totalDibayar > sisa}>
          <Icon name="check" size={16} /> Konfirmasi Pembayaran
        </Button>
      </div>
    </form>
  );
}