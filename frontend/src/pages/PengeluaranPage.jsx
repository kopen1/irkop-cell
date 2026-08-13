// Halaman Pengeluaran (PRD 5.9 / 12.4).
// Form wajib: deskripsi, nominal, metode_bayar, akun_sumber, tanggal, pencatat.
// - Tunai   → 1 mutasi negatif ke akun tunai/laci.
// - Transfer→ 1 mutasi negatif ke akun_sumber.
// Edit/hapus = reload reversal atomik di sisi backend (bukan hard-delete).
import { useEffect, useMemo, useState } from 'react';
import { api, newIdempotencyKey } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { todayWIB, formatRupiah, formatDateTime, formatRupiahInput, parseRupiah } from '../lib/format';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Field, Input, Select } from '../components/ui/Field';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { Table } from '../components/ui/Table';
import { Loader, ErrorState, EmptyState } from '../components/ui/States';
import { Badge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';
import { useAsync } from '../hooks/useAsync';

const LIMIT = 100;

export default function PengeluaranPage() {
  const { can } = useAuth();
  const toast = useToast();
  const akun = useAsync(() => api.get('/akun'), { deps: [] });

  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const load = useMemo(
    () => async () => {
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        const data = await api.get('/pengeluaran', { limit: LIMIT });
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
  const [editItem, setEditItem] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const data = state.data || {};
  const rows = (data.items || [])
    .filter((p) => !p.deleted_at)
    .map((p) => ({ ...p, key: p.id }));

  return (
    <div className="page">
      <PageHeader
        title="Pengeluaran"
        subtitle="Biaya operasional di luar transaksi penjualan. Setiap baris wajib memiliki metode bayar & akun sumber."
        actions={
          can('pengeluaran') && (
            <Button onClick={() => { setEditItem(null); setCreateOpen(true); }}>
              <Icon name="plus" size={16} /> Catat Pengeluaran
            </Button>
          )
        }
      />

      {state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={() => load().catch(() => {})} />
      ) : state.status === 'loading' && !data.items ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Belum ada pengeluaran"
          description="Contoh: LCD iPhone 11 — Rp300.000 — Transfer — SeaBank. Pembelian sparepart tidak otomatis menambah stok."
          icon="pengeluaran"
          action={can('pengeluaran') && <Button onClick={() => setCreateOpen(true)}>Catat Pengeluaran</Button>}
        />
      ) : (
        <Table
          columns={[
            { key: 'deskripsi', header: 'Deskripsi', render: (r) => <span style={{ fontWeight: 600 }}>{r.deskripsi}</span> },
            { key: 'tanggal', header: 'Tanggal', render: (r) => <span className="text-sm">{r.tanggal}</span> },
            { key: 'metode_bayar', header: 'Metode', render: (r) => <Badge tone={r.metode_bayar === 'tunai' ? 'accent' : 'info'}>{r.metode_bayar === 'tunai' ? 'Tunai' : 'Transfer'}</Badge> },
            { key: 'akun_sumber', header: 'Akun Sumber', render: (r) => <span className="text-sm">{r.akun_sumber}</span> },
            { key: 'nominal', header: 'Nominal', align: 'right', render: (r) => <span className="num">{formatRupiah(r.nominal)}</span> },
            { key: 'created_at', header: 'Dicatat', render: (r) => <span className="text-xs text-muted">{formatDateTime(r.created_at)}</span> },
            {
              key: 'aksi',
              header: '',
              align: 'right',
              render: (r) => (
                <div className="row-actions">
                  {can('pengeluaran') && (
                    <>
                      <Button variant="ghost" size="sm" aria-label={`Edit ${r.deskripsi}`} onClick={(e) => { e.stopPropagation(); setEditItem(r); setCreateOpen(true); }}>
                        <Icon name="edit" size={15} />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={`Hapus ${r.deskripsi}`} onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}>
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

      <Modal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setEditItem(null); }}
        title={editItem ? 'Edit Pengeluaran' : 'Catat Pengeluaran'}
        size="lg"
      >
        <PengeluaranForm
          initial={editItem}
          akunList={(akun.data?.items || []).map((a) => a.nama_akun)}
          onCancel={() => { setCreateOpen(false); setEditItem(null); }}
          onSaved={() => {
            setCreateOpen(false);
            setEditItem(null);
            toast.success(editItem ? 'Pengeluaran diperbarui (reversal backend).' : 'Pengeluaran dicatat.');
            load().catch(() => {});
          }}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus Pengeluaran"
        message={`Pengeluaran "${deleteTarget?.deskripsi}" (${formatRupiah(deleteTarget?.nominal)}) akan dihapus soft-delete; backend membuat mutasi reversal secara atomik. Lanjutkan?`}
        confirmLabel="Hapus"
        loading={deleteBusy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          setDeleteBusy(true);
          try {
            await api.del(`/pengeluaran/${deleteTarget.id}`, { deleted_reason: 'dihapus dari halaman Pengeluaran' });
            setDeleteTarget(null);
            toast.success('Pengeluaran dihapus. Mutasi reversal dibuat backend.');
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

function PengeluaranForm({ initial, akunList, onCancel, onSaved }) {
  const [form, setForm] = useState(() => ({
    deskripsi: initial?.deskripsi || '',
    kategori: initial?.kategori || '',
    nominal: initial?.nominal ?? '',
    metode_bayar: initial?.metode_bayar || 'tunai',
    akun_sumber: initial?.akun_sumber || '',
    tanggal: initial?.tanggal || todayWIB(),
    catatan: '',
  }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setNominal = (k) => (e) => setForm((f) => ({ ...f, [k]: formatRupiahInput(e.target.value) }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.deskripsi.trim()) return setError('Deskripsi wajib diisi.');
    if (!form.nominal || parseRupiah(form.nominal) <= 0) return setError('Nominal wajib diisi (lebih dari 0).');
    if (!form.tanggal) return setError('Tanggal wajib diisi.');
    if (!form.akun_sumber) return setError('Akun sumber wajib dipilih.');

    setBusy(true);
    try {
      const body = {
        deskripsi: form.deskripsi.trim(),
        kategori: form.kategori.trim() || undefined,
        nominal: parseRupiah(form.nominal),
        metode_bayar: form.metode_bayar,
        akun_sumber: form.akun_sumber,
        tanggal: form.tanggal,
      };
      if (initial?.id) await api.put(`/pengeluaran/${initial.id}`, body);
      else await api.post('/pengeluaran', body, newIdempotencyKey());
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="flex flex-col gap-4">
        <Field label="Deskripsi" required>
          <Input type="text" value={form.deskripsi} placeholder="mis. Beli sparepart LCD iPhone 11" onChange={set('deskripsi')} />
        </Field>
        <div className="grid-2">
          <Field label="Nominal (Rp)" required>
            <Input type="text" inputMode="numeric" value={form.nominal} placeholder="mis. 300.000" onChange={setNominal('nominal')} />
          </Field>
          <Field label="Kategori (opsional)">
            <Input type="text" value={form.kategori} placeholder="mis. sparepart, listrik, sewa…" onChange={set('kategori')} />
          </Field>
          <Field label="Metode bayar" required hint="Tunai → akun tunai/laci; Transfer → akun sumber terpilih.">
            <Select value={form.metode_bayar} onChange={set('metode_bayar')}>
              <option value="tunai">Tunai</option>
              <option value="transfer">Transfer</option>
            </Select>
          </Field>
          <Field label="Akun sumber" required>
            <Select value={form.akun_sumber} onChange={set('akun_sumber')}>
              <option value="">Pilih akun…</option>
              {akunList.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tanggal" required>
            <Input type="date" value={form.tanggal} onChange={set('tanggal')} />
          </Field>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onCancel}>Batal</Button>
          <Button type="submit" loading={busy}>{initial?.id ? 'Simpan Perubahan' : 'Simpan'}</Button>
        </div>
      </div>
    </form>
  );
}