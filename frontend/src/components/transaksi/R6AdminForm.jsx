// Form Top Up / Tarik Tunai (R6) — POST /api/transaksi dengan jenis admin.
// Menggunakan endpoint /api/tarif untuk preview admin otomatis.
import { useState, useEffect } from 'react';
import { api, newIdempotencyKey } from '../../lib/api';
import { formatRupiah, formatRupiahInput, parseRupiah } from '../../lib/format';
import { Button } from '../ui/Button';
import { Field, Input, Select } from '../ui/Field';

const PROVIDERS = ['DANA', 'BANK', 'OVO', 'GOPAY'];

function preview(jenis, nominal, admin, adminType) {
  if (!nominal || admin == null) return null;
  if (jenis === 'topup') {
    return { saldo: -nominal, laci: nominal + admin, laba: admin };
  }
  if (adminType === 'dalam') {
    return { saldo: nominal + admin, laci: -nominal, laba: admin };
  }
  return { saldo: nominal, laci: -(nominal - admin), laba: admin };
}

export default function R6AdminForm({ jenis, onSaved, onCancel }) {
  const [provider, setProvider] = useState('DANA');
  const [nominalRaw, setNominalRaw] = useState('');
  const [adminType, setAdminType] = useState('luar');
  const [admin, setAdmin] = useState(null);
  const [tarifError, setTarifError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const nominal = parseRupiah(nominalRaw);

  useEffect(() => {
    let cancelled = false;
    if (!nominal) {
      setAdmin(null);
      setTarifError(null);
      return;
    }
    api
      .get(`/tarif?provider=${provider}&nominal=${nominal}`)
      .then((d) => {
        if (cancelled) return;
        setAdmin(d.admin);
        setTarifError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setAdmin(null);
        setTarifError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, nominal]);

  const pv = preview(jenis, nominal, admin, adminType);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!nominal || nominal < 1) {
      setError('Nominal wajib diisi.');
      return;
    }
    if (admin == null) {
      setError(tarifError || 'Tarif admin tidak dapat dihitung.');
      return;
    }
    const body = {
      jenis,
      nominal,
      mitra: provider,
      ...(jenis === 'tariktunai' ? { admin_type: adminType } : {}),
    };
    setBusy(true);
    try {
      await api.post('/transaksi', body, newIdempotencyKey());
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const title = jenis === 'topup' ? 'Top Up' : 'Tarik Tunai';

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="flex flex-col gap-4">
        <Field label="Provider / Akun" required>
          <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Nominal" required>
          <Input
            type="text"
            inputMode="numeric"
            value={nominalRaw}
            onChange={(e) => setNominalRaw(formatRupiahInput(e.target.value))}
            placeholder="mis. 100.000"
          />
        </Field>

        {jenis === 'tariktunai' && (
          <Field label="Admin" required>
            <Select value={adminType} onChange={(e) => setAdminType(e.target.value)}>
              <option value="dalam">Admin Dalam (Saldo Akun Konter)</option>
              <option value="luar">Admin Luar (Akun Eksternal)</option>
            </Select>
          </Field>
        )}

        {pv && (
          <div className="card" style={{ padding: 'var(--space-3)', boxShadow: 'none', background: 'var(--bg-surface-alt)' }}>
            <div className="text-sm text-muted" style={{ marginBottom: 6 }}>Preview {title}</div>
            <div className="flex justify-between">
              <span>Saldo Akun</span>
              <span className="num" data-testid="pv-saldo">{formatRupiah(pv.saldo)}</span>
            </div>
            <div className="flex justify-between">
              <span>Uang Laci</span>
              <span className="num" data-testid="pv-laci">{formatRupiah(pv.laci)}</span>
            </div>
            <div className="flex justify-between">
              <span>Laba (admin)</span>
              <span className="num" data-testid="pv-laba">{formatRupiah(pv.laba)}</span>
            </div>
          </div>
        )}
        {tarifError && <p className="field-error" role="alert">{tarifError}</p>}

        {error && <p className="field-error" role="alert">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onCancel}>
            Batal
          </Button>
          <Button type="submit" loading={busy}>
            Simpan {title}
          </Button>
        </div>
      </div>
    </form>
  );
}
