// Harga Server — Perbandingan harga modal vs harga OrderKuota/DANA
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { formatRupiah } from '../lib/format';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Field, Input, Select } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { Table } from '../components/ui/Table';
import { Loader, ErrorState, EmptyState } from '../components/ui/States';
import { Badge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';

const KATEGORI_OPTIONS = [
  { value: '', label: 'Semua Kategori' },
  { value: 'cetak_voucher', label: 'Cetak Voucher' },
  { value: 'pulsa', label: 'Pulsa' },
  { value: 'dana', label: 'DANA' },
  { value: 'gopay', label: 'GoPay' },
  { value: 'ovo', label: 'OVO' },
  { value: 'token', label: 'Token Listrik' },
];

export default function HargaServerPage() {
  const toast = useToast();
  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const [compareState, setCompareState] = useState({ status: 'idle', data: null, error: null });
  const [alerts, setAlerts] = useState([]);
  const [filterKategori, setFilterKategori] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [logOpen, setLogOpen] = useState(false);

  const load = useMemo(
    () => async () => {
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        let url = '/harga-server';
        if (filterKategori) url += `?kategori=${filterKategori}`;
        const data = await api.get(url);
        setState({ status: 'success', data, error: null });
      } catch (err) {
        setState({ status: 'error', data: null, error: err });
      }
    },
    [filterKategori]
  );

  const loadCompare = useMemo(
    () => async () => {
      setCompareState((s) => ({ ...s, status: 'loading' }));
      try {
        const data = await api.get('/harga-server/perbandingan');
        setCompareState({ status: 'success', data, error: null });
      } catch (err) {
        setCompareState({ status: 'error', data: null, error: err });
      }
    },
    []
  );

  const loadAlerts = async () => {
    try {
      const data = await api.get('/harga-server/alerts');
      setAlerts(data.items || []);
    } catch (err) {}
  };

  useEffect(() => { load(); loadCompare(); loadAlerts(); }, [load, loadCompare]);

  const data = state.data || {};
  const items = data.items || [];
  const compareData = compareState.data || {};
  const compareItems = compareData.items || [];
  const summary = compareData.summary || {};

  return (
    <div className="page">
      <PageHeader
        title="Harga Server"
        subtitle="Perbandingan harga modal vs harga dari OrderKuota/DANA"
        actions={
          <>
            <Button variant="secondary" onClick={() => setLogOpen(true)}>
              <Icon name="clock" size={16} /> Log
            </Button>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <Icon name="download" size={16} /> Import
            </Button>
            <Button onClick={() => { load(); loadCompare(); loadAlerts(); }}>
              <Icon name="refresh" size={16} /> Refresh
            </Button>
          </>
        }
      />

      {/* Alert Harga Naik */}
      {alerts.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid var(--danger)', marginBottom: 'var(--space-3)' }}>
          <div className="flex items-center justify-between mb-2">
            <span style={{ fontWeight: 600, color: 'var(--danger)' }}>
              <Icon name="alert" size={16} /> {alerts.length} Harga Naik
            </span>
            <Button variant="ghost" size="sm" onClick={async () => {
              await api.put('/harga-server/alerts/read');
              setAlerts([]);
              toast.success('Notifikasi ditandai sudah dibaca');
            }}>Tandai Dibaca</Button>
          </div>
          {alerts.slice(0, 3).map((a) => (
            <div key={a.id} style={{ fontSize: '0.85rem', marginBottom: 4 }}>
              <span style={{ fontWeight: 500 }}>{a.nama_produk}</span>
              <span style={{ color: 'var(--danger)', marginLeft: 8 }}>
                {formatRupiah(a.harga_lama)} → {formatRupiah(a.harga_baru)} (+{formatRupiah(a.selisih)})
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Summary */}
      {compareState.status === 'success' && (
        <div className="g2" style={{ marginBottom: 'var(--space-3)' }}>
          <div className="stat" style={{ background: 'var(--info-soft)' }}>
            <div className="lb">Total Produk</div>
            <div className="vl">{summary.total || 0}</div>
          </div>
          <div className="stat" style={{ background: 'var(--danger-soft)' }}>
            <div className="lb">Harga Naik</div>
            <div className="vl" style={{ color: 'var(--danger)' }}>{summary.naik || 0}</div>
          </div>
          <div className="stat" style={{ background: 'var(--success-soft)' }}>
            <div className="lb">Sama / Turun</div>
            <div className="vl" style={{ color: 'var(--success)' }}>{(summary.sama || 0) + (summary.turun || 0)}</div>
          </div>
          <div className="stat" style={{ background: 'var(--warning-soft)' }}>
            <div className="lb">Baru</div>
            <div className="vl" style={{ color: 'var(--warning)' }}>{summary.baru || 0}</div>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="filter-bar">
        <Field label="Filter Kategori">
          <Select value={filterKategori} onChange={(e) => setFilterKategori(e.target.value)}>
            {KATEGORI_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </Select>
        </Field>
      </div>

      {/* Tabel Perbandingan */}
      {compareState.status === 'error' ? (
        <ErrorState error={compareState.error} onRetry={() => { loadCompare(); loadAlerts(); }} />
      ) : compareState.status === 'loading' ? (
        <Loader />
      ) : compareItems.length === 0 ? (
        <EmptyState title="Belum ada data harga server" description="Import harga dari OrderKuota/DANA terlebih dahulu." icon="wallet" />
      ) : (
        <Table
          columns={[
            { key: 'kode_produk', header: 'Kode', render: (r) => <span className="font-mono text-sm" style={{ fontWeight: 600 }}>{r.kode_produk}</span> },
            { key: 'nama_produk', header: 'Nama', render: (r) => <span className="text-sm">{r.nama_produk}</span> },
            { key: 'kategori', header: 'Kategori', render: (r) => <Badge tone="info">{r.kategori}</Badge> },
            { key: 'harga_server', header: 'Harga Server', align: 'right', render: (r) => <span className="num" style={{ fontWeight: 600 }}>{formatRupiah(r.harga_server)}</span> },
            { key: 'modal_daftar', header: 'Modal Daftar', align: 'right', render: (r) => r.modal_daftar ? <span className="num">{formatRupiah(r.modal_daftar)}</span> : <span className="text-muted">—</span> },
            { key: 'selisih', header: 'Selisih', align: 'right', render: (r) => {
              if (r.status === 'baru') return <Badge tone="warning">Baru</Badge>;
              if (r.selisih > 0) return <span className="num" style={{ color: 'var(--danger)', fontWeight: 600 }}>+{formatRupiah(r.selisih)}</span>;
              if (r.selisih < 0) return <span className="num" style={{ color: 'var(--success)' }}>{formatRupiah(r.selisih)}</span>;
              return <span className="num" style={{ color: 'var(--success)' }}>Sama</span>;
            }},
            { key: 'status', header: 'Status', render: (r) => {
              if (r.status === 'naik') return <Badge tone="danger">Naik</Badge>;
              if (r.status === 'turun') return <Badge tone="success">Turun</Badge>;
              if (r.status === 'baru') return <Badge tone="warning">Baru</Badge>;
              return <Badge tone="success">OK</Badge>;
            }},
            { key: 'aksi', header: '', render: (r) => (
              <Button variant="ghost" size="sm" onClick={() => setEditTarget(r)}>
                <Icon name="edit" size={15} />
              </Button>
            )},
          ]}
          rows={compareItems.map((r) => ({ ...r, key: r.id }))}
        />
      )}

      {/* Import Modal */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import Harga Server">
        <ImportForm
          onCancel={() => setImportOpen(false)}
          onSaved={() => {
            setImportOpen(false);
            toast.success('Harga berhasil di-import');
            load();
            loadCompare();
          }}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal open={Boolean(editTarget)} onClose={() => setEditTarget(null)} title="Edit Harga Server">
        {editTarget && (
          <EditForm
            target={editTarget}
            onCancel={() => setEditTarget(null)}
            onSaved={() => {
              setEditTarget(null);
              toast.success('Harga diperbarui');
              load();
              loadCompare();
            }}
          />
        )}
      </Modal>

      {/* Log Modal */}
      <Modal open={logOpen} onClose={() => setLogOpen(false)} title="Log Perubahan Harga" size="lg">
        <LogHarga />
      </Modal>
    </div>
  );
}

function ImportForm({ onCancel, onSaved }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    setBusy(true);
    try {
      let items;
      try {
        items = JSON.parse(text);
      } catch {
        // Coba parse sebagai CSV
        const lines = text.trim().split('\n');
        if (lines.length < 2) throw new Error('Format tidak valid');
        const headers = lines[0].split(',').map(h => h.trim());
        items = lines.slice(1).map(line => {
          const vals = line.split(',').map(v => v.trim());
          const obj = {};
          headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
          return {
            kode: obj.kode || obj.Kode || '',
            nama: obj.nama || obj.Nama || obj.name || '',
            sumber: obj.sumber || obj.Sumber || 'manual',
            kategori: obj.kategori || obj.Kategori || 'lainnya',
            operator: obj.operator || obj.Operator || null,
            harga: parseInt(obj.harga_server || obj.harga || obj.modal || 0),
            admin_fee: parseInt(obj.admin_fee || obj.Admin || 0),
          };
        });
      }
      if (!Array.isArray(items) || items.length === 0) throw new Error('Tidak ada data valid');
      const result = await api.post('/harga-server/import', { items });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-secondary">Paste data JSON atau CSV:</p>
      <textarea
        className="textarea"
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='[{"kode":"Vi0301","nama":"Indosat 3GB 1Hari","kategori":"cetak_voucher","harga":6900}]'
        style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
      />
      {error && <p className="field-error">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Batal</Button>
        <Button onClick={handleSubmit} loading={busy}>Import</Button>
      </div>
    </div>
  );
}

function EditForm({ target, onCancel, onSaved }) {
  const toast = useToast();
  const [harga, setHarga] = useState(target.harga_server || 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/harga-server/${target.id}`, { harga_server: harga });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm"><b>{target.nama_produk}</b> ({target.kode_produk})</p>
      <Field label="Harga Server (Rp)">
        <Input type="number" value={harga} onChange={(e) => setHarga(parseInt(e.target.value) || 0)} />
      </Field>
      {error && <p className="field-error">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Batal</Button>
        <Button onClick={handleSubmit} loading={busy}>Simpan</Button>
      </div>
    </div>
  );
}

function LogHarga() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/harga-server/log').then((r) => {
      setLogs(r.items || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return <Loader />;

  return (
    <div>
      {logs.length === 0 ? (
        <EmptyState title="Belum ada log" />
      ) : (
        <Table
          columns={[
            { key: 'created_at', header: 'Waktu', render: (r) => <span className="text-sm">{new Date(r.created_at).toLocaleString('id-ID')}</span> },
            { key: 'kode_produk', header: 'Kode', render: (r) => <span className="font-mono text-sm">{r.kode_produk}</span> },
            { key: 'nama_produk', header: 'Nama', render: (r) => <span className="text-sm">{r.nama_produk}</span> },
            { key: 'harga_lama', header: 'Harga Lama', align: 'right', render: (r) => <span className="num text-sm">{r.harga_lama ? formatRupiah(r.harga_lama) : '—'}</span> },
            { key: 'harga_baru', header: 'Harga Baru', align: 'right', render: (r) => <span className="num text-sm" style={{ fontWeight: 600 }}>{formatRupiah(r.harga_baru)}</span> },
            { key: 'selisih', header: 'Selisih', align: 'right', render: (r) => (
              <span className="num text-sm" style={{ color: r.selisih > 0 ? 'var(--danger)' : r.selisih < 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                {r.selisih > 0 ? '+' : ''}{formatRupiah(r.selisih)}
              </span>
            )},
          ]}
          rows={logs.map((l) => ({ ...l, key: l.id }))}
        />
      )}
    </div>
  );
}
