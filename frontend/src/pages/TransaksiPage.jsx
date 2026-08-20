// Halaman Transaksi (PRD 5.2).
// Filter: 1 tanggal ATAU rentang (mutually exclusive), q, metode_bayar,
// status_konfirmasi. Ringkasan (total_items, total_nilai) diambil dari
// response backend — bukan hasil hitung frontend.
// GET /api/transaksi mendukung semua filter ini (API Contract).
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useDebounce } from '../hooks/useDebounce';
import { todayWIB, formatRupiah, formatDateTime, labelMetode, METODE_PEMBAYARAN } from '../lib/format';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Field, Input, Select } from '../components/ui/Field';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { Table } from '../components/ui/Table';
import { Loader, ErrorState, EmptyState } from '../components/ui/States';
import { Badge, KonfirmasiBadge } from '../components/ui/Badge';
import { Pagination } from '../components/ui/Pagination';
import { Icon } from '../components/ui/Icon';
import TransaksiForm from '../components/transaksi/TransaksiForm';
import { TransaksiDetail } from '../components/transaksi/TransaksiDetail';
import PaymentForm from '../components/transaksi/PaymentForm';

const LIMIT = 50;

export default function TransaksiPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const [mode, setMode] = useState('single');
  const [date, setDate] = useState(todayWIB());
  const [dateFrom, setDateFrom] = useState(todayWIB());
  const [dateTo, setDateTo] = useState(todayWIB());
  const [q, setQ] = useState('');
  const [metodeBayar, setMetodeBayar] = useState('');
  const [statusKonfirmasi, setStatusKonfirmasi] = useState('');
  const [offset, setOffset] = useState(0);
  const [kasirStatus, setKasirStatus] = useState(null);

  const debouncedQ = useDebounce(q, 350);

  const query = useMemo(() => {
    const base = { q: debouncedQ, metode_bayar: metodeBayar, status_konfirmasi: statusKonfirmasi, limit: LIMIT, offset };
    return mode === 'single' ? { ...base, date } : { ...base, date_from: dateFrom, date_to: dateTo };
  }, [mode, date, dateFrom, dateTo, debouncedQ, metodeBayar, statusKonfirmasi, offset]);

  const queryKey = useMemo(() => JSON.stringify(query), [query]);
  const [state, setState] = useState({ status: 'idle', data: null, error: null });

  const load = useMemo(
    () => async () => {
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        const data = await api.get('/transaksi', query);
        setState({ status: 'success', data, error: null });
        return data;
      } catch (err) {
        setState({ status: 'error', data: null, error: err });
        throw err;
      }
    },
    [query]
  );

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    api
      .get('/transaksi', query)
      .then((data) => {
        if (!cancelled) setState({ status: 'success', data, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', data: null, error: err });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  useEffect(() => {
    api.get('/kasir/current').then((r) => setKasirStatus(r.status)).catch(() => {});
  }, []);

  // --- Detail (termasuk deep link ?detail= dari Dashboard) ---
  const detailParam = params.get('detail');
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [bayarKurangTarget, setBayarKurangTarget] = useState(null);

  const openCreate = () => {
    setEditItem(null);
    setCreateOpen(true);
  };
  const closeModal = () => {
    setCreateOpen(false);
    setEditItem(null);
  };
  const handleSaved = () => {
    const wasEdit = Boolean(editItem);
    closeModal();
    toast.success(wasEdit ? 'Transaksi diperbarui.' : 'Transaksi berhasil dicatat.');
    load().catch(() => {});
  };

  const openDetail = (id) => {
    const next = new URLSearchParams(params);
    next.set('detail', id);
    setParams(next, { replace: true });
  };
  const closeDetail = () => {
    const next = new URLSearchParams(params);
    next.delete('detail');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (!detailParam) {
      setDetailData(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    const fromList = state.data?.items?.find((t) => String(t.id) === String(detailParam));
    if (fromList) {
      setDetailData(fromList);
      setDetailLoading(false);
      return;
    }
    api
      .get(`/transaksi/${encodeURIComponent(detailParam)}`)
      .then((r) => {
        if (!cancelled) setDetailData(r.transaksi || r);
      })
      .catch((err) => {
        if (!cancelled) setDetailData({ _error: err.message });
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailParam, state.data]);

  const data = state.data || {};
  const rows = (data.items || []).map((t) => ({ ...t, key: t.id }));

  return (
    <div className="page">
      <PageHeader
        title="Transaksi"
        subtitle="Riwayat & pencatatan transaksi. Filter tanggal menggunakan kalender WIB (Asia/Jakarta)."
        actions={
          can('transaksi') && (
            <Button onClick={openCreate}>
              <Icon name="plus" size={16} /> Transaksi Baru
            </Button>
          )
        }
      />

      {kasirStatus && kasirStatus !== 'buka' && (
        <div className="mb-3 flex items-center gap-2" style={{ padding: 'var(--space-3) var(--space-4)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-sm)', background: 'var(--warning-soft)' }}>
          <Icon name="alert" size={16} />
          <span className="text-sm">
            {kasirStatus === 'tutup' ? 'Sesi kasir sudah ditutup hari ini.' : 'Sesi kasir belum dibuka.'} Transaksi baru hanya bisa dicatat saat sesi kasir buka.&nbsp;
            {can('kasir') && <a style={{ textDecoration: 'underline', fontWeight: 600 }} href="/kasir">Buka kasir</a>}
          </span>
        </div>
      )}

      {/* Filter */}
      <div className="filter-bar">
        <div className="flex gap-2" style={{ alignItems: 'flex-end', flexBasis: '100%' }}>
          <button type="button" className={`tab ${mode === 'single' ? 'active' : ''}`} onClick={() => setMode('single')}>Tanggal</button>
          <button type="button" className={`tab ${mode === 'range' ? 'active' : ''}`} onClick={() => setMode('range')}>Rentang</button>
          <span className="text-xs text-muted">{mode === 'single' ? '1 tanggal WIB' : 'rentang inklusif WIB'}</span>
        </div>

        {mode === 'single' ? (
          <Field label="Tanggal">
            <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setOffset(0); }} />
          </Field>
        ) : (
          <>
            <Field label="Dari">
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </Field>
            <Field label="Sampai">
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </Field>
          </>
        )}

        <Field label="Cari (ID / produk / pelanggan)">
          <Input type="search" value={q} placeholder="mis. TX-20260810-001…" onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        </Field>
        <Field label="Metode bayar">
          <Select value={metodeBayar} onChange={(e) => setMetodeBayar(e.target.value)}>
            <option value="">Semua</option>
            {METODE_PEMBAYARAN.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Konfirmasi bayar">
          <Select value={statusKonfirmasi} onChange={(e) => setStatusKonfirmasi(e.target.value)}>
            <option value="">Semua</option>
            <option value="menunggu">Menunggu</option>
            <option value="otomatis">Otomatis</option>
            <option value="manual">Manual</option>
          </Select>
        </Field>
        <div className="filter-actions">
          <Button variant="secondary" onClick={() => { setOffset(0); load().catch(() => {}); }}>
            <Icon name="refresh" size={15} /> Terapkan
          </Button>
        </div>
      </div>

      {/* Ringkasan hasil filter (resmi dari backend) */}
      {state.status === 'success' && (
        <div className="summary-bar">
          <div className="summary-item">
            <div className="summary-label">Jumlah transaksi</div>
            <div className="summary-value">{data.total_items ?? 0}</div>
          </div>
          <div className="summary-item">
            <div className="summary-label">Total nilai</div>
            <div className="summary-value">{formatRupiah(data.total_nilai || 0)}</div>
          </div>
          <div className="summary-item">
            <div className="summary-label">Periode</div>
            <div className="summary-value">{mode === 'single' ? (date ? dateDisplay(date) : '-') : `${dateDisplay(dateFrom)} → ${dateDisplay(dateTo)}`}</div>
          </div>
        </div>
      )}

      {state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={() => load().catch(() => {})} />
      ) : state.status === 'loading' && !data.items ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Tidak ada transaksi"
          description="Ubah filter atau catat transaksi baru. Transaksi yang dihapus (soft-delete) tidak ditampilkan."
          icon="transaksi"
          action={can('transaksi') && <Button onClick={openCreate}>Transaksi Baru</Button>}
        />
      ) : (
        <>
          <Table
            columns={[
              { key: 'id', header: 'ID', render: (r) => <span className="num">{r.id}</span> },
              { key: 'created_at', header: 'Tanggal/Jam (WIB)', render: (r) => <span className="text-sm">{formatDateTime(r.created_at)}</span> },
              { key: 'pelanggan_nama', header: 'Pelanggan', render: (r) => r.pelanggan_nama || <span className="text-muted">Umum</span> },
              {
                key: 'items',
                header: 'Item',
                render: (r) => <span className="text-sm">{((r.items || []).map((i) => i.nama_produk_snapshot || i.nama_produk).slice(0, 2).join(', '))}{(r.items || []).length > 2 ? '…' : ''}</span>,
              },
              { key: 'metode_bayar', header: 'Bayar', render: (r) => <Badge tone="info">{labelMetode(r.metode_bayar)}</Badge> },
              { key: 'konfirmasi_pembayaran', header: 'Konfirmasi', render: (r) => <KonfirmasiBadge status={r.konfirmasi_pembayaran} /> },
              { key: 'total', header: 'Total', align: 'right', render: (r) => <span className="num">{formatRupiah(r.total)}</span> },
            ]}
            rows={rows}
            onRowClick={(r) => openDetail(r.id)}
          />
          <Pagination offset={offset} total={data.total_items || 0} limit={LIMIT} onPage={setOffset} />
        </>
      )}

      {/* Detail */}
      <Modal
        open={Boolean(detailParam)}
        onClose={closeDetail}
        title="Detail Transaksi"
        size="lg"
        footer={
          can('transaksi') &&
          detailData &&
          !detailData._error && (
            <>
              <Button variant="danger" onClick={() => { setDeleteTarget(detailData); closeDetail(); }}>
                <Icon name="trash" size={15} /> Hapus
              </Button>
              <Button
                onClick={() => {
                  api.get(`/transaksi/${encodeURIComponent(detailData.id)}`).then((r) => {
                    const d = r.transaksi || r;
                    setEditItem({ ...d, items: d.items || [], akun_penerima: d.pembayaran?.[0]?.akun_id || '' });
                    setCreateOpen(true);
                  });
                }}
              >
                <Icon name="edit" size={15} /> Edit
              </Button>
            </>
          )
        }
      >
        {detailLoading ? <Loader /> : detailData?._error ? <ErrorState error={{ message: detailData._error }} /> : <TransaksiDetail transaksi={detailData} onConfirm={() => load().catch(() => {})} onBayarKurang={(tx) => { setBayarKurangTarget(tx); closeDetail(); }} />}
      </Modal>

      {/* Create / Edit */}
      <Modal
        open={createOpen}
        onClose={closeModal}
        title={editItem ? 'Edit Transaksi' : 'Transaksi Baru'}
        size="lg"
      >
        <TransaksiForm
          key={editItem ? String(editItem.id) : 'baru'}
          initial={editItem || undefined}
          onCancel={closeModal}
          onSaved={handleSaved}
        />
      </Modal>

      {/* Delete confirm (soft-delete + reversal di sisi backend) */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus Transaksi"
        message={`Transaksi ${deleteTarget?.id} akan dihapus secara soft-delete. Backend membuat mutasi reversal secara atomik; histori finansial tetap tercatat di audit. Lanjutkan?`}
        confirmLabel="Hapus Transaksi"
        loading={deleteBusy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          setDeleteBusy(true);
          try {
            await api.del(`/transaksi/${deleteTarget.id}`, { deleted_reason: 'dihapus dari halaman Transaksi' });
            setDeleteTarget(null);
            toast.success(`Transaksi ${deleteTarget.id} dihapus.`);
            load().catch(() => {});
          } catch (err) {
            toast.error(err.message);
          } finally {
            setDeleteBusy(false);
          }
        }}
      />

      {/* Bayar Kurang Modal */}
      <Modal
        open={Boolean(bayarKurangTarget)}
        onClose={() => setBayarKurangTarget(null)}
        title="Bayar Kurang"
        size="md"
      >
        {bayarKurangTarget && (
          <PaymentForm
            transaksi={bayarKurangTarget}
            onPaid={() => {
              setBayarKurangTarget(null);
              toast.success('Pembayaran tercatat.');
              load().catch(() => {});
            }}
            onCancel={() => setBayarKurangTarget(null)}
          />
        )}
      </Modal>
    </div>
  );
}

function dateDisplay(v) {
  if (!v) return '-';
  const [y, m, d] = v.split('-');
  return `${d}/${m}/${y}`;
}