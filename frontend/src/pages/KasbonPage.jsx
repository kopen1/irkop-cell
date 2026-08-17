// Halaman Kasbon (PRD 5.7): daftar hutang pelanggan & status pelunasan.
// - Grouping per pelanggan (item 9): klik nama pelanggan untuk buka/tutup
//   daftar bon miliknya. Murni presentasi; tidak menggabungkan baris DB.
// - Pembayaran sebagian / pelunasan (item 10): input "Bayar" per bon →
//   POST /api/kasbon/:id/payment; status 'sebagian' diwakili
//   status='belum_lunas' + terbayar>0. Lunas saat terbayar >= nominal.
// - Set lunas → PUT /api/kasbon/:id (backend membuat mutasi kasbon_pelunasan).
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useAsync } from '../hooks/useAsync';
import { formatRupiah, todayWIB, formatRupiahInput, parseRupiah } from '../lib/format';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Field, Input, Select } from '../components/ui/Field';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { Table } from '../components/ui/Table';
import { Loader, ErrorState, EmptyState } from '../components/ui/States';
import { PelunasanBadge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';

const LIMIT = 100;

export default function KasbonPage() {
  const { can } = useAuth();
  const toast = useToast();
  const akun = useAsync(() => api.get('/akun'), { deps: [] });

  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const load = useMemo(
    () => async () => {
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        const data = await api.get('/kasbon', { limit: LIMIT });
        setState({ status: 'success', data, error: null });
        return data;
      } catch (err) {
        setState({ status: 'error', data: null, error: err });
        throw err;
      }
    },
    []
  );

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const [createOpen, setCreateOpen] = useState(false);
  const [lunasTarget, setLunasTarget] = useState(null);
  const [lunasAkun, setLunasAkun] = useState('');
  const [lunasBusy, setLunasBusy] = useState(false);

  const [expanded, setExpanded] = useState({});
  const [bayar, setBayar] = useState({});
  const [bayarBusy, setBayarBusy] = useState({});

  const data = state.data || {};
  const rows = (data.items || []).map((k) => ({ ...k, key: k.id }));

  const sisaBon = (k) => Number(k.nominal) - Number(k.terbayar || 0);
  const totalBelumLunas = rows.filter((k) => k.status === 'belum_lunas').reduce((s, k) => s + sisaBon(k), 0);
  const totalKasbon = rows.reduce((s, k) => s + Number(k.nominal), 0);

  const groups = useMemo(() => {
    const map = new Map();
    for (const k of rows) {
      const key = String(k.pelanggan_id ?? 'umum');
      if (!map.has(key)) {
        map.set(key, { key, pelanggan_id: k.pelanggan_id, nama: k.pelanggan_nama || 'Umum', bons: [] });
      }
      map.get(key).bons.push(k);
    }
    return Array.from(map.values());
  }, [rows]);

  const toggleGroup = (gkey) => setExpanded((s) => ({ ...s, [gkey]: !s[gkey] }));

  const doLunas = async () => {
    setLunasBusy(true);
    try {
      await api.put(`/kasbon/${lunasTarget.id}`, { status: 'lunas', akun: lunasAkun || undefined });
      toast.success(`Kasbon ${formatRupiah(lunasTarget.nominal)} ditandai lunas. Mutasi pelunasan dibuat backend.`);
      setLunasTarget(null);
      setLunasAkun('');
      setBayar((s) => ({ ...s, [lunasTarget.id]: '' }));
      load().catch(() => {});
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLunasBusy(false);
    }
  };

  const doBayar = async (k) => {
    const nominal = parseRupiah(bayar[k.id]);
    const sisa = sisaBon(k);
    if (!nominal || nominal < 1) return;
    if (nominal > sisa) {
      toast.error(`Pembayaran melebihi sisa (${formatRupiah(sisa)}).`);
      return;
    }
    setBayarBusy((s) => ({ ...s, [k.id]: true }));
    try {
      await api.post(`/kasbon/${k.id}/payment`, { nominal, metode: 'tunai', akun_id: 'Tunai Laci' });
      toast.success(`Pembayaran ${formatRupiah(nominal)} tercatat untuk ${k.pelanggan_nama || 'pelanggan'}.`);
      setBayar((s) => ({ ...s, [k.id]: '' }));
      load().catch(() => {});
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBayarBusy((s) => ({ ...s, [k.id]: false }));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Kasbon"
        subtitle="Hutang pelanggan & status pelunasan. Klik nama pelanggan untuk membuka daftar bon. Pembayaran sebagian tercatat via tombol Bayar."
        actions={
          can('kasbon') && (
            <Button onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size={16} /> Tambah Kasbon
            </Button>
          )
        }
      />

      <div className="summary-bar">
        <div className="summary-item">
          <div className="summary-label">Sisa belum lunas</div>
          <div className="summary-value text-warning">{formatRupiah(totalBelumLunas)}</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Total kasbon</div>
          <div className="summary-value">{formatRupiah(totalKasbon)}</div>
        </div>
      </div>

      {state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={() => load().catch(() => {})} />
      ) : state.status === 'loading' && !data.items ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyState title="Belum ada kasbon" description="Kasbon dibuat dari transaksi ber-metode Bon atau ditambah manual." icon="kasbon" />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            const isOpen = Boolean(expanded[g.key]);
            const groupSisa = g.bons.reduce((s, k) => s + (k.status === 'lunas' ? 0 : sisaBon(k)), 0);
            return (
              <div key={g.key} className="card" style={{ padding: 'var(--space-3)' }}>
                <button
                  type="button"
                  onClick={() => toggleGroup(g.key)}
                  className="flex items-center justify-between"
                  style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  aria-expanded={isOpen}
                >
                  <span style={{ fontWeight: 600 }}>{g.nama}</span>
                  <span className="flex items-center gap-3">
                    <span className="num text-sm text-warning">{formatRupiah(groupSisa)}</span>
                    <Icon name={isOpen ? 'minus' : 'plus'} size={16} />
                  </span>
                </button>
                {isOpen && (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <Table
                      columns={[
                        { key: 'nominal', header: 'Total bon', align: 'right', render: (r) => <span className="num">{formatRupiah(r.nominal)}</span> },
                        { key: 'terbayar', header: 'Bayar', align: 'right', render: (r) => <span className="num">{formatRupiah(r.terbayar || 0)}</span> },
                        { key: 'sisa', header: 'Sisa', align: 'right', render: (r) => <span className="num text-warning">{formatRupiah(sisaBon(r))}</span> },
                        { key: 'tanggal', header: 'Tanggal', render: (r) => <span className="text-sm">{r.tanggal}</span> },
                        {
                          key: 'jatuh_tempo',
                          header: 'Jatuh tempo',
                          render: (r) => (r.jatuh_tempo ? <span className="text-sm">{r.jatuh_tempo}</span> : <span className="text-muted">—</span>),
                        },
                        { key: 'status', header: 'Status', render: (r) => <PelunasanBadge status={r.status} /> },
                        {
                          key: 'aksi',
                          header: '',
                          align: 'right',
                          render: (r) =>
                            can('kasbon') && r.status === 'belum_lunas' ? (
                              <div className="flex items-center justify-end gap-2">
                                <Input
                                  type="text"
                                  inputMode="numeric"
                                  aria-label={`Bayar kasbon ${r.id}`}
                                  placeholder="Bayar…"
                                  value={bayar[r.id] || ''}
                                  onChange={(e) => setBayar((s) => ({ ...s, [r.id]: formatRupiahInput(e.target.value) }))}
                                  style={{ width: 110 }}
                                />
                                <Button
                                  size="sm"
                                  loading={Boolean(bayarBusy[r.id])}
                                  disabled={!bayar[r.id] || parseRupiah(bayar[r.id]) < 1 || parseRupiah(bayar[r.id]) > sisaBon(r)}
                                  onClick={() => doBayar(r)}
                                >
                                  Bayar
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={(e) => { e.stopPropagation(); setLunasTarget(r); setLunasAkun(''); }}
                                >
                                  <Icon name="check" size={14} /> Set Lunas
                                </Button>
                              </div>
                            ) : null,
                        },
                      ]}
                      rows={g.bons}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Tambah Kasbon">
        <KasbonForm
          onCancel={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            toast.success('Kasbon ditambahkan.');
            load().catch(() => {});
          }}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(lunasTarget)}
        title="Set Kasbon Lunas"
        danger={false}
        confirmLabel="Tandai Lunas"
        loading={lunasBusy}
        onCancel={() => setLunasTarget(null)}
        onConfirm={doLunas}
      >
        <p style={{ fontSize: '0.9rem', marginBottom: 'var(--space-4)' }}>
          Kasbon {lunasTarget ? formatRupiah(lunasTarget.nominal) : ''} milik {lunasTarget?.pelanggan_nama || 'pelanggan'} akan ditandai lunas.
          Sisa tagihan {lunasTarget ? formatRupiah(sisaBon(lunasTarget)) : ''}. Backend membuat 1 mutasi <span className="num">kasbon_pelunasan</span> (default ke Tunai Laci).
        </p>
        <Field label="Akun penerima pelunasan (opsional)">
          <Select value={lunasAkun} onChange={(e) => setLunasAkun(e.target.value)}>
            <option value="">Default (Tunai Laci)</option>
            {(akun.data?.items || []).map((a) => (
              <option key={a.id} value={a.nama_akun}>{a.nama_akun}</option>
            ))}
          </Select>
        </Field>
      </ConfirmDialog>
    </div>
  );
}

function KasbonForm({ onCancel, onSaved }) {
  const [pelanggan, setPelanggan] = useState([]);
  const [form, setForm] = useState({ pelanggan_id: '', nominal: '', tanggal: todayWIB(), jatuh_tempo: '', catatan: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/pelanggan', { limit: 200 }).then((r) => setPelanggan(r.items || [])).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setNominal = (k) => (e) => setForm((f) => ({ ...f, [k]: formatRupiahInput(e.target.value) }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.pelanggan_id) return setError('Pilih pelanggan.');
    if (!form.nominal || parseRupiah(form.nominal) <= 0) return setError('Nominal wajib diisi.');
    if (!form.tanggal) return setError('Tanggal wajib diisi.');
    setBusy(true);
    try {
      await api.post('/kasbon', {
        pelanggan_id: Number(form.pelanggan_id),
        nominal: parseRupiah(form.nominal),
        tanggal: form.tanggal,
        jatuh_tempo: form.jatuh_tempo || undefined,
        catatan: form.catatan.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Pelanggan" required>
        <Select value={form.pelanggan_id} onChange={set('pelanggan_id')}>
          <option value="">Pilih pelanggan…</option>
          {pelanggan.map((p) => (
            <option key={p.id} value={p.id}>{p.nama}</option>
          ))}
        </Select>
      </Field>
      <div className="grid-2">
        <Field label="Nominal (Rp)" required>
          <Input type="text" inputMode="numeric" value={form.nominal} onChange={setNominal('nominal')} />
        </Field>
        <Field label="Tanggal" required>
          <Input type="date" value={form.tanggal} onChange={set('tanggal')} />
        </Field>
      </div>
      <Field label="Jatuh tempo (opsional)" hint="Target tanggal pelunasan untuk membantu proses nagih.">
        <Input type="date" value={form.jatuh_tempo} onChange={set('jatuh_tempo')} />
      </Field>
      <Field label="Catatan (opsional)">
        <Input type="text" value={form.catatan} onChange={set('catatan')} />
      </Field>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" type="button" onClick={onCancel}>Batal</Button>
        <Button type="submit" loading={busy}>Simpan</Button>
      </div>
    </form>
  );
}