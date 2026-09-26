// Harga Server — Perbandingan harga modal vs harga OrderKuota/DANA
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { formatRupiah } from '../lib/format';
import { operatorOf, kodePrefixOf } from '../lib/operator';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Field, Input, Select } from '../components/ui/Field';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { Table } from '../components/ui/Table';
import { Loader, ErrorState, EmptyState } from '../components/ui/States';

const KATEGORI_OPTIONS = [
  { value: '', label: 'Semua Kategori' },
  { value: 'cetak_voucher', label: 'Voucher' },
  { value: 'pulsa', label: 'Pulsa' },
  { value: 'dana', label: 'DANA' },
  { value: 'gopay', label: 'GoPay' },
  { value: 'ovo', label: 'OVO' },
  { value: 'token', label: 'Token Listrik' },
];

export default function HargaServerPage() {
  const toast = useToast();
  const [compareState, setCompareState] = useState({ status: 'idle', data: null, error: null });
  const [alerts, setAlerts] = useState([]);
  const [filterKategori, setFilterKategori] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [logOpen, setLogOpen] = useState(false);
  const [updateBusy, setUpdateBusy] = useState({});
  const [linkTarget, setLinkTarget] = useState(null);
  const [autoLinkBusy, setAutoLinkBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [terapkanOpen, setTerapkanOpen] = useState(false);

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
    } catch {
      /* abaikan */
    }
  };

  useEffect(() => { loadCompare(); loadAlerts(); }, [loadCompare]);

  const reloadAll = () => { loadCompare(); loadAlerts(); };

  // Update modal 1 produk di Daftar Barang dari harga server
  const doUpdateModal = async (row) => {
    setUpdateBusy((s) => ({ ...s, [row.kode_produk]: true }));
    try {
      const res = await api.post('/harga-server/update-modal', { kode: row.kode_produk });
      if (res.updated_count > 0) {
        const u = res.updated[0];
        toast.success(`${u.nama}: modal ${formatRupiah(u.modal_lama)} → ${formatRupiah(u.modal_baru)}`);
      } else {
        toast.warning(res.skipped?.[0]?.reason || 'Tidak ada yang diperbarui');
      }
      reloadAll();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUpdateBusy((s) => ({ ...s, [row.kode_produk]: false }));
    }
  };

  // Update semua produk yang harga server > modal (harga naik)
  const doAutoLink = async () => {
    setAutoLinkBusy(true);
    try {
      const res = await api.post('/harga-server/auto-link', {});
      toast.success(`Auto-link: ${res.linked} produk terhubung${res.total_belum ? ` (${res.total_belum} belum terhubung)` : ''}.`);
      reloadAll();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAutoLinkBusy(false);
    }
  };

  const doUpdateAllNaik = async () => {
    setUpdateBusy((s) => ({ ...s, __all: true }));
    try {
      const res = await api.post('/harga-server/update-modal', { all_naik: true });
      toast.success(`${res.updated_count} produk diperbarui${res.skipped_count ? `, ${res.skipped_count} dilewati` : ''}.`);
      reloadAll();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUpdateBusy((s) => ({ ...s, __all: false }));
    }
  };

  const compareItems = useMemo(() => compareState.data?.items || [], [compareState.data]);
  const summary = compareState.data?.summary || {};

  const KAT_LABEL = { cetak_voucher: 'Voucher', pulsa: 'Pulsa', dana: 'DANA', gopay: 'GoPay', ovo: 'OVO', token: 'Token' };

  // Daftar fokus = yang perlu tindakan: harga naik/turun atau belum terhubung
  // ke produk lokal. Sisanya disembunyikan di balik "tampilkan semua".
  const butuhTindakan = (r) =>
    r.status === 'naik' || r.status === 'turun' || !r.nama_produk_daftar;

  const filteredItems = useMemo(
    () => (filterKategori ? compareItems.filter((r) => r.kategori === filterKategori) : compareItems),
    [compareItems, filterKategori]
  );

  const visibleItems = useMemo(
    () => (showAll ? filteredItems : filteredItems.filter(butuhTindakan)),
    [filteredItems, showAll]
  );

  const belumCount = useMemo(() => filteredItems.filter((r) => !r.nama_produk_daftar).length, [filteredItems]);
  const samaCount = (summary.sama || 0) + (summary.turun || 0);
  const totalNaik = useMemo(
    () => filteredItems.filter((r) => r.status === 'naik').reduce((s, r) => s + (Number(r.selisih) || 0), 0),
    [filteredItems]
  );

  // Grouping dua tingkat: kategori OrderKuota -> sub-grup operator/kode (Voucher).
  const grouped = useMemo(() => {
    const tree = new Map();
    for (const r of visibleItems) {
      const kat = KAT_LABEL[r.kategori] || r.kategori || 'Lainnya';
      const isVoucher = r.kategori === 'cetak_voucher';
      const sub = isVoucher ? (operatorOf(r.kode_produk, r.nama_produk, 'Voucher') || 'Lainnya') : '';
      if (!tree.has(kat)) tree.set(kat, new Map());
      const subs = tree.get(kat);
      if (!subs.has(sub)) subs.set(sub, { list: [], prefixes: new Map() });
      const b = subs.get(sub);
      b.list.push(r);
      const pfx = kodePrefixOf(r.kode_produk, 'Voucher');
      if (pfx) b.prefixes.set(pfx, (b.prefixes.get(pfx) || 0) + 1);
    }
    const byTindakan = (a, b) => (butuhTindakan(b) ? 1 : 0) - (butuhTindakan(a) ? 1 : 0);
    const out = [];
    for (const [kat, subs] of tree) {
      out.push({ _kat: kat, key: `kat:${kat}` });
      const arr = [...subs.entries()];
      arr.sort((a, b) => (b[1].list.length ? Math.max(...b[1].list.map((r) => Number(r.selisih) || 0)) : 0)
        - (a[1].list.length ? Math.max(...a[1].list.map((r) => Number(r.selisih) || 0)) : 0));
      for (const [sub, b] of arr) {
        if (sub) {
          const top = [...b.prefixes.entries()].sort((x, y) => y[1] - x[1])[0];
          out.push({ _sub: sub, _prefix: top ? top[0] : '', key: `sub:${kat}:${sub}` });
        }
        b.list.sort(byTindakan);
        for (const r of b.list) out.push(r);
      }
    }
    out.sort(byTindakan);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems]);

  return (
    <div className="page">
      <PageHeader
        title="Harga Server"
        subtitle={`${summary.total || 0} produk · perbandingan modal Daftar Barang vs harga OrderKuota/DANA`}
        actions={
          <div className="page-actions-desktop">
            <Button variant="secondary" onClick={() => setMenuOpen(true)} aria-label="Menu lainnya">
 Menu
            </Button>
            {summary.naik > 0 && (
              <Button onClick={() => setTerapkanOpen(true)} loading={updateBusy.__all}>
 Terapkan ({summary.naik})
              </Button>
            )}
          </div>
        }
      />

      {/* Alert Harga Naik */}
      {alerts.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid var(--danger)', marginBottom: 'var(--space-3)' }}>
          <div className="flex items-center justify-between mb-2">
            <span style={{ fontWeight: 600, color: 'var(--danger)' }}>
 {alerts.length} Harga Naik
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

      {/* Bar proporsi + total dampak (ganti 4 kartu angka) */}
      {compareState.status === 'success' && (
        <div className="hs-bar-wrap">
          <div className="hs-bar">
            <span className="hs-bar-seg hs-seg-ok" style={{ flexGrow: (summary.sama || 0) + (summary.turun || 0) || 0.0001 }} />
            <span className="hs-bar-seg hs-seg-up" style={{ flexGrow: summary.naik || 0.0001 }} />
            <span className="hs-bar-seg hs-seg-new" style={{ flexGrow: summary.baru || 0.0001 }} />
          </div>
          <div className="hs-legend">
            <span><i className="hs-dot hs-seg-ok" /> {samaCount} sama</span>
            <span><i className="hs-dot hs-seg-up" /> {summary.naik || 0} naik</span>
            <span><i className="hs-dot hs-seg-new" /> {summary.baru || 0} baru</span>
            {belumCount > 0 && <span><i className="hs-dot hs-seg-link" /> {belumCount} belum terhubung</span>}
          </div>
          {summary.naik > 0 && (
            <p className="hs-impact">
              <span><b>{summary.naik} harga naik</b> · total +{formatRupiah(totalNaik)}</span>
              <Button size="sm" onClick={() => setTerapkanOpen(true)}>Terapkan</Button>
            </p>
          )}
        </div>
      )}

      {/* Filter */}
      <div className="filter-bar">
        <Field label="Kategori OrderKuota">
          <Select value={filterKategori} onChange={(e) => setFilterKategori(e.target.value)}>
            {KATEGORI_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </Select>
        </Field>
      </div>

      <ConfirmDialog
        open={terapkanOpen}
        title="Terapkan Harga Naik"
        message={`${summary.naik || 0} produk akan modal Daftar Barang disamakan dengan harga server (harga jual dipertahankan, jadi margin aman). Total perubahan +${formatRupiah(totalNaik)}. Lanjutkan?`}
        confirmLabel={`Terapkan ${summary.naik || 0}`}
        loading={updateBusy.__all}
        onCancel={() => setTerapkanOpen(false)}
        onConfirm={async () => {
          await doUpdateAllNaik();
          setTerapkanOpen(false);
        }}
      />

      {/* Tabel Perbandingan */}
      {compareState.status === 'error' ? (
        <ErrorState error={compareState.error} onRetry={() => { loadCompare(); loadAlerts(); }} />
      ) : compareState.status === 'loading' ? (
        <Loader />
      ) : grouped.length === 0 ? (
        compareItems.length === 0 ? (
          <EmptyState title="Belum ada data harga server" description="Import harga dari OrderKuota/DANA terlebih dahulu." icon="wallet" />
        ) : (
          <EmptyState title="Semua sudah beres" description="Tidak ada harga naik atau produk yang belum terhubung." icon="check" />
        )
      ) : (
        <>
          <div className="plist plist-hs">
            {grouped.map((r) => {
              if (r._kat) return <div key={r.key} className="plist-kat">{r._kat}</div>;
              if (r._sub) {
                return (
                  <div key={r.key} className="plist-sub">
                    <span>{r._sub}</span>
                    {r._prefix && <code className="plist-prefix">{r._prefix}*</code>}
                  </div>
                );
              }
              const laba = r.modal_daftar != null && r.harga_jual_daftar != null
                ? (Number(r.harga_jual_daftar) - Number(r.modal_daftar))
                : null;
              return (
                <div
                  key={r.id}
                  className="plist-row plist-row-hs"
                  role="button"
                  tabIndex={0}
                  onClick={() => setEditTarget(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); }
                  }}
                >
                  <span className="plist-body">
                    <span className="plist-name">{r.nama_produk}</span>
                    <span className="plist-kode">
                      {r.kode_produk}
                      {r.nama_produk_daftar
                        ? <> · <span style={{ color: 'var(--success)' }}>→ {r.nama_produk_daftar}</span></>
                        : <> · <button type="button" className="hs-link-btn" onClick={(e) => { e.stopPropagation(); setLinkTarget(r); }}>Hubungkan</button></>}
                    </span>
                  </span>
                  <span className="hs-selisih">
                    {r.status === 'baru' ? (
                      <span className="badge badge-warning">Baru</span>
                    ) : r.selisih > 0 ? (
                      <span className="num" style={{ color: 'var(--danger)', fontWeight: 700 }}>+{formatRupiah(r.selisih)}</span>
                    ) : r.selisih < 0 ? (
                      <span className="num" style={{ color: 'var(--success)', fontWeight: 700 }}>{formatRupiah(r.selisih)}</span>
                    ) : (
                      <span className="num" style={{ color: 'var(--success)' }}>Sama</span>
                    )}
                  </span>
                  <span className="plist-side">
                    <span className="plist-tagline">
                      <span className={`plist-tag plist-tag-${statusTone(r.status)}`}>{statusLabel(r.status)}</span>
                      {laba != null && (
                        <span className={`plist-laba ${laba < 0 ? 'text-danger' : laba === 0 ? 'text-warning' : 'text-success'}`}>
                          Laba {formatRupiah(laba)}
                        </span>
                      )}
                    </span>
                    <span className="plist-price hs-prices">
                      <span className="hs-pv hs-server">
                        <span className="hs-lbl">Server</span> {formatRupiah(r.harga_server)}
                        {r.biaya ? <span className="hs-biaya"> +{formatRupiah(r.biaya)}</span> : null}
                      </span>
                      <span className="hs-daftar">
                        <span className="hs-pv"><span className="hs-lbl">Modal</span> {formatRupiah(r.modal_daftar)}</span>
                        {' • '}
                        <span className="hs-pv"><span className="hs-lbl">Jual</span> {formatRupiah(r.harga_jual_daftar)}</span>
                      </span>
                    </span>
                  </span>
                  <span className="plist-row-actions">
                    {(r.status === 'naik' || r.status === 'turun') && (
                      <Button variant="secondary" size="sm" loading={updateBusy[r.kode_produk]} onClick={(e) => { e.stopPropagation(); doUpdateModal(r); }} title="Samakan modal Daftar Barang dengan harga server">
 Terapkan
                      </Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); setLinkTarget(r); }} title="Hubungkan ke produk lokal">Link</Button>
                    <Button variant="ghost" size="sm" aria-label={`Edit ${r.nama_produk}`} onClick={(e) => { e.stopPropagation(); setEditTarget(r); }}>
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>

          {filteredItems.length > visibleItems.length && (
            <div className="hs-showmore">
              <Button variant="ghost" onClick={() => setShowAll(true)}>
                Tampilkan {filteredItems.length - visibleItems.length} lainnya
              </Button>
            </div>
          )}
          {showAll && (
            <div className="hs-showmore">
              <Button variant="ghost" onClick={() => setShowAll(false)}>Kembali ke yang perlu tindakan</Button>
            </div>
          )}
        </>
      )}

      {/* Menu lainnya (pengganti 4 tombol di header) */}
      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu Harga Server">
        <div className="flex flex-col gap-2">
          <Button variant="secondary" onClick={() => { setMenuOpen(false); doAutoLink(); }} loading={autoLinkBusy}>
 Auto-link ke produk lokal
          </Button>
          <Button variant="secondary" onClick={() => { setMenuOpen(false); setImportOpen(true); }}>
 Import Harga Server
          </Button>
          <Button variant="secondary" onClick={() => { setMenuOpen(false); setLogOpen(true); }}>
 Log Perubahan Harga
          </Button>
          <Button variant="secondary" onClick={() => { setMenuOpen(false); reloadAll(); }}>
 Muat Ulang
          </Button>
          <div className="flex justify-end" style={{ marginTop: 'var(--space-2)' }}>
            <Button variant="secondary" onClick={() => setMenuOpen(false)}>Tutup</Button>
          </div>
        </div>
      </Modal>

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

      {/* Link Modal */}
      <Modal open={Boolean(linkTarget)} onClose={() => setLinkTarget(null)} title="Hubungkan ke Produk Lokal">
        {linkTarget && (
          <LinkForm
            target={linkTarget}
            onCancel={() => setLinkTarget(null)}
            onSaved={() => { setLinkTarget(null); toast.success('Produk dihubungkan.'); reloadAll(); }}
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

function LinkForm({ target, onCancel, onSaved }) {  const toast = useToast();
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.trim()) { setItems([]); return undefined; }
    const t = setTimeout(() => {
      api.get('/produk', { q }).then((r) => setItems(r.items || [])).catch(() => setItems([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const pick = async (kode) => {
    setBusy(true);
    try {
      await api.post('/harga-server/link', { id: target.id, kode_lokal: kode });
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setBusy(true);
    try {
      await api.post('/harga-server/link', { id: target.id, kode_lokal: null });
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm"><b>{target.nama_produk}</b> <span className="text-muted">({target.kode_produk})</span></p>
      {target.kode_lokal && (
        <p className="text-sm flex items-center gap-2">
          Terhubung ke: <b className="num">{target.kode_lokal}</b>
          <Button variant="ghost" size="sm" onClick={unlink} disabled={busy}>Lepas</Button>
        </p>
      )}
      <Field label="Cari produk lokal">
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ketik kode/nama produk lokal…" autoComplete="off" />
      </Field>
      {items.length > 0 && (
        <div className="table-wrap" style={{ maxHeight: 240, overflowY: 'auto' }}>
          <table className="table" style={{ minWidth: 0 }}>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => !busy && pick(p.kode)}>
                  <td className="num text-sm">{p.kode}</td>
                  <td className="text-sm">{p.nama}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onCancel}>Tutup</Button>
      </div>
    </div>
  );
}

function statusLabel(status) {
  return { naik: 'Naik', turun: 'Turun', baru: 'Baru' }[status] || 'OK';
}

function statusTone(status) {
  return { naik: 'warn', turun: 'muted', baru: 'muted' }[status] || 'accent';
}
