// Halaman Daftar Barang (PRD 5.5).
// - CRUD produk (POST/PUT/DELETE /api/produk).
// - Kategori: GET/POST/PUT/DELETE /api/kategori/:id (CRUD lengkap).
// - Kategori non-stok (lacak_stok=0) → produk tidak punya field stok (PRD 5.5).
// - stok_minimum → alert stok <= ambang.
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useProdukCache, invalidateProdukCache } from '../hooks/useProdukCache';
import { formatRupiah, todayWIB } from '../lib/format';
import { buildCsv, parseCsv, rowsToObjects, CSV_HEADERS } from '../lib/csv';
import { operatorOf, kodePrefixOf } from '../lib/operator';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Field, Input, Select } from '../components/ui/Field';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { Loader, ErrorState, EmptyState } from '../components/ui/States';
import { Badge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';

const SORT_OPTIONS = [
  { value: 'harga_asc', label: 'Harga jual: termurah' },
  { value: 'harga_desc', label: 'Harga jual: termahal' },
  { value: 'laba_desc', label: 'Laba: terbesar' },
  { value: 'stok_asc', label: 'Stok: tersedikit' },
  { value: 'nama', label: 'Nama (A-Z)' },
];

export default function DaftarBarangPage() {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [filterKategori, setFilterKategori] = useState('');

  // Data produk + kategori di-cache modul (hooks/useProdukCache.js): pindah
  // halaman bolak-balik tidak memicu request ulang. Pencarian & filter
  // dijalankan di sisi klien karena backend mengirim seluruh katalog.
  const { cache, loading, error, reload } = useProdukCache();
  const load = useCallback(async () => {
    invalidateProdukCache();
    return reload();
  }, [reload]);

  const [scanBusy, setScanBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [kategoriOpen, setKategoriOpen] = useState(false);
  const [editKategori, setEditKategori] = useState(null);
  const [deleteKategori, setDeleteKategori] = useState(null);
  const [deleteKategoriBusy, setDeleteKategoriBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sort, setSort] = useState('harga_asc');
  const [selectMode, setSelectMode] = useState(false);

  const kategoriList = cache?.kategori || [];
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const kat = filterKategori ? Number(filterKategori) : null;
    return (cache?.items || [])
      .filter((p) => {
        if (kat && p.kategori_id !== kat) return false;
        if (!needle) return true;
        return (
          String(p.nama || '').toLowerCase().includes(needle) ||
          String(p.kode || '').toLowerCase().includes(needle)
        );
      })
      .map((p) => ({ ...p, key: p.id }));
  }, [cache, q, filterKategori]);
  const kategoriById = useMemo(
    () => Object.fromEntries((cache?.kategori || []).map((k) => [k.id, k])),
    [cache]
  );
  const lowStock = rows.filter((p) => p.kategori_lacak_stok !== 0 && p.stok_minimum > 0 && p.stok <= p.stok_minimum);

  // Grouping tampilan: per Kategori · Operator, urut harga termurah.

  // List mobile dikelompokkan dua tingkat: Kategori -> sub-grup operator/kode
  // (pada Voucher: vi, va, la, vsm, ...). Urutan pilihan dipakai DI DALAM tiap grup.
  const groupedRows = useMemo(() => {
    const cmp = comparatorFor(sort);
    const katOrder = new Map(kategoriList.map((k, i) => [k.nama, i]));
    const tree = new Map();
    for (const r of rows) {
      const kat = kategoriById[r.kategori_id]?.nama || 'Tanpa Kategori';
      const sub = operatorOf(r.kode, r.nama, kat) || 'Lainnya';
      if (!tree.has(kat)) tree.set(kat, new Map());
      const subs = tree.get(kat);
      if (!subs.has(sub)) subs.set(sub, { list: [], prefixes: new Map() });
      const bucket = subs.get(sub);
      bucket.list.push(r);
      const pfx = kodePrefixOf(r.kode, kat);
      if (pfx) bucket.prefixes.set(pfx, (bucket.prefixes.get(pfx) || 0) + 1);
    }
    const cats = [...tree.keys()].sort(
      (a, b) => (katOrder.get(a) ?? 999) - (katOrder.get(b) ?? 999) || a.localeCompare(b, 'id')
    );
    const hargaMin = (list) => list.reduce((min, r) => Math.min(min, Number(r.harga) || 0), Infinity);
    const out = [];
    for (const kat of cats) {
      out.push({ _kat: kat, key: `kat:${kat}` });
      const subs = [...tree.get(kat).entries()].map(([sub, bucket]) => {
        bucket.list.sort(cmp);
        return [sub, bucket];
      });
      subs.sort((a, b) => hargaMin(a[1].list) - hargaMin(b[1].list));
      for (const [sub, bucket] of subs) {
        const top = [...bucket.prefixes.entries()].sort((x, y) => y[1] - x[1])[0];
        out.push({ _sub: sub, _prefix: top ? top[0] : '', key: `sub:${kat}:${sub}` });
        for (const r of bucket.list) out.push(r);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, kategoriById, kategoriList, sort]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    setBulkDeleteBusy(true);
    try {
      for (const id of selectedIds) {
        await api.del(`/produk/${id}`, { deleted_reason: 'bulk delete' });
      }
      toast.success(`${selectedIds.size} produk dihapus.`);
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      load().catch(() => {});
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBulkDeleteBusy(false);
    }
  };

  const handleBulkExport = () => {
    const selected = rows.filter((r) => selectedIds.has(r.id));
    const csv = buildCsv(selected);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `produk-terpilih-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${selected.length} produk di-export.`);
  };

  // Ekspor katalog lengkap ke CSV (client-side dari GET /produk).
  const handleScan = async () => {
    setScanBusy(true);
    try {
      const res = await api.post('/produk/scan-otomatis', {});
      toast.success(`Scan selesai: ${res.dibuat} produk dibuat, ${res.dilewati} dilewati.`);
      load().catch(() => {});
    } catch (err) {
      toast.error(err.message);
    } finally {
      setScanBusy(false);
    }
  };

  const handleExport = async () => {
    try {
      const items = (cache?.items || []).filter((p) => !p.deleted_at);
      const csvRows = items.map((p) => {
        const kategoriNama = p.kategori_nama || kategoriById[p.kategori_id]?.nama || '';
        const nonStok = p.kategori_lacak_stok === 0;
        return {
          kode: p.kode,
          nama: p.nama,
          kategori: kategoriNama,
          harga_modal: p.harga_modal ?? '',
          harga: p.harga ?? '',
          satuan: p.satuan || '',
          stok: nonStok ? '' : (p.stok ?? ''),
          stok_minimum: nonStok ? '' : (p.stok_minimum ?? ''),
        };
      });
      const csv = '\uFEFF' + buildCsv(csvRows);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `daftar-barang-${todayWIB()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      toast.success(`${items.length} produk diekspor ke CSV.`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Import dari CSV: validasi per baris, kategori, duplikat kode, lalu buat via POST /produk.
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportResult(null);
    setImportBusy(true);
    try {
      const text = await file.text();
      const objects = rowsToObjects(parseCsv(text));
      if (objects.length === 0) {
        setImportResult({ ok: 0, errors: [{ row: 1, kode: '', message: 'File kosong atau tidak ada baris data.' }], duplicates: [] });
        return;
      }
      const missingRequired = ['kode', 'nama', 'harga'].filter((h) => !(h in objects[0]));
      if (missingRequired.length > 0) {
        setImportResult({
          ok: 0,
          errors: [{
            row: 1,
            kode: '',
            message: `Kolom wajib tidak ditemukan: ${missingRequired.join(', ')}. Kolom yang tersedia: ${Object.keys(objects[0]).join(', ') || '(tidak ada)'}. Harap gunakan format hasil Export CSV.`,
          }],
          duplicates: [],
        });
        return;
      }

      const existingKode = new Set((cache?.items || []).map((p) => String(p.kode).toLowerCase()));
      const kategoriByName = new Map(kategoriList.map((k) => [k.nama.toLowerCase(), k]));

      const issues = [];
      const candidates = [];
      objects.forEach((obj, idx) => {
        const rowNo = idx + 2;
        const kode = (obj.kode || '').trim();
        const nama = (obj.nama || '').trim();
        if (!kode) { issues.push({ row: rowNo, kode: '', message: 'kode kosong' }); return; }
        if (!nama) { issues.push({ row: rowNo, kode, message: 'nama kosong' }); return; }
        const harga = parseCsvNumber(obj.harga);
        if (harga == null) { issues.push({ row: rowNo, kode, message: 'harga harus berupa angka (contoh: 15000)' }); return; }
        const hargaModal = obj.harga_modal === '' ? null : parseCsvNumber(obj.harga_modal);
        if (obj.harga_modal !== '' && hargaModal == null) { issues.push({ row: rowNo, kode, message: 'harga_modal harus berupa angka' }); return; }
        const stok = obj.stok === '' ? 0 : parseCsvNumber(obj.stok);
        if (obj.stok !== '' && stok == null) { issues.push({ row: rowNo, kode, message: 'stok harus berupa angka' }); return; }
        const stokMin = obj.stok_minimum === '' ? 0 : parseCsvNumber(obj.stok_minimum);
        if (obj.stok_minimum !== '' && stokMin == null) { issues.push({ row: rowNo, kode, message: 'stok_minimum harus berupa angka' }); return; }
        let kategoriId = null;
        if (obj.kategori !== '') {
          const k = kategoriByName.get(obj.kategori.toLowerCase());
          if (!k) { issues.push({ row: rowNo, kode, message: `kategori "${obj.kategori}" tidak dikenal` }); return; }
          kategoriId = k.id;
        }
        candidates.push({
          rowNo,
          kode,
          data: { kode, nama, harga, harga_modal: hargaModal, kategori_id: kategoriId, satuan: obj.satuan || 'pcs', stok, stok_minimum: stokMin },
        });
      });

      const duplicates = [];
      const unique = [];
      for (const c of candidates) {
        const key = c.kode.toLowerCase();
        if (existingKode.has(key)) {
          duplicates.push({ row: c.rowNo, kode: c.kode, message: 'kode sudah ada — dilewati' });
          continue;
        }
        existingKode.add(key);
        unique.push(c);
      }

      let ok = 0;
      const failed = [];
      for (const c of unique) {
        try {
          await api.post('/produk', c.data);
          ok++;
        } catch (err) {
          failed.push({ row: c.rowNo, kode: c.kode, message: err.message });
        }
      }

      setImportResult({ ok, errors: [...issues, ...failed], duplicates });
      if (ok > 0) {
        toast.success(`${ok} produk diimpor.`);
        load().catch(() => {});
      }
    } catch (err) {
      setImportResult({ ok: 0, errors: [{ row: 1, kode: '', message: err.message }], duplicates: [] });
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Daftar Barang"
        subtitle="Kelola produk & kategori. Kategori non-stok (pulsa/saldo digital) tidak menampilkan field stok."
        actions={
          can('daftar_barang') && (
            <div className="page-actions-desktop desktop-only">
              <Button variant="secondary" onClick={() => setKategoriOpen(true)}>
                <Icon name="plus" size={16} /> Tambah Kategori
              </Button>
              <Button variant="secondary" onClick={handleExport}>
                <Icon name="download" size={16} /> Export CSV
              </Button>
              <Button variant="secondary" onClick={() => { setImportResult(null); setImportOpen(true); }}>
                <Icon name="database" size={16} /> Import CSV
              </Button>
              <Button variant="secondary" onClick={handleScan} loading={scanBusy}>
                <Icon name="refresh" size={16} /> Scan Produk
              </Button>
              <Button onClick={() => navigate('/daftar-barang/tambah')}>
                <Icon name="plus" size={16} /> Tambah Produk
              </Button>
            </div>
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

      <div className="plist-search">
        <button type="button" className="plist-filter-btn mobile-only" onClick={() => setFilterOpen(true)} aria-label="Filter dan urutkan produk">
          <Icon name="sort" size={22} />
        </button>
        <div className="plist-search-box">
          <Icon name="search" size={18} />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama atau kode barang"
            aria-label="Cari nama atau kode barang"
          />
        </div>
        <div className="desktop-only" style={{ flex: '0 0 230px' }}>
          <Select value={filterKategori} onChange={(e) => setFilterKategori(e.target.value)} aria-label="Filter kategori">
            <option value="">Semua kategori</option>
            {kategoriList.filter((k) => !k.deleted_at).map((k) => (
              <option key={k.id} value={k.id}>{k.nama}{!k.lacak_stok ? ' (non-stok)' : ''}</option>
            ))}
          </Select>
        </div>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => load().catch(() => {})} />
      ) : loading ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyState title="Belum ada produk" description="Tambahkan produk pertama untuk mulai menjual." icon="barang" />
      ) : (
        <>
          {/* Bulk Actions Bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 mb-3" style={{ padding: 'var(--space-3) var(--space-4)', background: 'var(--accent-soft)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent-border)' }}>
              <span className="text-sm font-bold">{selectedIds.size} produk dipilih</span>
              <span className="text-sm text-muted">|</span>
              <Button variant="ghost" size="sm" onClick={handleBulkExport}>
                <Icon name="download" size={14} /> Export
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setBulkDeleteOpen(true)} style={{ color: 'var(--danger)' }}>
                <Icon name="trash" size={14} /> Hapus
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                <Icon name="close" size={14} /> Batal
              </Button>
            </div>
          )}

          <div className="plist">
            {groupedRows.map((r) => {
              if (r._kat) {
                return (
                  <div key={r.key} className="plist-kat">{r._kat}</div>
                );
              }
              if (r._sub) {
                return (
                  <div key={r.key} className="plist-sub">
                    <span>{r._sub}</span>
                    {r._prefix && <code className="plist-prefix">{r._prefix}*</code>}
                  </div>
                );
              }
              const tag = stokTag(r);
              const laba = (Number(r.harga) || 0) - (Number(r.harga_modal) || 0);
              const labaCls = laba < 0 ? 'text-danger' : laba === 0 ? 'text-warning' : 'text-success';
              const selected = selectedIds.has(r.id);
              return (
                <div
                  key={r.id}
                  className="plist-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (selectMode) toggleSelect(r.id);
                    else navigate(`/daftar-barang/edit/${r.id}`);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.currentTarget.click();
                    }
                  }}
                >
                  {selectMode ? (
                    <span className="plist-check">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelect(r.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Pilih ${r.nama}`}
                      />
                    </span>
                  ) : (
                    <span className="plist-avatar">{initials(r.nama)}</span>
                  )}
                  <span className="plist-body">
                    <span className="plist-name">{r.nama}</span>
                    <span className="plist-kode">{r.kode}</span>
                  </span>
                  <span className="plist-side">
                    <span className="plist-tagline">
                      <span className={`plist-tag plist-tag-${tag.tone}`}>{tag.label}</span>
                      <span className={`plist-laba ${labaCls}`}>Laba {formatRupiah(laba)}</span>
                    </span>
                    <span className="plist-price">
                      {r.harga_modal != null && (
                        <>
                          <span className="plist-modal">{formatRupiah(r.harga_modal)}</span>
                          <span> • </span>
                        </>
                      )}
                      <span className="plist-jual">{formatRupiah(r.harga)}</span>
                    </span>
                  </span>
                  <span className="plist-row-actions desktop-only">
                    <Button variant="ghost" size="sm" aria-label={`Edit ${r.nama}`} onClick={(e) => { e.stopPropagation(); navigate(`/daftar-barang/edit/${r.id}`); }}>
                      <Icon name="edit" size={15} />
                    </Button>
                    <Button variant="ghost" size="sm" aria-label={`Hapus ${r.nama}`} onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}>
                      <Icon name="trash" size={15} />
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Filter & urutan (mobile) */}
      <Modal open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter & Urutkan">
        <div className="flex flex-col gap-4">
          <Field label="Urutkan">
            <Select value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Kategori">
            <Select value={filterKategori} onChange={(e) => setFilterKategori(e.target.value)}>
              <option value="">Semua kategori</option>
              {kategoriList.filter((k) => !k.deleted_at).map((k) => (
                <option key={k.id} value={k.id}>{k.nama}{!k.lacak_stok ? ' (non-stok)' : ''}</option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={selectMode} onChange={(e) => setSelectMode(e.target.checked)} />
            Mode pilih beberapa (untuk export/hapus massal)
          </label>
          {can('daftar_barang') && (
            <>
              <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: 0 }} />
              <div className="flex flex-col gap-2">
                <Button variant="secondary" onClick={() => { setFilterOpen(false); setKategoriOpen(true); }}>
                  <Icon name="plus" size={16} /> Tambah Kategori
                </Button>
                <Button variant="secondary" onClick={() => { setFilterOpen(false); handleExport(); }}>
                  <Icon name="download" size={16} /> Export CSV
                </Button>
                <Button variant="secondary" onClick={() => { setFilterOpen(false); setImportResult(null); setImportOpen(true); }}>
                  <Icon name="database" size={16} /> Import CSV
                </Button>
                <Button variant="secondary" onClick={() => { setFilterOpen(false); handleScan(); }} loading={scanBusy}>
                  <Icon name="refresh" size={16} /> Scan Produk
                </Button>
              </div>
            </>
          )}
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setFilterOpen(false)}>Selesai</Button>
        </div>
      </div>
      </Modal>

      {can('daftar_barang') && (
        <button type="button" className="fab mobile-only" onClick={() => navigate('/daftar-barang/tambah')} aria-label="Tambah produk">
          <Icon name="plus" size={26} />
        </button>
      )}

      {/* Form kategori (CRUD lengkap: GET/POST/PUT/DELETE) */}
      <Modal open={kategoriOpen} onClose={() => { setKategoriOpen(false); setEditKategori(null); }} title="Kategori Produk">
        <div className="flex flex-col gap-4">
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Lacak Stok</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {kategoriList.map((k) => (
                  <tr key={k.id}>
                    <td>{k.nama}</td>
                    <td>{k.lacak_stok ? <Badge tone="success">Ya</Badge> : <Badge tone="neutral">Tidak</Badge>}</td>
                    <td>
                      <div className="row-actions">
                        <Button variant="ghost" size="sm" aria-label={`Edit ${k.nama}`} onClick={() => setEditKategori(k)}>
                          <Icon name="edit" size={15} />
                        </Button>
                        <Button variant="ghost" size="sm" aria-label={`Hapus ${k.nama}`} onClick={() => setDeleteKategori(k)}>
                          <Icon name="trash" size={15} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {kategoriList.length === 0 && (
                  <tr><td colSpan={3} className="text-muted">Belum ada kategori.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {editKategori ? (
            <KategoriEditForm
              initial={editKategori}
              onSaved={() => {
                setEditKategori(null);
                load().catch(() => {});
                toast.success('Kategori diperbarui.');
              }}
              onCancel={() => setEditKategori(null)}
            />
          ) : (
            <KategoriForm
              onSaved={() => {
                setKategoriOpen(false);
                load().catch(() => {});
                toast.success('Kategori ditambahkan.');
              }}
            />
          )}
        </div>
      </Modal>

      {/* Import produk dari CSV */}
      <Modal open={importOpen} onClose={() => { setImportOpen(false); setImportResult(null); }} title="Import Produk dari CSV" size="lg">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Gunakan file hasil <b>Export CSV</b> (kolom: <code>{CSV_HEADERS.join(', ')}</code>).
            Baris dengan kode duplikat atau kategori tidak dikenal akan dilewati dan ditandai di bawah; data lama tidak diubah.
          </p>
          <div className="flex items-center gap-3">
            <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
              <Icon name="download" size={15} /> Pilih File CSV…
              <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleImportFile} />
            </label>
            {importBusy && <span className="text-sm text-muted">Membuat produk…</span>}
          </div>

          {importResult && (
            <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <table className="table" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th>Hasil</th>
                    <th>Baris</th>
                    <th>Kode</th>
                    <th>Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  {importResult.ok > 0 && (
                    <tr>
                      <td><Badge tone="success">Berhasil</Badge></td>
                      <td>—</td>
                      <td>—</td>
                      <td>{importResult.ok} produk dibuat.</td>
                    </tr>
                  )}
                  {importResult.errors.map((r, i) => (
                    <tr key={`e${i}`}>
                      <td><Badge tone="danger">Gagal</Badge></td>
                      <td className="num">{r.row}</td>
                      <td className="num">{r.kode || '—'}</td>
                      <td>{r.message}</td>
                    </tr>
                  ))}
                  {importResult.duplicates.map((r, i) => (
                    <tr key={`d${i}`}>
                      <td><Badge tone="neutral">Dilewati</Badge></td>
                      <td className="num">{r.row}</td>
                      <td className="num">{r.kode || '—'}</td>
                      <td>{r.message}</td>
                    </tr>
                  ))}
                  {importResult.errors.length === 0 && importResult.duplicates.length === 0 && (
                    <tr><td colSpan={4} className="text-muted">Semua baris valid.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
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

      <ConfirmDialog
        open={bulkDeleteOpen}
        title="Hapus Produk Terpilih"
        message={`${selectedIds.size} produk akan dihapus secara soft-delete. Lanjutkan?`}
        confirmLabel="Hapus Semua"
        loading={bulkDeleteBusy}
        onCancel={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
      />

      <ConfirmDialog
        open={Boolean(deleteKategori)}
        title="Hapus Kategori"
        message={`Kategori "${deleteKategori?.nama}" akan dihapus permanen. Lanjutkan?`}
        confirmLabel="Hapus"
        loading={deleteKategoriBusy}
        onCancel={() => setDeleteKategori(null)}
        onConfirm={async () => {
          setDeleteKategoriBusy(true);
          try {
            await api.del(`/kategori/${deleteKategori.id}`);
            setDeleteKategori(null);
            toast.success('Kategori dihapus.');
            load().catch(() => {});
            load().catch(() => {});
          } catch (err) {
            toast.error(err.message);
          } finally {
            setDeleteKategoriBusy(false);
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

function KategoriEditForm({ initial, onSaved, onCancel }) {
  const [nama, setNama] = useState(initial.nama || '');
  const [lacakStok, setLacakStok] = useState(Boolean(initial.lacak_stok));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!nama.trim()) return setError('Nama kategori wajib diisi.');
    setBusy(true);
    try {
      await api.put(`/kategori/${initial.id}`, { nama: nama.trim(), lacak_stok: lacakStok ? 1 : 0 });
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
      <div className="flex gap-2">
        <Button variant="secondary" type="button" onClick={onCancel}>Batal</Button>
        <Button type="submit" loading={busy}>Simpan</Button>
      </div>
    </form>
  );
}

// Angka CSV: terima hanya digit (toleransi pemisah ribuan "1.500" / spasi); non-numerik → null.
function parseCsvNumber(v) {
  const s = String(v == null ? '' : v).replace(/[^0-9]/g, '');
  return s === '' ? null : Number(s);
}

// Avatar list mobile: 2 karakter pertama nama (mis. "1,5GB" -> "1,", "10GB" -> "10").
function initials(nama) {
  const s = String(nama || '').trim();
  return (s.slice(0, 2) || '?').toUpperCase();
}

// Tag di sisi kanan list mobile = stok. Kategori non-stok ditandai "∞".
function stokTag(p) {
  if (p.kategori_lacak_stok === 0) return { label: '∞', tone: 'muted' };
  const stok = Number(p.stok) || 0;
  const min = Number(p.stok_minimum) || 0;
  if (min > 0 && stok <= min) return { label: `Stok ${stok}`, tone: 'warn' };
  return { label: `Stok ${stok}`, tone: 'accent' };
}

// Pembanding urut di dalam tiap grup.
function comparatorFor(sort) {
  const harga = (r) => Number(r.harga) || 0;
  const laba = (r) => harga(r) - (Number(r.harga_modal) || 0);
  if (sort === 'harga_asc') return (a, b) => harga(a) - harga(b);
  if (sort === 'harga_desc') return (a, b) => harga(b) - harga(a);
  if (sort === 'laba_desc') return (a, b) => laba(b) - laba(a);
  if (sort === 'stok_asc') return (a, b) => (Number(a.stok) || 0) - (Number(b.stok) || 0);
  return (a, b) => String(a.nama || '').localeCompare(String(b.nama || ''), 'id');
}