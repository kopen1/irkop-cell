// Halaman Isi Saldo — transfer antar akun internal (mis. SeaBank → OrderKuota).
// BUKAN transaksi pelanggan: tidak ada pelanggan, tidak menghitung omzet/laba.
// Backend menulis dua mutasi (asal −nominal, tujuan +nominal) lewat
// sumber_tipe='penyesuaian'; Total Saldo tetap karena cuma pindah.
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

export default function IsiSaldoPage() {
  const { can } = useAuth();
  const toast = useToast();
  const akun = useAsync(() => api.get('/akun'), { deps: [] });
  const kasir = useAsync(() => api.get('/kasir/current'), { deps: [] });
  const akunList = useMemo(() => akun.data?.items || [], [akun.data]);

  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const load = useMemo(
    () => async () => {
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        const data = await api.get('/transfer-saldo', { limit: LIMIT });
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

  const [form, setForm] = useState({ dari_akun: '', ke_akun: '', nominal: '', tanggal: todayWIB(), catatan: '' });
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setNominal = (e) => setForm((f) => ({ ...f, nominal: formatRupiahInput(e.target.value) }));

  const nominalNum = parseRupiah(form.nominal) || 0;
  const data = state.data || {};
  const rows = (data.items || []).map((r) => ({ ...r, key: r.id }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (!form.dari_akun) return setFormError('Akun asal wajib dipilih.');
    if (!form.ke_akun) return setFormError('Akun tujuan wajib dipilih.');
    if (form.dari_akun === form.ke_akun) return setFormError('Akun asal dan tujuan tidak boleh sama.');
    if (nominalNum < 1) return setFormError('Nominal wajib diisi (minimal Rp1).');

    setBusy(true);
    try {
      await api.post('/transfer-saldo', {
        dari_akun: form.dari_akun,
        ke_akun: form.ke_akun,
        nominal: nominalNum,
        tanggal: form.tanggal,
        catatan: form.catatan.trim() || undefined,
      }, newIdempotencyKey());
      toast.success('Saldo dipindahkan.');
      setForm((f) => ({ ...f, nominal: '', catatan: '' }));
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
      <PageHeader title="Isi Saldo" />

      <Card className="mb-4">
        <p className="text-sm" style={{ color: 'var(--warning)', marginBottom: 12 }}>
          Memindahkan saldo antar akun internal (mis. SeaBank → OrderKuota). <b>Bukan</b> kirim uang ke pelanggan dan <b>bukan</b> pembelian.
        </p>
        <form onSubmit={onSubmit}>
          <div className="grid-2">
            <Field
              label="Dari akun"
              required
              hint={form.dari_akun && saldoOf(form.dari_akun) != null ? `Saldo live: ${formatRupiah(saldoOf(form.dari_akun))}` : 'Pilih akun untuk melihat saldo live'}
            >
              <Select value={form.dari_akun} onChange={set('dari_akun')}>
                <option value="">Pilih akun…</option>
                {akunList.map((a) => (
                  <option key={a.id} value={a.nama_akun}>
                    {a.nama_akun}{saldoOf(a.nama_akun) != null ? ` — ${formatRupiah(saldoOf(a.nama_akun))}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Ke akun"
              required
              hint={form.ke_akun && saldoOf(form.ke_akun) != null ? `Saldo live: ${formatRupiah(saldoOf(form.ke_akun))}` : 'Pilih akun untuk melihat saldo live'}
            >
              <Select value={form.ke_akun} onChange={set('ke_akun')}>
                <option value="">Pilih akun…</option>
                {akunList.map((a) => (
                  <option key={a.id} value={a.nama_akun}>
                    {a.nama_akun}{saldoOf(a.nama_akun) != null ? ` — ${formatRupiah(saldoOf(a.nama_akun))}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nominal (Rp)" required>
              <Input type="text" inputMode="numeric" value={form.nominal} placeholder="mis. 1.000.000" onChange={setNominal} />
            </Field>
            <Field label="Tanggal" required>
              <Input type="date" value={form.tanggal} onChange={set('tanggal')} />
            </Field>
          </div>
          <Field label="Catatan (opsional)">
            <Input type="text" value={form.catatan} placeholder="mis. isi saldo OrderKuota" onChange={set('catatan')} />
          </Field>

          {form.dari_akun && form.ke_akun && form.dari_akun !== form.ke_akun && nominalNum > 0 && (
            <div className="text-sm" style={{ marginTop: 8, color: 'var(--text-secondary)' }}>
              {form.dari_akun} −{formatRupiah(nominalNum)} · {form.ke_akun} +{formatRupiah(nominalNum)} · Total Saldo tetap
            </div>
          )}
          {formError && <p className="field-error" role="alert">{formError}</p>}
          <div className="flex justify-end gap-2 mt-3">
            <Button type="submit" loading={busy}>Pindahkan Saldo</Button>
          </div>
        </form>
      </Card>

      <Card title="Riwayat Transfer Saldo">
        {state.status === 'error' ? (
          <ErrorState error={state.error} onRetry={() => load().catch(() => {})} />
        ) : state.status === 'loading' && !data.items ? (
          <Loader />
        ) : rows.length === 0 ? (
          <EmptyState title="Belum ada transfer" description="Isi saldo OrderKuota dari SeaBank akan tampil di sini." icon="wallet" />
        ) : (
          <Table
            columns={[
              { key: 'tanggal', header: 'Tanggal', render: (r) => <span className="text-sm">{r.tanggal}</span> },
              { key: 'rute', header: 'Dari → Ke', render: (r) => <span className="text-sm">{r.dari_akun} → {r.ke_akun}</span> },
              { key: 'nominal', header: 'Nominal', align: 'right', render: (r) => <span className="num">{formatRupiah(r.nominal)}</span> },
              { key: 'catatan', header: 'Catatan', render: (r) => <span className="text-sm text-muted">{r.catatan || '—'}</span> },
              { key: 'dibuat_oleh_nama', header: 'Dicatat oleh', render: (r) => <span className="text-sm">{r.dibuat_oleh_nama || '—'}</span> },
              { key: 'created_at', header: 'Waktu', render: (r) => <span className="text-xs text-muted">{formatDateTime(r.created_at)}</span> },
              {
                key: 'aksi', header: '', align: 'right',
                render: (r) => (
                  <div className="row-actions">
                    {can('kasir') && (
                      <Button variant="ghost" size="sm" aria-label="Hapus transfer" onClick={() => setDeleteTarget(r)}>
                        <Icon name="trash" size={15} />
                      </Button>
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
        title="Hapus Transfer Saldo"
        message={`Transfer ${formatRupiah(deleteTarget?.nominal)} (${deleteTarget?.dari_akun} → ${deleteTarget?.ke_akun}) akan dihapus; backend membuat mutasi reversal. Lanjutkan?`}
        confirmLabel="Hapus"
        loading={deleteBusy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          setDeleteBusy(true);
          try {
            await api.del(`/transfer-saldo/${deleteTarget.id}`, { deleted_reason: 'dihapus dari halaman Isi Saldo' });
            setDeleteTarget(null);
            toast.success('Transfer dihapus. Mutasi reversal dibuat backend.');
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
