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

// API Kontak (navigator.contacts) hanya tersedia di browser/HTTPS tertentu.
const contactsAvailable = typeof navigator !== 'undefined' && !!navigator.contacts && typeof navigator.contacts.select === 'function';

function normalizeTel(value) {
  return String(value || '').replace(/\D/g, '');
}

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

  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState('pick');
  const [importForm, setImportForm] = useState({ nama: '', telepon: '' });
  const [importError, setImportError] = useState(null);
  const [importBusy, setImportBusy] = useState(false);

  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ nama: '', telepon: '' });
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState(null);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (editTarget) setEditForm({ nama: editTarget.nama || '', telepon: editTarget.telepon || '' });
  }, [editTarget]);

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

  // Pilih kontak via Contacts API → prefill form (nama/nomor) → edit → simpan.
  const openImport = async () => {
    setImportOpen(true);
    setImportError(null);
    setImportForm({ nama: '', telepon: '' });
    if (!contactsAvailable) {
      setImportStep('unavailable');
      return;
    }
    setImportStep('pick');
    try {
      const picked = await navigator.contacts.select(['name', 'tel'], { multiple: false });
      const c = picked[0] || {};
      const nama = String(c.name || '').trim();
      const tel = String(Array.isArray(c.tel) ? c.tel[0] : c.tel || '').trim();
      setImportForm({ nama, telepon: tel });
      const existing = rows.find((p) => p.telepon && normalizeTel(p.telepon) === normalizeTel(tel));
      if (tel && existing) {
        setImportError(`Nomor "${tel}" sudah terdaftar atas nama "${existing.nama}". Tidak disimpan duplikat — ubah nomor atau gabungkan pelanggan yang ada.`);
      } else {
        setImportError(null);
      }
      setImportStep('edit');
    } catch (err) {
      if (err && err.name === 'NotAllowedError') {
        setImportError('Izin kontak ditolak. Beri akses kontak di pengaturan browser, atau tambahkan pelanggan secara manual.');
      } else {
        setImportError(`Gagal membaca kontak: ${err?.message || 'kesalahan tidak diketahui'}. Tambahkan pelanggan secara manual.`);
      }
      setImportStep('edit');
    }
  };

  const doImport = async (e) => {
    e.preventDefault();
    setImportError(null);
    if (!importForm.nama.trim()) return setImportError('Nama wajib diisi.');
    const tel = importForm.telepon.trim();
    if (tel) {
      const existing = rows.find((p) => p.telepon && normalizeTel(p.telepon) === normalizeTel(tel));
      if (existing) {
        return setImportError(`Nomor "${tel}" sudah terdaftar atas nama "${existing.nama}". Tidak disimpan duplikat.`);
      }
    }
    setImportBusy(true);
    try {
      await api.post('/pelanggan', { nama: importForm.nama.trim(), telepon: tel || undefined });
      toast.success('Pelanggan dari kontak disimpan.');
      setImportOpen(false);
      setImportStep('pick');
      setImportForm({ nama: '', telepon: '' });
      load().catch(() => {});
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImportBusy(false);
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
              <Button
                variant="secondary"
                onClick={openImport}
                disabled={!contactsAvailable}
                title={contactsAvailable ? 'Import kontak perangkat (nama & nomor)' : 'Device/browser ini tidak mendukung API Kontak (navigator.contacts). Tambahkan pelanggan secara manual.'}
              >
                <Icon name="download" size={16} /> Import Kontak
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
      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title="Detail Pelanggan"
        footer={detail && !detail._error && can('pelanggan') ? (
          <>
            <Button variant="danger" size="sm" onClick={() => { setDeleteTarget(detail); setDetailOpen(false); }}>
              <Icon name="trash" size={14} /> Hapus
            </Button>
            <Button variant="secondary" size="sm" onClick={() => { setEditTarget(detail); setDetailOpen(false); }}>
              <Icon name="edit" size={14} /> Edit
            </Button>
          </>
        ) : null}
      >
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

      {/* Import Kontak */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import Kontak">
        {importStep === 'unavailable' ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-secondary">
              Device/browser ini tidak mendukung API Kontak (<span className="num">navigator.contacts</span>).
              Kontak hanya bisa diimpor di browser yang mendukung Contacts API (mis. Android Chrome via HTTPS).
            </p>
            <p className="text-sm text-secondary">Gunakan tombol "Tambah Pelanggan" untuk mencatat pelanggan secara manual.</p>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setImportOpen(false)}>Tutup</Button>
            </div>
          </div>
        ) : importStep === 'pick' ? (
          <div className="flex items-center gap-3">
            <Loader />
            <span className="text-sm text-secondary">Memilih kontak…</span>
          </div>
        ) : (
          <form onSubmit={doImport} className="flex flex-col gap-4">
            <p className="text-sm text-secondary">
              Data kontak sudah diisi otomatis. Periksa/edit sebelum disimpan.
            </p>
            <Field label="Nama" required>
              <Input type="text" value={importForm.nama} onChange={(e) => setImportForm((f) => ({ ...f, nama: e.target.value }))} />
            </Field>
            <Field label="Telepon / nomor (opsional)">
              <Input type="tel" value={importForm.telepon} onChange={(e) => setImportForm((f) => ({ ...f, telepon: e.target.value }))} />
            </Field>
            {importError && <p className="field-error" role="alert">{importError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setImportOpen(false)}>Batal</Button>
              <Button type="submit" loading={importBusy}>Simpan</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Edit Pelanggan */}
      <Modal open={Boolean(editTarget)} onClose={() => setEditTarget(null)} title="Edit Pelanggan">
        <form onSubmit={async (e) => {
          e.preventDefault();
          setEditError(null);
          if (!editForm.nama.trim()) return setEditError('Nama wajib diisi.');
          setEditBusy(true);
          try {
            await api.put(`/pelanggan/${editTarget.id}`, { nama: editForm.nama.trim(), telepon: editForm.telepon.trim() || undefined });
            toast.success('Pelanggan diperbarui.');
            setEditTarget(null);
            load().catch(() => {});
          } catch (err) {
            setEditError(err.message);
          } finally {
            setEditBusy(false);
          }
        }} className="flex flex-col gap-4">
          <Field label="Nama" required>
            <Input type="text" value={editForm.nama} onChange={(e) => setEditForm((f) => ({ ...f, nama: e.target.value }))} />
          </Field>
          <Field label="Telepon">
            <Input type="tel" value={editForm.telepon} onChange={(e) => setEditForm((f) => ({ ...f, telepon: e.target.value }))} />
          </Field>
          {editError && <p className="field-error" role="alert">{editError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => setEditTarget(null)}>Batal</Button>
            <Button type="submit" loading={editBusy}>Simpan</Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirm */}
      <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="Hapus Pelanggan"
        footer={<>
          <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>Batal</Button>
          <Button variant="danger" onClick={async () => {
            setDeleteBusy(true);
            try {
              await api.del(`/pelanggan/${deleteTarget.id}`);
              toast.success('Pelanggan dihapus.');
              setDeleteTarget(null);
              load().catch(() => {});
            } catch (err) {
              toast.error(err.message);
            } finally {
              setDeleteBusy(false);
            }
          }} loading={deleteBusy}>Hapus</Button>
        </>}
      >
        <p className="text-sm">Hapus pelanggan <b>{deleteTarget?.nama}</b>? Data ini tidak bisa dikembalikan.</p>
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