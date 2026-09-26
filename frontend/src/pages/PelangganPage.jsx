// Halaman Pelanggan (PRD 5.8): list+ranking, tambah, detail (riwayat, alias,
// kasbon), gabung manual (merge). Tujuan utama ranking pelanggan setia.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useDebounce } from '../hooks/useDebounce';
import { parseVCard, normalisasiTelepon, JENIS_NOMOR, tipeAliasUntuk } from '../lib/vcard';
import { formatRupiah, formatDateTime } from '../lib/format';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Field, Input, Select } from '../components/ui/Field';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { Table } from '../components/ui/Table';
import { Loader, ErrorState, EmptyState } from '../components/ui/States';
import { Badge, PelunasanBadge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';

const LIMIT = 100;


// Label tipe alias & sumber yang mudah dibaca (bukan nilai mentah database).
const ALIAS_LABEL = { nama: 'Nama lain', no_rekening: 'Rekening', no_hp: 'Nomor HP' };
const SUMBER_LABEL = { manual: 'Manual', notifhook_auto: 'Otomatis (NotifHook)' };

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
  const [importError, setImportError] = useState(null);
  const [vcfList, setVcfList] = useState([]);
  const [vcfResult, setVcfResult] = useState(null);
  const [jenisPilihan, setJenisPilihan] = useState({});
  const [importBusy, setImportBusy] = useState(false);

  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ nama: '', telepon: '' });
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState(null);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [aliasForm, setAliasForm] = useState({ tipe: 'no_rekening', nilai: '' });
  const [aliasEdit, setAliasEdit] = useState(null);
  const [aliasBusy, setAliasBusy] = useState(false);
  const [aliasDelete, setAliasDelete] = useState(null);

  useEffect(() => {
    if (editTarget) setEditForm({ nama: editTarget.nama || '', telepon: editTarget.telepon || '' });
  }, [editTarget]);

  const data = state.data || {};
  const rows = (data.items || []).map((p) => ({ ...p, key: p.id }));

  const reloadDetail = async () => {
    if (!detail?.id) return;
    try {
      const res = await api.get(`/pelanggan/${detail.id}`);
      setDetail(res.pelanggan || res);
    } catch { /* abaikan */ }
  };

  const addAlias = async () => {
    if (!aliasForm.nilai.trim()) return toast.warning('Nilai alias wajib diisi.');
    setAliasBusy(true);
    try {
      await api.post(`/pelanggan/${detail.id}/alias`, { tipe: aliasForm.tipe, nilai: aliasForm.nilai.trim() });
      setAliasForm({ tipe: aliasForm.tipe, nilai: '' });
      toast.success('Alias ditambahkan.');
      await reloadDetail();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAliasBusy(false);
    }
  };

  const saveAliasEdit = async () => {
    if (!aliasEdit?.nilai?.trim()) return toast.warning('Nilai alias wajib diisi.');
    setAliasBusy(true);
    try {
      await api.put(`/pelanggan/alias/${aliasEdit.id}`, { tipe: aliasEdit.tipe, nilai: aliasEdit.nilai.trim() });
      setAliasEdit(null);
      toast.success('Alias diperbarui.');
      await reloadDetail();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAliasBusy(false);
    }
  };

  const doDeleteAlias = async () => {
    setAliasBusy(true);
    try {
      await api.del(`/pelanggan/alias/${aliasDelete.id}`);
      toast.success('Alias dihapus.');
      setAliasDelete(null);
      await reloadDetail();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAliasBusy(false);
    }
  };

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
      await api.post('/pelanggan/merge', { id_gabung: Number(mergeSel.a), id_utama: Number(mergeSel.b) });
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

  const closeImportOpen = () => { setImportOpen(true); setImportError(null); setVcfList([]); setVcfResult(null); setJenisPilihan({}); };

  // Import kontak dari file .vcf — Contact Picker API (navigator.contacts)
  // tidak berfungsi di Android WebView (APK Capacitor).
  const closeImport = () => {
    setImportOpen(false);
    setVcfList([]);
    setVcfResult(null);
    setImportError(null);
    setJenisPilihan({});
  };

  const pickVcf = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError(null);
    setVcfResult(null);
    try {
      const parsed = parseVCard(await file.text());
      if (parsed.length === 0) {
        setVcfList([]);
        setImportError('Tidak ada kontak terbaca dari file itu. Pastikan format .vcf (vCard).');
        return;
      }
      setVcfList(parsed);
      setJenisPilihan({});
    } catch (err) {
      setVcfList([]);
      setImportError(`Gagal membaca file: ${err?.message || 'kesalahan tidak diketahui'}.`);
    }
  };

  // Nomor utama (tipe hp) = kolom telepon; sisanya = alias.
  const nomorKontak = (c) =>
    c.nomor.map((n, i) => ({ ...n, key: `${c.nama}-${i}`, jenis: jenisPilihan[`${c.nama}-${i}`] || n.jenis }));

  const sudahAda = (nomor) => {
    const key = normalisasiTelepon(nomor);
    return key ? rows.some((p) => p.telepon && normalisasiTelepon(p.telepon) === key) : false;
  };

  const siapDiimpor = vcfList.filter((c) => c.nama.trim() && nomorKontak(c).length > 0);

  const doImportVcf = async () => {
    if (siapDiimpor.length === 0) return;
    setImportBusy(true);
    setImportError(null);
    let ok = 0;
    const gagal = [];
    for (const c of siapDiimpor) {
      const semua = nomorKontak(c).filter((n) => !sudahAda(n.nomor));
      if (semua.length === 0) continue;
      // Nomor HP pertama jadi telepon utama; rekening/token jadi alias.
      const utama = semua.find((n) => n.jenis === 'hp') || semua[0];
      try {
        const res = await api.post('/pelanggan', { nama: c.nama.trim(), telepon: utama.nomor });
        ok += 1;
        for (const n of semua) {
          if (n.nomor === utama.nomor) continue;
          try {
            await api.post(`/pelanggan/${res.id}/alias`, { tipe: tipeAliasUntuk(n.jenis), nilai: n.nomor });
          } catch {
            // alias gagal (mis. duplikat) tidak menghentikan import
          }
        }
      } catch (err) {
        gagal.push(`${c.nama}: ${err.message}`);
      }
    }
    setVcfResult({ ok, gagal, total: siapDiimpor.length });
    if (ok > 0) {
      toast.success(`${ok} pelanggan diimpor dari file kontak.`);
      load().catch(() => {});
    }
    setImportBusy(false);
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
                onClick={closeImportOpen}
                title="Impor kontak dari file .vcf (nama & nomor HP), bisa banyak sekaligus"
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

      {createOpen && can('pelanggan') && (
        <div className="card mb-4" style={{ padding: 'var(--space-4)' }}>
          <PelangganForm
            onCancel={() => setCreateOpen(false)}
            onSaved={() => {
              setCreateOpen(false);
              toast.success('Pelanggan ditambahkan.');
              load().catch(() => {});
            }}
          />
        </div>
      )}

      {detailOpen && (
        <div className="card mb-4" style={{ padding: 'var(--space-4)' }}>
          {detailLoading ? (
            <Loader />
          ) : detail?._error ? (
            <ErrorState error={{ message: detail._error }} />
          ) : detail ? (
            <>
              <div className="flex justify-between items-center mb-3">
                <h3 className="card-title">Detail: {detail.nama}</h3>
                <div className="flex gap-2">
                  {can('pelanggan') && (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => { setEditTarget(detail); setDetailOpen(false); setDetail(null); }}>
                        <Icon name="edit" size={14} /> Edit
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => { setDeleteTarget(detail); setDetailOpen(false); setDetail(null); }}>
                        <Icon name="trash" size={14} /> Hapus
                      </Button>
                    </>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => { setDetailOpen(false); setDetail(null); }}>Tutup</Button>
                </div>
              </div>

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
                    <ul className="alias-list">
                      {detail.alias.map((a) => (
                        <li key={a.id} className="alias-item">
                          {aliasEdit?.id === a.id ? (
                            <div className="alias-form">
                              <Select
                                value={aliasEdit.tipe}
                                aria-label="Tipe alias"
                                onChange={(e) => setAliasEdit((s) => ({ ...s, tipe: e.target.value }))}
                              >
                                <option value="nama">Nama lain</option>
                                <option value="no_rekening">Rekening</option>
                                <option value="no_hp">Nomor HP</option>
                              </Select>
                              <input
                                className="input"
                                aria-label="Nilai alias"
                                value={aliasEdit.nilai}
                                onChange={(e) => setAliasEdit((s) => ({ ...s, nilai: e.target.value }))}
                              />
                              <div className="alias-form-aksi">
                                <Button size="sm" loading={aliasBusy} onClick={saveAliasEdit}>Simpan</Button>
                                <Button size="sm" variant="secondary" onClick={() => setAliasEdit(null)}>Batal</Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="alias-item-top">
                                <Badge tone={a.tipe === 'no_rekening' ? 'info' : a.tipe === 'no_hp' ? 'success' : 'neutral'}>
                                  {ALIAS_LABEL[a.tipe] || a.tipe}
                                </Badge>
                                <span className="text-xs text-muted">{SUMBER_LABEL[a.sumber] || a.sumber}</span>
                                <span className="alias-spacer" />
                                <Button variant="ghost" size="sm" aria-label={`Edit alias ${a.nilai}`} onClick={() => setAliasEdit({ id: a.id, tipe: a.tipe, nilai: a.nilai })}>
                                  <Icon name="edit" size={14} />
                                </Button>
                                <Button variant="ghost" size="sm" aria-label={`Hapus alias ${a.nilai}`} onClick={() => setAliasDelete(a)}>
                                  <Icon name="trash" size={14} />
                                </Button>
                              </div>
                              <div className="alias-item-nilai">{a.nilai}</div>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted">Belum ada alias.</p>
                  )}

                  <div className="alias-form mt-3">
                    <Select
                      value={aliasForm.tipe}
                      aria-label="Tipe alias baru"
                      onChange={(e) => setAliasForm((f) => ({ ...f, tipe: e.target.value }))}
                    >
                      <option value="nama">Nama lain</option>
                      <option value="no_rekening">Rekening</option>
                      <option value="no_hp">Nomor HP</option>
                    </Select>
                    <input
                      className="input"
                      placeholder="Contoh: 9876543210 atau 0812…"
                      aria-label="Nilai alias baru"
                      value={aliasForm.nilai}
                      onChange={(e) => setAliasForm((f) => ({ ...f, nilai: e.target.value }))}
                    />
                    <div className="alias-form-aksi">
                      <Button size="sm" loading={aliasBusy} onClick={addAlias}>Tambah</Button>
                    </div>
                  </div>
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
                  {detail.riwayat_transaksi?.length ? (
                    <Table
                      columns={[
                        { key: 'kode_transaksi', header: 'Kode', render: (r) => <span className="num text-sm">{r.kode_transaksi}</span> },
                        { key: 'created_at', header: 'Waktu', render: (r) => <span className="text-xs">{formatDateTime(r.created_at)}</span> },
                        { key: 'total', header: 'Total', render: (r) => <span className="num text-sm">{formatRupiah(r.total)}</span> },
                      ]}
                      rows={detail.riwayat_transaksi.map((t) => ({ ...t, key: t.id }))}
                    />
                  ) : (
                    <p className="text-sm text-muted">Belum ada riwayat.</p>
                  )}
                </section>
              </div>
            </>
          ) : null}
        </div>
      )}

      {state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={() => load().catch(() => {})} />
      ) : state.status === 'loading' && !data.items ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyState title="Belum ada pelanggan" description="Tambahkan pelanggan atau transaksi akan berjalan sebagai Umum/Tanpa Nama." icon="pelanggan" />
      ) : (
        <div className="table-fit">
          <Table
            onRowClick={(r) => openDetail(r)}
            columns={[
              {
                key: 'nama',
                header: 'Nama',
                render: (r) => (
                  <>
                    <span style={{ fontWeight: 600 }}>{r.nama}</span>
                    {(r.telepon || r.alias_count > 0) && (
                      <span className="col-sub">
                        {r.telepon || '—'}
                        {r.alias_count > 0 && <span className="col-sub-alias"> · {r.alias_count} alias</span>}
                      </span>
                    )}
                  </>
                ),
              },
              { key: 'total_belanja', header: 'Total Belanja', align: 'right', render: (r) => <span className="num">{formatRupiah(r.total_belanja)}</span> },
              { key: 'frekuensi_transaksi', header: 'Frekuensi', align: 'right', className: 'hide-mobile', render: (r) => <span className="num">{r.frekuensi_transaksi}</span> },
              {
                key: 'alias',
                header: 'Alias',
                className: 'hide-mobile',
                render: (r) =>
                  r.alias_count ? <Badge tone="info">{r.alias_count} alias</Badge> : <span className="text-muted">—</span>,
              },
            ]}
            rows={rows}
          />
        </div>
      )}

      {/* Import Kontak dari file .vcf */}
      <Modal open={importOpen} onClose={closeImport} title="Import Kontak (.vcf)" size="lg">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-secondary">
            Pilih file <b>.vcf</b> dari perangkat. Di HP: Kontak → pilih kontak →
            Bagikan / Ekspor → <b>Simpan sebagai vCard</b> (atau ekspor semua kontak
            dari Google Contacts). Semua kontak dalam 1 file akan bisa diimpor sekaligus.
          </p>

          <label className="btn btn-secondary" style={{ cursor: 'pointer', alignSelf: 'flex-start' }}>
            <Icon name="download" size={15} /> Pilih File .vcf…
            <input type="file" accept=".vcf,text/vcard,text/x-vcard,text/plain" style={{ display: 'none' }} onChange={pickVcf} />
          </label>

          {vcfList.length > 0 && (
            <>
              <p className="text-sm">
                Terbaca <b>{vcfList.length}</b> kontak · <b>{siapDiimpor.length}</b> siap diimpor
                {siapDiimpor.length < vcfList.length && ' (sisanya tanpa nama atau tanpa nomor)'}
                . Nomor HP jadi telepon, rekening &amp; token listrik disimpan sebagai alias — jenisnya
                bisa diubah di bawah ini.
              </p>
              <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
                <table className="table" style={{ minWidth: 0 }}>
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Nomor</th>
                      <th>Jenis</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vcfList.map((c, ci) => (
                      <Fragment key={`kontak-${ci}`}>
                        {nomorKontak(c).length === 0 ? (
                          <tr>
                            <td className="text-sm">{c.nama || <span className="text-muted">(tanpa nama)</span>}</td>
                            <td className="num text-sm"><span className="text-muted">—</span></td>
                            <td className="text-sm"><span className="text-muted">—</span></td>
                            <td><Badge tone="neutral">Tanpa nomor</Badge></td>
                          </tr>
                        ) : (
                          nomorKontak(c).map((n, ni) => {
                            const dup = sudahAda(n.nomor);
                            return (
                              <tr key={n.key}>
                                <td className="text-sm">{ni === 0 ? (c.nama || <span className="text-muted">(tanpa nama)</span>) : ''}</td>
                                <td className="num text-sm">{n.nomor}</td>
                                <td>
                                  <Select
                                    value={n.jenis}
                                    aria-label={`Jenis nomor ${n.nomor}`}
                                    onChange={(e) => setJenisPilihan((p) => ({ ...p, [n.key]: e.target.value }))}
                                    style={{ padding: '2px 6px', fontSize: '0.8rem' }}
                                  >
                                    {JENIS_NOMOR.map((j) => (
                                      <option key={j.value} value={j.value}>{j.label}</option>
                                    ))}
                                  </Select>
                                </td>
                                <td>{dup ? <Badge tone="warning">Sudah ada</Badge> : <Badge tone="success">Siap</Badge>}</td>
                              </tr>
                            );
                          })
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {vcfResult && (
            <p className="text-sm">
              {vcfResult.ok} berhasil disimpan.
              {vcfResult.gagal.length > 0 && (
                <span className="text-danger"> {vcfResult.gagal.length} gagal: {vcfResult.gagal.slice(0, 3).join('; ')}</span>
              )}
            </p>
          )}

          {importError && <p className="field-error" role="alert">{importError}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeImport}>Tutup</Button>
            {siapDiimpor.length > 0 && (
              <Button onClick={doImportVcf} loading={importBusy}>
                Import {siapDiimpor.length} Pelanggan
              </Button>
            )}
          </div>
        </div>
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
          <Button onClick={doMerge} loading={mergeBusy} disabled={!mergeSel.a || !mergeSel.b || mergeSel.a === mergeSel.b}>Gabungkan</Button>
        </>
      }>
        <p className="text-sm text-secondary mb-4">
          Data dari pelanggan <b>sumber</b> akan diarahkan ke pelanggan <b>tujuan</b>. Riwayat gabungan (alias) tetap tersimpan.
        </p>
        <div className="flex flex-col gap-3">
          <Field label="Pelanggan Sumber (akan dihapus, digabung ke tujuan)" required>
            <Select value={mergeSel.a} onChange={(e) => setMergeSel((s) => ({ ...s, a: e.target.value }))}>
              <option value="">Pilih sumber…</option>
              {rows.filter((p) => p.id !== mergeSel.b).map((p) => <option key={p.id} value={p.id}>{p.nama}</option>)}
            </Select>
          </Field>
          <Field label="Pelanggan Tujuan (data ini dipertahankan)" required>
            <Select value={mergeSel.b} onChange={(e) => setMergeSel((s) => ({ ...s, b: e.target.value }))}>
              <option value="">Pilih tujuan…</option>
              {rows.filter((p) => p.id !== mergeSel.a).map((p) => <option key={p.id} value={p.id}>{p.nama}</option>)}
            </Select>
          </Field>
          {mergeSel.a && mergeSel.b && mergeSel.a === mergeSel.b && (
            <p className="field-error">Sumber dan tujuan tidak boleh sama!</p>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(aliasDelete)}
        title="Hapus Alias"
        message={`Hapus alias ${aliasDelete?.tipe} "${aliasDelete?.nilai}"?`}
        confirmLabel="Hapus"
        loading={aliasBusy}
        onCancel={() => setAliasDelete(null)}
        onConfirm={doDeleteAlias}
      />
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
    <form onSubmit={submit}>
      <div className="grid-2">
        <Field label="Nama" required>
          <Input type="text" value={form.nama} onChange={(e) => setForm((f) => ({ ...f, nama: e.target.value }))} />
        </Field>
        <Field label="Telepon / nomor (opsional)" hint="HP/rekening jadi alias untuk pencocokan NotifHook.">
          <Input type="tel" value={form.telepon} onChange={(e) => setForm((f) => ({ ...f, telepon: e.target.value }))} />
        </Field>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="flex justify-end gap-2 mt-3">
        <Button variant="secondary" type="button" onClick={onCancel}>Batal</Button>
        <Button type="submit" loading={busy}>Simpan</Button>
      </div>
    </form>
  );
}