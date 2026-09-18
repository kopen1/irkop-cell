// Halaman Beli Stok — inject stok voucher/aksesoris. BUKAN penjualan & bukan
// biaya operasional: memindahkan nilai dari akun uang sumber (mis. OrderKuota)
// ke stok fisik. Akun sumber berkurang, stok bertambah, harga_modal diperbarui.
import { useEffect, useMemo, useState } from 'react';
import { api, newIdempotencyKey } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { todayWIB, formatRupiah, formatDateTime, formatRupiahInput, parseRupiah } from '../lib/format';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Field, Input, Select } from '../components/ui/Field';
import { ConfirmDialog } from '../components/ui/Modal';
import { Table } from '../components/ui/Table';
import { Loader, ErrorState, EmptyState } from '../components/ui/States';
import { Icon } from '../components/ui/Icon';
import { useAsync } from '../hooks/useAsync';

const LIMIT = 100;

export default function BeliStokPage() {
  const { can } = useAuth();
  const toast = useToast();
  const akun = useAsync(() => api.get('/akun'), { deps: [] });
  const produk = useAsync(() => api.get('/produk', { limit: 500 }), { deps: [] });
  const kasir = useAsync(() => api.get('/kasir/current'), { deps: [] });
  const akunList = useMemo(() => akun.data?.items || [], [akun.data]);
  const produkList = useMemo(
    () => (produk.data?.items || []).filter((p) => !p.deleted_at && Number(p.kategori_lacak_stok || 0) === 1),
    [produk.data]
  );

  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const load = useMemo(
    () => async () => {
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        const data = await api.get('/pembelian-stok', { limit: LIMIT });
        setState({ status: 'success', data, error: null });
        return data;
      } catch (err) {
        setState({ status: 'error', data: null, error: err });
        throw err;
      }
    },
    []
  );
  useEffect(() => { load().catch(() => {}); }, [load]);

  const saldoOf = (nama) => {
    const s = (kasir.data?.saldo || []).find((x) => x.nama_akun === nama);
    return s ? s.saldo_sistem : null;
  };
  // Saldo "live": ambil ulang tiap 15 detik selama halaman terbuka.
  const kasirRun = kasir.run;
  useEffect(() => {
    const t = setInterval(() => { kasirRun().catch(() => {}); }, 15000);
    return () => clearInterval(t);
  }, [kasirRun]);

  const [form, setForm] = useState({ akun_sumber: '', tanggal: todayWIB(), catatan: '' });
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState('');
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const hasil = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return produkList.filter((p) => (p.kode || '').toLowerCase().includes(q) || (p.nama || '').toLowerCase().includes(q)).slice(0, 12);
  }, [search, produkList]);

  const addItem = (p) => {
    setCart((prev) => {
      const ex = prev.find((it) => it.produk_id === p.id);
      if (ex) return prev.map((it) => (it.produk_id === p.id ? { ...it, qty: it.qty + 1 } : it));
      return [...prev, { produk_id: p.id, kode: p.kode, nama: p.nama, qty: 1, modal: p.harga_modal ?? 0 }];
    });
    setSearch('');
  };
  const updateItem = (idx, patch) => setCart((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx) => setCart((prev) => prev.filter((_, i) => i !== idx));

  const total = cart.reduce((s, it) => s + (Number(it.modal) || 0) * (Number(it.qty) || 0), 0);
  const data = state.data || {};
  const rows = (data.items || []).map((r) => ({ ...r, key: r.id }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (!form.akun_sumber) return setFormError('Akun sumber wajib dipilih.');
    if (cart.length === 0) return setFormError('Tambahkan minimal 1 produk.');
    if (cart.some((it) => !it.qty || it.qty < 1)) return setFormError('Qty tiap item minimal 1.');

    setBusy(true);
    try {
      await api.post('/pembelian-stok', {
        akun_sumber: form.akun_sumber,
        tanggal: form.tanggal,
        catatan: form.catatan.trim() || undefined,
        items: cart.map((it) => ({ produk_id: it.produk_id, qty: Number(it.qty), harga_modal_satuan: Number(it.modal) || 0 })),
      }, newIdempotencyKey());
      toast.success('Stok ditambahkan.');
      setCart([]);
      setForm((f) => ({ ...f, catatan: '' }));
      load().catch(() => {});
      kasir.run().catch(() => {});
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Beli Stok" />

      <Card className="mb-4">
        <p className="text-sm" style={{ color: 'var(--warning)', marginBottom: 12 }}>
          Menambah stok fisik (voucher/aksesoris). Akun sumber <b>berkurang</b>, stok <b>bertambah</b>. Ini <b>bukan</b> penjualan dan <b>bukan</b> biaya operasional.
        </p>
        <form onSubmit={onSubmit}>
          <div className="grid-2">
            <Field
              label="Akun sumber dana"
              required
              hint={
                form.akun_sumber && saldoOf(form.akun_sumber) != null
                  ? `Saldo ${form.akun_sumber}: ${formatRupiah(saldoOf(form.akun_sumber))} · sisa setelahnya ${formatRupiah(saldoOf(form.akun_sumber) - total)}`
                  : 'Pilih akun untuk melihat saldo live'
              }
            >
              <Select value={form.akun_sumber} onChange={set('akun_sumber')}>
                <option value="">Pilih akun…</option>
                {akunList.map((a) => (
                  <option key={a.id} value={a.nama_akun}>
                    {a.nama_akun}{saldoOf(a.nama_akun) != null ? ` — ${formatRupiah(saldoOf(a.nama_akun))}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tanggal" required>
              <Input type="date" value={form.tanggal} onChange={set('tanggal')} />
            </Field>
          </div>
          <Field label="Catatan (opsional)">
            <Input type="text" value={form.catatan} placeholder="mis. inject voucher closing" onChange={set('catatan')} />
          </Field>

          <Field label="Tambah produk" hint="Ketik kode/nama produk yang melacak stok">
            <Input type="search" value={search} placeholder="Ketik kode/nama…" onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
          </Field>
          {hasil.length > 0 && (
            <div className="card" style={{ padding: 4, marginTop: 6, boxShadow: 'none' }}>
              {hasil.map((p) => (
                <button key={p.id} type="button" className="flex justify-between items-center w-full" style={{ background: 'none', border: 'none', padding: '6px 8px', cursor: 'pointer', textAlign: 'left' }} onClick={() => addItem(p)}>
                  <span className="text-sm"><span className="font-mono text-muted">{p.kode}</span> — {p.nama}</span>
                  <span className="num text-sm">stok {p.stok}</span>
                </button>
              ))}
            </div>
          )}

          {cart.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {cart.map((it, idx) => (
                <div key={it.produk_id} className="card" style={{ padding: 'var(--space-2)', marginBottom: 8, boxShadow: 'none' }}>
                  <div className="flex justify-between items-center gap-2">
                    <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>{it.nama}</div>
                    <Button variant="ghost" size="sm" type="button" aria-label="Hapus item" onClick={() => removeItem(idx)}><Icon name="trash" size={15} /></Button>
                  </div>
                  <span className="font-mono text-xs text-muted">{it.kode}</span>
                  <div className="flex items-center justify-between" style={{ marginTop: 8, gap: 8 }}>
                    <div className="cart-item-stepper">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => updateItem(idx, { qty: Math.max(1, Number(it.qty) - 1) })}>-</button>
                      <span className="num cart-item-qty">{it.qty}</span>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => updateItem(idx, { qty: Number(it.qty) + 1 })}>+</button>
                    </div>
                    <div className="flex items-center" style={{ gap: 6 }}>
                      <span className="text-xs text-muted">Modal</span>
                      <Input
                        type="text"
                        inputMode="numeric"
                        aria-label="Modal satuan"
                        value={it.modal == null ? '' : formatRupiahInput(String(it.modal))}
                        onChange={(e) => updateItem(idx, { modal: parseRupiah(formatRupiahInput(e.target.value)) })}
                        style={{ width: 120, padding: '4px 8px', fontSize: '0.85rem' }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {formError && <p className="field-error" role="alert">{formError}</p>}
          <div className="flex justify-between items-center mt-3">
            <span className="text-sm text-secondary">Total: <b className="num">{formatRupiah(total)}</b></span>
            <Button type="submit" loading={busy} disabled={cart.length === 0}>Simpan Beli Stok</Button>
          </div>
        </form>
      </Card>

      <Card title="Riwayat Beli Stok">
        {state.status === 'error' ? (
          <ErrorState error={state.error} onRetry={() => load().catch(() => {})} />
        ) : state.status === 'loading' && !data.items ? (
          <Loader />
        ) : rows.length === 0 ? (
          <EmptyState title="Belum ada pembelian stok" description="Inject voucher/aksesoris akan tampil di sini." icon="barang" />
        ) : (
          <Table
            columns={[
              { key: 'tanggal', header: 'Tanggal', render: (r) => <span className="text-sm">{r.tanggal}</span> },
              { key: 'akun_sumber', header: 'Sumber', render: (r) => <span className="text-sm">{r.akun_sumber}</span> },
              { key: 'detail', header: 'Item', render: (r) => <span className="text-sm">{(r.detail || []).map((d) => `${d.produk_nama || d.produk_kode} ×${d.qty}`).join(', ')}</span> },
              { key: 'total', header: 'Total', align: 'right', render: (r) => <span className="num">{formatRupiah(r.total)}</span> },
              { key: 'dibuat_oleh_nama', header: 'Dicatat oleh', render: (r) => <span className="text-sm">{r.dibuat_oleh_nama || '—'}</span> },
              { key: 'created_at', header: 'Waktu', render: (r) => <span className="text-xs text-muted">{formatDateTime(r.created_at)}</span> },
              {
                key: 'aksi', header: '', align: 'right',
                render: (r) => (
                  <div className="row-actions">
                    {can('kasir') && (
                      <Button variant="ghost" size="sm" aria-label="Hapus" onClick={() => setDeleteTarget(r)}><Icon name="trash" size={15} /></Button>
                    )}
                  </div>
                ),
              },
            ]}
            rows={rows}
          />
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus Beli Stok"
        message={`Pembelian ${formatRupiah(deleteTarget?.total)} akan dihapus; backend membuat reversal (akun & stok dikembalikan). Lanjutkan?`}
        confirmLabel="Hapus"
        loading={deleteBusy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          setDeleteBusy(true);
          try {
            await api.del(`/pembelian-stok/${deleteTarget.id}`, { deleted_reason: 'dihapus dari halaman Beli Stok' });
            setDeleteTarget(null);
            toast.success('Pembelian dihapus. Stok & saldo dikembalikan.');
            load().catch(() => {});
            kasir.run().catch(() => {});
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
