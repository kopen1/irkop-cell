// Laporan Service HP (PRD 5.6).
// Status: Masuk → Proses → Selesai → Diambil. Notifikasi status = manual
// (admin menghubungi), sistem hanya mencatat penanda "belum dihubungi".
// Tidak ada SLA otomatis. Foto kondisi HP opsional.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useDebounce } from '../hooks/useDebounce';
import { formatRupiah, formatDate } from '../lib/format';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Field, Input, Select, Textarea } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { Table } from '../components/ui/Table';
import { Loader, ErrorState, EmptyState } from '../components/ui/States';
import { ServiceStatusBadge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';

const STATUS_FLOW = ['masuk', 'proses', 'selesai', 'diambil'];
const STATUS_LABEL = { masuk: 'Masuk', proses: 'Proses', selesai: 'Selesai', diambil: 'Diambil' };
const LIMIT = 100;

export default function ServiceHpPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 300);
  const [filterStatus, setFilterStatus] = useState('');

  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const load = useMemo(
    () => async () => {
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        const data = await api.get('/service-hp', { q: debouncedQ, status: filterStatus, limit: LIMIT });
        setState({ status: 'success', data, error: null });
        return data;
      } catch (err) {
        setState({ status: 'error', data: null, error: err });
        throw err;
      }
    },
    [debouncedQ, filterStatus]
  );

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [advanceBusy, setAdvanceBusy] = useState(false);
  const [hubungiPending, setHubungiPending] = useState(null);

  const data = state.data || {};
  const rows = (data.items || []).filter((s) => !s.deleted_at).map((s) => ({ ...s, key: s.id }));

  const openDetail = async (s) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await api.get(`/service-hp/${s.id}`);
      setDetail(res.service_hp || res);
    } catch (err) {
      setDetail({ _error: err.message });
    } finally {
      setDetailLoading(false);
    }
  };

  const advance = async (s, target) => {
    setAdvanceBusy(true);
    try {
      await api.put(`/service-hp/${s.id}`, { status: target, sudah_dihubungi: 0 });
      toast.success(`Status ${s.nama_device} → ${STATUS_LABEL[target]}. Ingat menghubungi pelanggan.`);
      setDetailOpen(false);
      load().catch(() => {});
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAdvanceBusy(false);
    }
  };

  const hubungi = async (s) => {
    setHubungiPending(true);
    try {
      await api.put(`/service-hp/${s.id}`, { sudah_dihubungi: 1 });
      toast.success('Ditandai sudah dihubungi.');
      setDetailOpen(false);
      load().catch(() => {});
    } catch (err) {
      toast.error(err.message);
    } finally {
      setHubungiPending(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Laporan Service HP"
        subtitle="Alur status: Masuk → Proses → Selesai → Diambil. Penanda 'belum dihubungi' muncul tiap status berubah."
        actions={
          can('laporan_service_hp') && (
            <Button onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size={16} /> Service Baru
            </Button>
          )
        }
      />

      <div className="filter-bar">
        <Field label="Cari (device / pelanggan)">
          <Input type="search" value={q} placeholder="Nama device atau pelanggan…" onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Field label="Status">
          <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">Semua</option>
            {STATUS_FLOW.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </Select>
        </Field>
      </div>

      {state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={() => load().catch(() => {})} />
      ) : state.status === 'loading' && !data.items ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyState title="Belum ada service HP" description="Catat service pertama yang masuk." icon="service" />
      ) : (
        <Table
          onRowClick={(r) => openDetail(r)}
          columns={[
            { key: 'nama_device', header: 'Device', render: (r) => <span style={{ fontWeight: 600 }}>{r.nama_device}</span> },
            { key: 'pelanggan', header: 'Pelanggan', render: (r) => <span className="text-sm">{r.pelanggan_nama || '-'}</span> },
            { key: 'deskripsi_kerusakan', header: 'Kerusakan', render: (r) => <span className="text-sm">{r.deskripsi_kerusakan}</span> },
            { key: 'status', header: 'Status', render: (r) => <ServiceStatusBadge status={r.status} /> },
            {
              key: 'dihubungi',
              header: 'Hubungi',
              render: (r) => (r.sudah_dihubungi ? <span className="text-sm text-success">Sudah</span> : r.status !== 'masuk' ? <span className="text-sm text-warning">Belum</span> : <span className="text-sm text-muted">—</span>),
            },
            { key: 'tanggal_masuk', header: 'Masuk', render: (r) => <span className="text-xs">{formatDate(r.tanggal_masuk)}</span> },
            { key: 'biaya', header: 'Biaya', align: 'right', render: (r) => <span className="num">{r.biaya ? formatRupiah(r.biaya) : <span className="text-muted">—</span>}</span> },
          ]}
          rows={rows}
        />
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Catat Service HP" size="lg">
        <ServiceForm
          onCancel={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            toast.success('Service HP dicatat.');
            load().catch(() => {});
          }}
        />
      </Modal>

      {/* Detail + action status */}
      <Modal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title="Detail Service HP"
        footer={
          detail && !detail._error && can('laporan_service_hp') && (
            <>
              {detail.sudah_dihubungi === 0 && detail.status !== 'masuk' && (
                <Button variant="secondary" loading={hubungiPending === detail.id} onClick={() => hubungi(detail)}>
                  Tandai Sudah Dihubungi
                </Button>
              )}
              {STATUS_FLOW[STATUS_FLOW.indexOf(detail.status) + 1] && (
                <Button variant="primary" loading={advanceBusy === detail.id} onClick={() => advance(detail, STATUS_FLOW[STATUS_FLOW.indexOf(detail.status) + 1])}>
                  Ubah ke {STATUS_LABEL[STATUS_FLOW[STATUS_FLOW.indexOf(detail.status) + 1]]}
                </Button>
              )}
            </>
          )
        }
      >
        {detailLoading ? (
          <Loader />
        ) : detail?._error ? (
          <ErrorState error={{ message: detail._error }} />
        ) : detail ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span style={{ fontWeight: 700 }}>{detail.nama_device}</span>
              <ServiceStatusBadge status={detail.status} />
            </div>
            <div className="grid-2">
              <div><p className="text-xs text-muted">Pelanggan</p><p className="text-sm">{detail.pelanggan_nama || '-'}</p></div>
              <div><p className="text-xs text-muted">Tanggal masuk</p><p className="text-sm">{formatDate(detail.tanggal_masuk)}</p></div>
              {detail.tanggal_selesai && <div><p className="text-xs text-muted">Selesai</p><p className="text-sm">{formatDate(detail.tanggal_selesai)}</p></div>}
              {detail.tanggal_diambil && <div><p className="text-xs text-muted">Diambil</p><p className="text-sm">{formatDate(detail.tanggal_diambil)}</p></div>}
              <div><p className="text-xs text-muted">Estimasi biaya</p><p className="text-sm num">{detail.estimasi_biaya ? formatRupiah(detail.estimasi_biaya) : '—'}</p></div>
              <div><p className="text-xs text-muted">Biaya final</p><p className="text-sm num">{detail.biaya ? formatRupiah(detail.biaya) : '—'}</p></div>
            </div>
            <div>
              <p className="text-xs text-muted">Kerusakan</p>
              <p className="text-sm">{detail.deskripsi_kerusakan}</p>
            </div>
            {detail.catatan && (
              <div>
                <p className="text-xs text-muted">Catatan</p>
                <p className="text-sm">{detail.catatan}</p>
              </div>
            )}
            {detail.foto_masuk && (
              <div>
                <p className="text-xs text-muted">Foto kondisi saat masuk</p>
                <a href={detail.foto_masuk} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', fontSize: '0.85rem' }}>
                  Buka foto
                </a>
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function ServiceForm({ onCancel, onSaved }) {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ pelanggan_id: '', nama_device: '', deskripsi_kerusakan: '', estimasi_biaya: '', biaya: '', teknisi_id: '', catatan: '', tanggal_masuk: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isAdmin) api.get('/users', { limit: 200 }).then((r) => setUsers(r.items || [])).catch(() => {});
  }, [isAdmin]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.nama_device.trim()) return setError('Nama device wajib diisi.');
    if (!form.deskripsi_kerusakan.trim()) return setError('Deskripsi kerusakan wajib diisi.');
    setBusy(true);
    try {
      await api.post('/service-hp', {
        nama_device: form.nama_device.trim(),
        deskripsi_kerusakan: form.deskripsi_kerusakan.trim(),
        pelanggan_id: form.pelanggan_id ? Number(form.pelanggan_id) : null,
        estimasi_biaya: form.estimasi_biaya ? Number(form.estimasi_biaya) : null,
        biaya: form.biaya ? Number(form.biaya) : null,
        teknisi_id: form.teknisi_id ? Number(form.teknisi_id) : null,
        catatan: form.catatan.trim() || undefined,
        tanggal_masuk: form.tanggal_masuk || undefined,
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
      <div className="grid-2">
        <Field label="Nama device / tipe" required>
          <Input type="text" value={form.nama_device} placeholder="mis. iPhone 11" onChange={set('nama_device')} />
        </Field>
        <Field label="Pelanggan (opsional)">
          <PelangganSelect value={form.pelanggan_id} onChange={set('pelanggan_id')} />
        </Field>
      </div>
      <Field label="Deskripsi kerusakan" required>
        <Textarea value={form.deskripsi_kerusakan} placeholder="mis. LCD pecah, ganti panel" onChange={set('deskripsi_kerusakan')} />
      </Field>
      <div className="grid-2">
        <Field label="Estimasi biaya (Rp, opsional)">
          <Input type="number" inputMode="numeric" value={form.estimasi_biaya} onChange={set('estimasi_biaya')} />
        </Field>
        <Field label="Biaya final (Rp, diisi saat selesai)">
          <Input type="number" inputMode="numeric" value={form.biaya} onChange={set('biaya')} />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Tanggal masuk">
          <Input type="date" value={form.tanggal_masuk} onChange={set('tanggal_masuk')} />
        </Field>
        {isAdmin && (
          <Field label="Teknisi">
            <Select value={form.teknisi_id} onChange={set('teknisi_id')}>
              <option value="">Tanpa teknisi</option>
              {users.filter((u) => u.role === 'karyawan' || u.role === 'admin').map((u) => (
                <option key={u.id} value={u.id}>{u.nama}</option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <Field label="Catatan (opsional)">
        <Textarea value={form.catatan} onChange={set('catatan')} />
      </Field>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" type="button" onClick={onCancel}>Batal</Button>
        <Button type="submit" loading={busy}>Simpan</Button>
      </div>
    </form>
  );
}

function PelangganSelect({ value, onChange }) {
  const [list, setList] = useState([]);
  useEffect(() => {
    api.get('/pelanggan', { limit: 200 }).then((r) => setList(r.items || [])).catch(() => {});
  }, []);
  return (
    <Select value={value} onChange={onChange}>
      <option value="">Tanpa pelanggan</option>
      {list.map((p) => (
        <option key={p.id} value={p.id}>{p.nama}</option>
      ))}
    </Select>
  );
}