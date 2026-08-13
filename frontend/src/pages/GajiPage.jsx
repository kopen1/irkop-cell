// Gaji Karyawan (PRD 5.10) — ADMIN ONLY (guard di Guard.jsx + backend).
// HARD RULE: nominal gaji tidak pernah tampil ke role Karyawan (PRD 3.2).
// - List gaji harian (auto-input saat Opening / manual_edit).
// - Edit nominal manual (kasus cuti tidak dibayar) → PUT /api/gaji/:id.
// - Atur rate karyawan: flat / custom per hari → POST /api/gaji/rate.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { todayWIB, formatRupiah, formatRupiahInput, parseRupiah } from '../lib/format';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Field, Input, Select, Textarea } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { Table } from '../components/ui/Table';
import { Loader, ErrorState, EmptyState } from '../components/ui/States';
import { Badge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';

const HARI = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'];
const HARI_LABEL = { senin: 'Senin', selasa: 'Selasa', rabu: 'Rabu', kamis: 'Kamis', jumat: 'Jumat', sabtu: 'Sabtu', minggu: 'Minggu' };

export default function GajiPage() {
  const toast = useToast();
  const [month, setMonth] = useState(todayWIB().slice(0, 7)); // YYYY-MM

  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const load = useMemo(
    () => async () => {
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        const data = await api.get('/gaji', { month });
        setState({ status: 'success', data, error: null });
        return data;
      } catch (err) {
        setState({ status: 'error', data: null, error: err });
        throw err;
      }
    },
    [month]
  );

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const [rateOpen, setRateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  const data = state.data || {};
  const rows = (data.items || []).map((g) => ({ ...g, key: `${g.user_id}-${g.tanggal}` }));
  const totalBulan = rows.reduce((s, g) => s + Number(g.nominal), 0);

  return (
    <div className="page">
      <PageHeader
        title="Gaji Karyawan"
        subtitle="Nominal gaji hanya dapat dilihat Admin. Auto-input saat Opening; admin boleh mengoreksi manual."
        actions={
          <Button variant="secondary" onClick={() => setRateOpen(true)}>
            <Icon name="settings" size={16} /> Atur Rate
          </Button>
        }
      />

      <div className="filter-bar">
        <Field label="Bulan">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <div className="summary-item" style={{ alignSelf: 'flex-end' }}>
          <div className="summary-label">Total gaji bulan ini</div>
          <div className="summary-value num">{formatRupiah(totalBulan)}</div>
        </div>
      </div>

      {state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={() => load().catch(() => {})} />
      ) : state.status === 'loading' && !data.items ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyState title="Belum ada data gaji" description="Gaji tercatat otomatis saat Karyawan melakukan Opening." icon="gaji" />
      ) : (
        <Table
          columns={[
            { key: 'nama', header: 'Karyawan', render: (r) => <span style={{ fontWeight: 600 }}>{r.nama || r.user_nama || '-'}</span> },
            { key: 'tanggal', header: 'Tanggal', render: (r) => <span className="text-sm">{r.tanggal}</span> },
            { key: 'sumber', header: 'Sumber', render: (r) => (r.sumber === 'auto' ? <Badge tone="info">Auto (Opening)</Badge> : <Badge tone="accent">Manual Edit</Badge>) },
            { key: 'nominal', header: 'Nominal', align: 'right', render: (r) => <span className="num">{formatRupiah(r.nominal)}</span> },
            { key: 'catatan', header: 'Catatan', render: (r) => <span className="text-sm text-muted">{r.catatan || '—'}</span> },
            {
              key: 'aksi',
              header: '',
              render: (r) => (
                <div className="row-actions">
                  <Button variant="ghost" size="sm" aria-label={`Edit gaji ${r.tanggal}`} onClick={() => setEditTarget(r)}>
                    <Icon name="edit" size={15} />
                  </Button>
                </div>
              ),
            },
          ]}
          rows={rows}
        />
      )}

      <Modal open={Boolean(editTarget)} onClose={() => setEditTarget(null)} title={`Koreksi Gaji — ${editTarget?.tanggal}`}>
        <GajiEditForm
          target={editTarget}
          onCancel={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            toast.success('Gaji dikoreksi.');
            load().catch(() => {});
          }}
        />
      </Modal>

      <RateModal open={rateOpen} onClose={() => setRateOpen(false)} onSaved={() => toast.success('Rate tersimpan.')} />
    </div>
  );
}

function GajiEditForm({ target, onCancel, onSaved }) {
  const [nominal, setNominal] = useState(target?.nominal ? formatRupiahInput(String(target.nominal)) : '');
  const [catatan, setCatatan] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!nominal || parseRupiah(nominal) < 0) return setError('Nominal wajib diisi (0 ke atas).');
    setBusy(true);
    try {
      await api.put(`/gaji/${target.id}`, { nominal: parseRupiah(nominal), catatan: catatan.trim() || undefined });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm text-secondary" style={{ background: 'var(--warning-soft)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>
        Karyawan: <strong>{target?.nama || '-'}</strong> — tanggal {target?.tanggal} — sumber {target?.sumber}.
        Gunakan untuk kasus cuti tidak dibayar; perubahan tercatat di audit.
      </p>
      <Field label="Nominal gaji (Rp)" required>
        <Input type="text" inputMode="numeric" value={nominal} onChange={(e) => setNominal(formatRupiahInput(e.target.value))} />
      </Field>
      <Field label="Catatan (opsional)">
        <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. cuti tidak dibayar…" />
      </Field>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" type="button" onClick={onCancel}>Batal</Button>
        <Button type="submit" loading={busy}>Simpan</Button>
      </div>
    </form>
  );
}

function RateModal({ open, onClose, onSaved }) {
  const [users, setUsers] = useState([]);
  const [rates, setRates] = useState({});
  const [sel, setSel] = useState('');
  const [tipe, setTipe] = useState('flat');
  const [rateFlat, setRateFlat] = useState('');
  const [custom, setCustom] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    api.get('/users', { limit: 200 }).then((r) => setUsers(r.items || [])).catch(() => {});
    api.get('/gaji/rate').then((r) => {
      const m = {};
      (r.items || []).forEach((r0) => (m[r0.user_id] = r0));
      setRates(m);
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (sel && rates[sel]) {
      setTipe(rates[sel].tipe);
      setRateFlat(rates[sel].rate_flat ?? '');
    } else if (sel) {
      setTipe('flat');
      setRateFlat('');
    }
  }, [sel, rates]);

  const save = async () => {
    setError(null);
    if (!sel) return setError('Pilih karyawan.');
    setBusy(true);
    try {
      if (tipe === 'flat') {
        if (!rateFlat || parseRupiah(rateFlat) <= 0) {
          setBusy(false);
          return setError('Rate flat wajib diisi.');
        }
        await api.post('/gaji/rate', { user_id: Number(sel), tipe: 'flat', rate_flat: parseRupiah(rateFlat) });
      } else {
        const harian = HARI.map((h) => ({ hari: h, rate: parseRupiah(custom[h]) }));
        if (harian.some((h) => h.rate <= 0)) {
          setBusy(false);
          return setError('Semua hari wajib diisi untuk tipe custom per hari.');
        }
        await api.post('/gaji/rate', { user_id: Number(sel), tipe: 'custom_harian', harian });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Atur Rate Gaji"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Tutup</Button>
          <Button onClick={save} loading={busy}>Simpan Rate</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Karyawan">
          <Select value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="">Pilih karyawan…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.nama} {rates[u.id] ? `(${rates[u.id].tipe === 'flat' ? 'flat' : 'custom harian'})` : ''}</option>
            ))}
          </Select>
        </Field>
        <Field label="Tipe rate">
          <Select value={tipe} onChange={(e) => setTipe(e.target.value)}>
            <option value="flat">Flat — 1 rate tetap per hari</option>
            <option value="custom_harian">Custom per hari dalam seminggu</option>
          </Select>
        </Field>
        {tipe === 'flat' ? (
          <Field label="Rate harian (Rp)" required>
            <Input type="text" inputMode="numeric" value={rateFlat} onChange={(e) => setRateFlat(formatRupiahInput(e.target.value))} />
          </Field>
        ) : (
          <div className="flex flex-col gap-2">
            {HARI.map((h) => (
              <div key={h} className="flex items-center gap-3">
                <span style={{ width: 90, fontSize: '0.88rem' }}>{HARI_LABEL[h]}</span>
                <Input type="text" inputMode="numeric" value={custom[h] ? formatRupiahInput(custom[h]) : ''} onChange={(e) => setCustom((c) => ({ ...c, [h]: formatRupiahInput(e.target.value) }))} placeholder="0" />
              </div>
            ))}
          </div>
        )}
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}