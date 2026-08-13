// Halaman Daftar Barang (PRD 5.5).
// - CRUD produk (POST/PUT/DELETE /api/produk).
// - Kategori: GET/POST (contract Team 1 belum menyediakan PUT/DELETE kategori;
//   sesuai aturan, UI tidak menawarkan tombol tanpa endpoint backend).
// - Kategori non-stok (lacak_stok=0) → produk tidak punya field stok (PRD 5.5).
// - stok_minimum → alert stok <= ambang.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useAsync } from '../hooks/useAsync';
import { useDebounce } from '../hooks/useDebounce';
import { formatRupiah, formatRupiahInput, parseRupiah } from '../lib/format';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Field, Input, Select } from '../components/ui/Field';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { Table } from '../components/ui/Table';
import { Loader, ErrorState, EmptyState } from '../components/ui/States';
import { Badge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';

const LIMIT = 100;

export default function DaftarBarangPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 300);

  const kategori = useAsync(() => api.get('/kategori'), { deps: [] });
  const [state, setState] = useState({ status: 'idle', data: null, error: null });

  const load = useMemo(
    () => async () => {
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        const data = await api.get('/produk', { q: debouncedQ, limit: LIMIT });
        setState({ status: 'success', data, error: null });
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
  const [editItem, setEditItem] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [kategoriOpen, setKategoriOpen] = useState(false);

  const data = state.data || {};
  const rows = (data.items || []).map((p) => ({ ...p, key: p.id }));
  const kategoriList = kategori.data?.items || [];
  const kategoriById = useMemo(
    () => Object.fromEntries((kategori.data?.items || []).map((k) => [k.id, k])),
    [kategori.data]
  );
  const lowStock = rows.filter((p) => p.lacak_stok !== 0 && p.stok_minimum > 0 && p.stok <= p.stok_minimum);

  return (
    <div className="page">
      <PageHeader
        title="Daftar Barang"
        subtitle="Kelola produk & kategori. Kategori non-stok (pulsa/saldo digital) tidak menampilkan field stok."
        actions={
          can('daftar_barang') && (
            <>
              <Button variant="secondary" onClick={() => setKategoriOpen(true)}>
                <Icon name="plus" size={16} /> Tambah Kategori
              </Button>
              <Button onClick={() => { setEditItem(null); setCreateOpen(true); }}>
                <Icon name="plus" size={16} /> Tambah Produk
              </Button>
            </>
          )
        }
      />

      {lowStock.length > 0 && (
        <div className="mb-3 flex items-center gap-2" style={{ padding: 'var(--space-3) var(--space-4)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-sm)', background: 'var(--warning-soft)' }}>
          <Icon name="alert" size={16} />
          <span className="text-sm">{lowStock.length} produk pada/bawah stok minimum:</span>
          <strong className="text-sm">{lowStock.slice(0, 3).map((p) => p.nama).join(', ')}{lowStock.length > 3 ? '…' : ''}</strong>
        </div>
      )}

      <div className="filter-bar">
        <Field label="Cari produk (kode / nama)">
          <Input type="search" value={q} placeholder="Ketik kode atau nama…" onChange={(e) => setQ(e.target.value)} />
        </Field>
      </div>

      {state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={() => load().catch(() => {})} />
      ) : state.status === 'loading' && !data.items ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyState title="Belum ada produk" description="Tambahkan produk pertama untuk mulai menjual." icon="barang" />
      ) : (
        <Table
          columns={[
            { key: 'kode', header: 'Kode', render: (r) => <span className="num text-sm">{r.kode}</span> },
            { key: 'nama', header: 'Nama' },
            {
              key: 'kategori_id',
              header: 'Kategori',
              render: (r) => {
                const k = kategoriById[r.kategori_id];
                return k ? (
                  <Badge tone="neutral">
                    {k.nama}
                    {!k.lacak_stok && <span> · non-stok</span>}
                  </Badge>
                ) : (
                  <span className="text-muted">—</span>
                );
              },
            },
            { key: 'harga', header: 'Harga Jual', align: 'right', render: (r) => <span className="num">{formatRupiah(r.harga)}</span> },
            {
              key: 'stok',
              header: 'Stok',
              align: 'right',
              render: (r) =>
                r.lacak_stok === 0 ? (
                  <span className="text-muted">—</span>
                ) : (
                  <span className={`num ${r.stok_minimum > 0 && r.stok <= r.stok_minimum ? 'text-warning font-bold' : ''}`}>
                    {r.stok}
                    {r.stok_minimum > 0 && <span className="text-xs text-muted"> / min {r.stok_minimum}</span>}
                  </span>
                ),
            },
            {
              key: 'aksi',
              header: '',
              align: 'right',
              render: (r) => (
                <div className="row-actions">
                  {can('daftar_barang') && (
                    <>
                      <Button variant="ghost" size="sm" aria-label={`Edit ${r.nama}`} onClick={(e) => { e.stopPropagation(); setEditItem(r); setCreateOpen(true); }}>
                        <Icon name="edit" size={15} />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={`Hapus ${r.nama}`} onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}>
                        <Icon name="trash" size={15} />
                      </Button>
                    </>
                  )}
                </div>
              ),
            },
          ]}
          rows={rows}
        />
      )}

      {/* Form kategori (GET/POST saja sesuai contract) */}
      <Modal open={kategoriOpen} onClose={() => setKategoriOpen(false)} title="Kategori Produk">
        <div className="flex flex-col gap-4">
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Lacak Stok</th>
                </tr>
              </thead>
              <tbody>
                {kategoriList.map((k) => (
                  <tr key={k.id}>
                    <td>{k.nama}</td>
                    <td>{k.lacak_stok ? <Badge tone="success">Ya</Badge> : <Badge tone="neutral">Tidak</Badge>}</td>
                  </tr>
                ))}
                {kategoriList.length === 0 && (
                  <tr><td colSpan={2} className="text-muted">Belum ada kategori.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <KategoriForm
            onSaved={() => {
              setKategoriOpen(false);
              kategori.run();
              toast.success('Kategori ditambahkan.');
            }}
          />
        </div>
      </Modal>

      {/* Form produk */}
      <Modal open={createOpen} onClose={() => { setCreateOpen(false); setEditItem(null); }} title={editItem ? 'Edit Produk' : 'Tambah Produk'} size="lg">
        <ProductForm
          initial={editItem}
          kategoriList={kategoriList}
          onCancel={() => { setCreateOpen(false); setEditItem(null); }}
          onSaved={() => {
            setCreateOpen(false);
            setEditItem(null);
            toast.success(editItem ? 'Produk diperbarui.' : 'Produk ditambahkan.');
            load().catch(() => {});
          }}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus Produk"
        message={`Produk "${deleteTarget?.nama}" akan dihapus secara soft-delete. Lanjutkan?`}
        confirmLabel="Hapus"
        loading={deleteBusy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          setDeleteBusy(true);
          try {
            await api.del(`/produk/${deleteTarget.id}`, { deleted_reason: 'dihapus dari Daftar Barang' });
            setDeleteTarget(null);
            toast.success('Produk dihapus.');
            load().catch(() => {});
          } catch (err) {
            toast.error(err.message);
          } finally {
            setDeleteBusy(false);
          }
        }}
      />
    </div>
  );
}

function KategoriForm({ onSaved }) {
  const [nama, setNama] = useState('');
  const [lacakStok, setLacakStok] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!nama.trim()) return setError('Nama kategori wajib diisi.');
    setBusy(true);
    try {
      await api.post('/kategori', { nama: nama.trim(), lacak_stok: lacakStok ? 1 : 0 });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex gap-2" style={{ alignItems: 'flex-end' }}>
      <div style={{ flex: 1 }}>
        <Field label="Nama kategori" required>
          <Input type="text" value={nama} placeholder="mis. Pulsa & Saldo" onChange={(e) => setNama(e.target.value)} />
        </Field>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={lacakStok} onChange={(e) => setLacakStok(e.target.checked)} />
          Lacak stok (nonaktif untuk kategori saldo/digital seperti pulsa, token)
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
      <Button type="submit" loading={busy}>Tambah</Button>
    </form>
  );
}

function ProductForm({ initial, kategoriList, onCancel, onSaved }) {
  const [form, setForm] = useState(() => ({
    kode: initial?.kode || '',
    nama: initial?.nama || '',
    kategori_id: initial?.kategori_id ?? '',
    harga: initial?.harga ?? '',
    harga_modal: initial?.harga_modal ?? '',
    stok: initial?.stok ?? '',
    stok_minimum: initial?.stok_minimum ?? '',
    satuan: initial?.satuan || 'pcs',
  }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setNominal = (k) => (e) => setForm((f) => ({ ...f, [k]: formatRupiahInput(e.target.value) }));
  const kategori = kategoriList.find((k) => String(k.id) === String(form.kategori_id));
  const nonStok = Boolean(kategori && !kategori.lacak_stok);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.kode.trim()) return setError('Kode produk wajib diisi.');
    if (!form.nama.trim()) return setError('Nama produk wajib diisi.');
    if (!form.harga || parseRupiah(form.harga) <= 0) return setError('Harga jual wajib diisi (lebih dari 0).');

    const body = {
      kode: form.kode.trim(),
      nama: form.nama.trim(),
      kategori_id: form.kategori_id ? Number(form.kategori_id) : null,
      harga: parseRupiah(form.harga),
      harga_modal: form.harga_modal ? parseRupiah(form.harga_modal) : null,
      satuan: form.satuan || 'pcs',
      ...(!nonStok
        ? { stok: Number(form.stok) || 0, stok_minimum: Number(form.stok_minimum) || 0 }
        : { lacak_stok: 0 }),
    };

    setBusy(true);
    try {
      if (initial?.id) await api.put(`/produk/${initial.id}`, body);
      else await api.post('/produk', body);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="flex flex-col gap-4">
        <div className="grid-2">
          <Field label="Kode produk" required>
            <Input type="text" value={form.kode} onChange={set('kode')} placeholder="mis. PLS-001" />
          </Field>
          <Field label="Nama" required>
            <Input type="text" value={form.nama} onChange={set('nama')} />
          </Field>
          <Field label="Kategori">
            <Select value={form.kategori_id} onChange={set('kategori_id')}>
              <option value="">Tanpa kategori</option>
              {kategoriList.map((k) => (
                <option key={k.id} value={k.id}>{k.nama}{!k.lacak_stok ? ' (non-stok)' : ''}</option>
              ))}
            </Select>
          </Field>
          <Field label="Satuan">
            <Input type="text" value={form.satuan} onChange={set('satuan')} />
          </Field>
          <Field label="Harga jual (Rp)" required>
            <Input type="text" inputMode="numeric" value={form.harga} onChange={setNominal('harga')} />
          </Field>
          <Field label="Harga modal (Rp, opsional)" hint="Dipakai menghitung laba di Laporan.">
            <Input type="text" inputMode="numeric" value={form.harga_modal} onChange={setNominal('harga_modal')} />
          </Field>
        </div>

        {nonStok ? (
          <p className="text-sm text-muted">
            Kategori <strong>{kategori.nama}</strong> tidak melacak stok — field stok disembunyikan (PRD 5.5).
          </p>
        ) : (
          <div className="grid-2">
            <Field label="Stok">
              <Input type="number" inputMode="numeric" value={form.stok} onChange={set('stok')} />
            </Field>
            <Field label="Stok minimum (alert)" hint="Peringatan saat stok sudah ≤ ambang ini. 0 = tanpa alert.">
              <Input type="number" inputMode="numeric" value={form.stok_minimum} onChange={set('stok_minimum')} />
            </Field>
          </div>
        )}

        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onCancel}>Batal</Button>
          <Button type="submit" loading={busy}>{initial?.id ? 'Simpan Perubahan' : 'Simpan'}</Button>
        </div>
      </div>
    </form>
  );
}