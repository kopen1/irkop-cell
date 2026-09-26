// Halaman form produk (tambah / edit) — dipisah dari DaftarBarangPage agar rapi.
// Menerima :id untuk edit; tanpa :id = tambah baru.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { invalidateProdukCache } from '../hooks/useProdukCache';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Field, Input, Select } from '../components/ui/Field';
import { ConfirmDialog } from '../components/ui/Modal';
import { Loader, ErrorState } from '../components/ui/States';
import { Icon } from '../components/ui/Icon';
import { formatRupiah, formatRupiahInput, parseRupiah } from '../lib/format';

export default function ProdukFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isEdit = Boolean(id);

  const [kategoriList, setKategoriList] = useState([]);
  const [initial, setInitial] = useState(null);
  const [state, setState] = useState({ status: 'idle', error: null });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setState({ status: 'loading', error: null });
      try {
        const kat = await api.get('/kategori');
        if (!alive) return;
        setKategoriList(kat.items || []);
        if (isEdit) {
          const res = await api.get(`/produk/${id}`);
          if (!alive) return;
          setInitial(res.item);
        }
        if (alive) setState({ status: 'success', error: null });
      } catch (err) {
        if (alive) setState({ status: 'error', error: err });
      }
    };
    run();
    return () => { alive = false; };
  }, [id, isEdit]);

  const handleDelete = async () => {
    setDeleteBusy(true);
    try {
      await api.del(`/produk/${id}`, { deleted_reason: 'dihapus dari Daftar Barang' });
      invalidateProdukCache();
      toast.success('Produk dihapus.');
      navigate('/daftar-barang');
    } catch (err) {
      toast.error(err.message);
      setDeleteBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={isEdit ? 'Edit Produk' : 'Tambah Produk'}
        subtitle={isEdit ? initial?.kode : 'Isi data produk baru. Kategori non-stok tidak memakai field stok.'}
        actions={
          <div className="page-actions-desktop">
            <Button variant="secondary" onClick={() => navigate('/daftar-barang')}>
              <Icon name="close" size={16} /> Kembali
            </Button>
          </div>
        }
      />

      {state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={() => navigate('/daftar-barang')} />
      ) : state.status === 'loading' ? (
        <Loader />
      ) : (
        <div className="form-page">
          <div className="form-page-card">
            <ProductForm
              initial={initial}
              kategoriList={kategoriList}
              onCancel={() => navigate('/daftar-barang')}
              onSaved={() => {
                invalidateProdukCache();
                toast.success(isEdit ? 'Produk diperbarui.' : 'Produk ditambahkan.');
                navigate('/daftar-barang');
              }}
            />
          </div>
          {isEdit && (
            <div className="form-page-danger">
              <Button variant="ghost" onClick={() => setDeleteOpen(true)} style={{ color: 'var(--danger)' }}>
                <Icon name="trash" size={16} /> Hapus Produk
              </Button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="Hapus Produk"
        message={`Produk "${initial?.nama}" akan dihapus secara soft-delete. Lanjutkan?`}
        confirmLabel="Hapus"
        loading={deleteBusy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
}

function ProductForm({ initial, kategoriList, onCancel, onSaved }) {
  const [form, setForm] = useState(() => ({
    kode: initial?.kode || '',
    nama: initial?.nama || '',
    kategori_id: initial?.kategori_id ?? '',
    harga: initial?.harga != null ? formatRupiahInput(String(initial.harga)) : '',
    harga_modal: initial?.harga_modal != null ? formatRupiahInput(String(initial.harga_modal)) : '',
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

  const labaForm = (parseRupiah(form.harga) || 0) - (parseRupiah(form.harga_modal) || 0);

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
          <Field label="Laba (otomatis)" hint="Harga jual − modal. Tidak disimpan terpisah.">
            <span className={`num font-bold ${labaForm < 0 ? 'text-danger' : labaForm === 0 ? 'text-warning' : 'text-success'}`}>
              {formatRupiah(labaForm)}
            </span>
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
