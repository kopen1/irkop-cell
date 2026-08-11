// Halaman Pelanggan (PRD 5.8): list+ranking, tambah, detail (riwayat, alias,
// kasbon), gabung manual (merge). Tujuan utama ranking pelanggan setia.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useDebounce } from '../hooks/useDebounce';
import { formatRupiah, formatDateTime } from '../lib/format';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Field, Input, Select } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { Table } from '../components/ui/Table';
import { Loader, ErrorState, EmptyState } from '../components/ui/States';
import { Badge, PelunasanBadge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';

const LIMIT = 100;

export default function PelangganPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 300);

  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const load = useMemo(
    () => async () => {
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        const data = await api.get('/pelanggan', { q: debouncedQ, limit: LIMIT });
        setState({ status: 'success', data, error: null });
        return data;
      } catch (err) {
        setState({ status: 'error', data: null, error: err });
        throw err;
      }
    },
    [debouncedQ]
  );

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSel, setMergeSel] = useState({ a: '', b: '' });
  const [mergeBusy, setMergeBusy] = useState(false);

  const data = state.data || {};
  const rows = (data.items || []).map((p) => ({ ...p, key: p.id }));

  const openDetail = async (p) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await api.get(`/pelanggan/${p.id}`);
      setDetail(res.pelanggan || res);
    } catch (err) {
      setDetail({ _error: err.message });
    } finally {
      setDetailLoading(false);
    }
  };

  const doMerge = async () => {
    if (!mergeSel.a || !mergeSel.b || mergeSel.a === mergeSel.b) {
      toast.warning('Pilih dua pelanggan berbeda untuk digabung.');
      return;
    }
    setMergeBusy(true);
    try {
      await api.post('/pelanggan/merge', { dari_id: Number(mergeSel.a), ke_id: Number(mergeSel.b) });
      toast.success('Pelanggan digabung (history tetap tersimpan).');
      setMergeOpen(false);
      setMergeSel({ a: '', b: '' });
      load().catch(() => {});
    } catch (err) {
      toast.error(err.message);
    } finally {
      setMergeBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Pelanggan"
        subtitle="Ranking pelanggan setia berdasarkan total belanja & frekuensi. Transaksi tanpa pelanggan masuk baris Umum (informasi)."
        actions={
          can('pelanggan') && (
            <>
              <Button variant="secondary" onClick={() => setMergeOpen(true)}>
                <Icon name="eye" size={16} /> Gabungkan
              </Button>
              <Button onClick={() => setCreateOpen(true)}>
                <Icon name="plus" size={16} /> Tambah Pelanggan
              </Button>
            </>
          )
        }
      />

      <div className="filter-bar">
        <Field label="Cari pelanggan">
          <Input type="search" value={q} placeholder="Nama / nomor HP…" onChange={(e) => setQ(e.target.value)} />
        </Field>
      </div>

      {state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={() => load().catch(() => {})} />
      ) : state.status === 'loading' && !data.items ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyState title="Belum ada pelanggan" description="Tambahkan pelanggan atau transaksi akan berjalan sebagai Umum/Tanpa Nama." icon="pelanggan" />
      ) : (
        <Table
          onRowClick={(r) => openDetail(r)}
          columns={[
            { key: 'nama', header: 'Nama', render: (r) => <span style={{ fontWeight: 600 }}>{r.nama}</span> },
            { key: 'telepon', header: 'Telepon', render: (r) => <span className="text-sm">{r.telepon || <span className="text-muted">—</span>}</span> },
            { key: 'total_belanja', header: 'Total Belanja', align: 'right', render: (r) => <span className="num">{formatRupiah(r.total_belanja)}</span> },
            { key: 'frekuensi_transaksi', header: 'Frekuensi', align: 'right', render: (r) => <span className="num">{r.frekuensi_transaksi}</span> },
            {
              key: 'alias',
              header: 'Alias',
              render: (r) =>
                r.alias_count ? <Badge tone="info">{r.alias_count} alias</Badge> : <span className="text-muted">—</span>,
            },
          ]}
          rows={rows}
        />
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Tambah Pelanggan">
        <PelangganForm
          onCancel={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            toast.success('Pelanggan ditambahkan.');
            load().catch(() => {});
          }}
        />
      </Modal>

      {/* Detail */}
      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title="Detail Pelanggan">
        {detailLoading ? (
          <Loader />
        ) : detail?._error ? (
          <ErrorState error={{ message: detail._error }} />
        ) : detail ? (
          <div className="flex flex-col gap-4">
            <div className="grid-2">
              <div><p className="text-xs text-muted">Nama</p><p className="font-bold">{detail.nama}</p></div>
              <div><p className="text-xs text-muted">Telepon</p><p className="text-sm">{detail.telepon || '—'}</p></div>
              <div><p className="text-xs text-muted">Total belanja</p><p className="num">{formatRupiah(detail.total_belanja)}</p></div>
              <div><p className="text-xs text-muted">Frekuensi transaksi</p><p className="num">{detail.frekuensi_transaksi}</p></div>
            </div>

            <section>
              <h4 className="card-title-sm mb-2">Alias / nomor</h4>
              {detail.alias?.length ? (
                <ul className="flex flex-col gap-1" style={{ fontSize: '0.85rem' }}>
                  {detail.alias.map((a, i) => (
                    <li key={i}>
                      <Badge tone={a.sumber === 'notifhook_auto' ? 'info' : 'neutral'}>{a.tipe}</Badge>{' '}
                      {a.nilai} <span className="text-muted text-xs">({a.sumber === 'notifhook_auto' ? 'auto NotifHook' : 'manual'})</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Belum ada alias.</p>
              )}
            </section>

            <section>
              <h4 className="card-title-sm mb-2">Kasbon</h4>
              {detail.kasbon?.length ? (
                <Table
                  columns={[
                    { key: 'nominal', header: 'Nominal', render: (r) => <span className="num text-sm">{formatRupiah(r.nominal)}</span> },
                    { key: 'tanggal', header: 'Tanggal', render: (r) => <span className="text-xs">{r.tanggal}</span> },
                    { key: 'status', header: 'Status', render: (r) => <PelunasanBadge status={r.status} /> },
                  ]}
                  rows={detail.kasbon.map((k) => ({ ...k, key: k.id }))}
                />
              ) : (
                <p className="text-sm text-muted">Tidak ada kasbon.</p>
              )}
            </section>

            <section>
              <h4 className="card-title-sm mb-2">Riwayat transaksi</h4>
              {detail.riwayat?.length ? (
                <Table
                  columns={[
                    { key: 'id', header: 'ID', render: (r) => <span className="num text-sm">{r.id}</span> },
                    { key: 'created_at', header: 'Waktu', render: (r) => <span className="text-xs">{formatDateTime(r.created_at)}</span> },
                    { key: 'total', header: 'Total', render: (r) => <span className="num text-sm">{formatRupiah(r.total)}</span> },
                  ]}
                  rows={detail.riwayat.map((t) => ({ ...t, key: t.id }))}
                />
              ) : (
                <p className="text-sm text-muted">Belum ada riwayat.</p>
              )}
            </section>
          </div>
        ) : null}
      </Modal>

      {/* Merge */}
      <Modal open={mergeOpen} onClose={() => setMergeOpen(false)} title="Gabungkan Pelanggan" footer={
        <>
          <Button variant="secondary" onClick={() => setMergeOpen(false)}>Batal</Button>
          <Button onClick={doMerge} loading={mergeBusy}>Gabungkan</Button>
        </>
      }>
        <p className="text-sm text-secondary mb-4">
          Data dari pelanggan pertama akan diarahkan ke pelanggan kedua. Riwayat gabungan (alias) tetap tersimpan, tidak menimpa data lama (PRD 5.8).
        </p>
        <div className="flex flex-col gap-3">
          <Field label="Pelanggan sumber (digabungkan ke yang lain)">
            <Select value={mergeSel.a} onChange={(e) => setMergeSel((s) => ({ ...s, a: e.target.value }))}>
              <option value="">Pilih pelanggan…</option>
              {rows.map((p) => <option key={p.id} value={p.id}>{p.nama}</option>)}
            </Select>
          </Field>
          <Field label="Pelanggan tujuan (data ini dipertahankan)">
            <Select value={mergeSel.b} onChange={(e) => setMergeSel((s) => ({ ...s, b: e.target.value }))}>
              <option value="">Pilih pelanggan…</option>
              {rows.map((p) => <option key={p.id} value={p.id}>{p.nama}</option>)}
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function PelangganForm({ onCancel, onSaved }) {
  const [form, setForm] = useState({ nama: '', telepon: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.nama.trim()) return setError('Nama wajib diisi.');
    setBusy(true);
    try {
      await api.post('/pelanggan', { nama: form.nama.trim(), telepon: form.telepon.trim() || undefined });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Nama" required>
        <Input type="text" value={form.nama} onChange={(e) => setForm((f) => ({ ...f, nama: e.target.value }))} />
      </Field>
      <Field label="Telepon / nomor (opsional)" hint="Nomor HP/rekening bisa jadi alias untuk mencocokan via NotifHook.">
        <Input type="tel" value={form.telepon} onChange={(e) => setForm((f) => ({ ...f, telepon: e.target.value }))} />
      </Field>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" type="button" onClick={onCancel}>Batal</Button>
        <Button type="submit" loading={busy}>Simpan</Button>
      </div>
    </form>
  );
}