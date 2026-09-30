// Gaji Karyawan (PRD 5.10) — ADMIN ONLY (guard di Guard.jsx + backend).
// HARD RULE: nominal gaji tidak pernah tampil ke role Karyawan (PRD 3.2).
// - List gaji harian (auto-input saat Opening / manual_edit).
// - Edit nominal manual (kasus cuti tidak dibayar) → PUT /api/gaji/:id.
// - Atur rate karyawan: flat / custom per hari → POST /api/gaji/rate.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { todayWIB, formatRupiah, formatRupiahInput, parseRupiah } from '../lib/format';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Field, Input, Select, Textarea } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { Table } from '../components/ui/Table';
import { Loader, ErrorState, EmptyState } from '../components/ui/States';
import { Badge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';

const HARI = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'];
const HARI_LABEL = { senin: 'Senin', selasa: 'Selasa', rabu: 'Rabu', kamis: 'Kamis', jumat: 'Jumat', sabtu: 'Sabtu', minggu: 'Minggu' };

export default function GajiPage() {
  const toast = useToast();
  const [month, setMonth] = useState(todayWIB().slice(0, 7)); // YYYY-MM

  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const load = useMemo(
    () => async () => {
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        const data = await api.get('/gaji', { month });
        setState({ status: 'success', data, error: null });
        return data;
      } catch (err) {
        setState({ status: 'error', data: null, error: err });
        throw err;
      }
    },
    [month]
  );

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const [rateOpen, setRateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  const [ownerDate, setOwnerDate] = useState(todayWIB());
  const [owner, setOwner] = useState({ status: 'idle', data: null, error: null });
  const [bagi, setBagi] = useState({ status: 'idle', data: null });
  const [upahOwner, setUpahOwner] = useState('');
  const [unpaid, setUnpaid] = useState({ status: 'idle', items: [] });
  const [payBusy, setPayBusy] = useState(null);
  const loadUnpaid = async () => {
    try {
      const r = await api.get('/gaji/unpaid');
      setUnpaid({ status: 'success', items: r.items || [] });
    } catch {
      setUnpaid({ status: 'error', items: [] });
    }
  };
  useEffect(() => { loadUnpaid(); }, []);

  const bayarGaji = async (uid) => {
    if (!window.confirm('Bayar semua gaji yang belum dibayar milik orang ini dari Tunai Laci?')) return;
    setPayBusy(uid);
    try {
      const r = await api.post('/gaji/bayar', { user_id: uid });
      toast.success(`Gaji ${r.nama} ${formatRupiah(r.total)} dibayar.`);
      await loadUnpaid();
      load().catch(() => {});
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPayBusy(null);
    }
  };
  const [reloadGaji, setReloadGaji] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setOwner({ status: 'loading', data: null, error: null });
    api.get('/gaji/bagi-hasil', { tanggal: ownerDate })
      .then((r) => {
        setBagi({ status: 'success', data: r });
        setUpahOwner(r.owner_upah_harian != null ? String(r.owner_upah_harian) : '');
      })
      .catch(() => setBagi({ status: 'error', data: null }));
    api.get('/gaji/owner', { tanggal: ownerDate })
      .then((res) => { if (!cancelled) setOwner({ status: 'success', data: res, error: null }); })
      .catch((err) => { if (!cancelled) setOwner({ status: 'error', data: null, error: err }); });
    return () => { cancelled = true; };
  }, [ownerDate, reloadGaji]);

  const data = state.data || {};
  const rows = (data.items || []).map((g) => ({ ...g, key: `${g.user_id}-${g.tanggal}` }));
  const totalBulan = rows.reduce((s, g) => s + Number(g.nominal), 0);

  return (
    <div className="page">
      <PageHeader
        title="Gaji Karyawan"
        subtitle="Nominal gaji hanya dapat dilihat Admin. Auto-input saat Opening; admin boleh mengoreksi manual."
        actions={
          <Button variant="secondary" onClick={() => setRateOpen(true)}>
            <Icon name="settings" size={16} /> Atur Rate
          </Button>
        }
      />

      <Card className="mt-4" title="Bagi Hasil Service" subtitle="Porsi laba servis untuk orang yang mengerjakannya. Tersimpan di database — bisa diubah kapan saja.">
        <BagikanHasil
          data={bagi.data}
          upahOwner={upahOwner}
          setUpahOwner={setUpahOwner}
          onReload={() => setReloadGaji((n) => n + 1)}
        />
      </Card>

      <div className="filter-bar">
        <Field label="Bulan">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <div className="summary-item" style={{ alignSelf: 'flex-end' }}>
          <div className="summary-label">Total gaji bulan ini</div>
          <div className="summary-value num">{formatRupiah(totalBulan)}</div>
        </div>
      </div>

      <Card className="mt-4" title="Gaji Owner" subtitle="Untuk setiap user dengan role admin. Dihitung per orang, tidak dikunci ke satu akun.">
        <div className="grid-2">
          <Field label="Tanggal">
            <Input type="date" value={ownerDate} onChange={(e) => setOwnerDate(e.target.value)} />
          </Field>
        </div>
        {owner.status === 'loading' ? (
          <Loader />
        ) : owner.status === 'error' ? (
          <ErrorState error={owner.error} onRetry={() => setOwnerDate(ownerDate)} />
        ) : owner.data ? (
          <>
            {(owner.data.owners || []).length === 0 ? (
              <p className="text-sm text-muted mt-3">
                Belum ada user dengan role admin. Gaji owner dihitung otomatis untuk setiap admin.
              </p>
            ) : (
              <>
                <div className="table-wrap mt-3">
                  <table className="table table-fit">
                    <thead>
                      <tr>
                        <th>Owner</th>
                        <th className="col-right hide-mobile">Upah/hari</th>
                        <th className="col-right">Laba service</th>
                        <th className="col-right">Bagi hasil</th>
                        <th className="col-right">Total hari ini</th>
                      </tr>
                    </thead>
                    <tbody>
                      {owner.data.owners.map((o) => (
                        <tr key={o.user_id}>
                          <td style={{ fontWeight: 600 }}>{o.nama || `#${o.user_id}`}</td>
                          <td className="col-right num hide-mobile">{formatRupiah(o.upah)}</td>
                          <td className="col-right num">{formatRupiah(o.service_laba)}</td>
                          <td className="col-right num">
                            {formatRupiah(o.service_share)}
                            <span className="text-xs text-muted"> ({o.service_pct}%)</span>
                          </td>
                          <td className="col-right num" style={{ fontWeight: 700 }}>{formatRupiah(o.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td style={{ fontWeight: 700 }}>Total semua owner</td>
                        <td className="hide-mobile" />
                        <td />
                        <td />
                        <td className="col-right num" style={{ fontWeight: 700 }}>{formatRupiah(owner.data.total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="field-hint mt-2">
                  Otomatis ditambahkan ke gaji tiap owner saat Closing. Pembayaran dilakukan di bagian &quot;Gaji Belum Dibayar&quot;.
                </p>
              </>
            )}
          </>
        ) : null}
      </Card>

      <Card className="mt-4" title="Gaji Belum Dibayar">
        {unpaid.status === 'loading' ? (
          <Loader />
        ) : unpaid.items.length === 0 ? (
          <EmptyState title="Tidak ada gaji tertunggak" description="Semua gaji sudah dibayar." icon="gaji" />
        ) : (
          <Table
            columns={[
              { key: 'nama', header: 'Nama', render: (r) => <span style={{ fontWeight: 600 }}>{r.nama}</span> },
              { key: 'jumlah_hari', header: 'Hari', align: 'right', render: (r) => <span className="num">{r.jumlah_hari}</span> },
              { key: 'periode', header: 'Periode', render: (r) => <span className="text-sm text-muted">{r.dari_tanggal} → {r.sampai_tanggal}</span> },
              { key: 'total', header: 'Total', align: 'right', render: (r) => <span className="num">{formatRupiah(r.total)}</span> },
              {
                key: 'aksi', header: '', align: 'right',
                render: (r) => (
                  <Button size="sm" loading={payBusy === r.user_id} onClick={() => bayarGaji(r.user_id)}>
                    <Icon name="wallet" size={14} /> Bayar
                  </Button>
                ),
              },
            ]}
            rows={unpaid.items.map((r) => ({ ...r, key: r.user_id }))}
          />
        )}
      </Card>

      {state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={() => load().catch(() => {})} />
      ) : state.status === 'loading' && !data.items ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyState title="Belum ada data gaji" description="Gaji tercatat otomatis saat Karyawan melakukan Opening." icon="gaji" />
      ) : (
        <Table
          columns={[
            { key: 'nama', header: 'Karyawan', render: (r) => <span style={{ fontWeight: 600 }}>{r.nama_karyawan || r.nama || '-'}</span> },
            { key: 'tanggal', header: 'Tanggal', render: (r) => <span className="text-sm">{r.tanggal}</span> },
            { key: 'sumber', header: 'Sumber', render: (r) => (r.sumber === 'auto' ? <Badge tone="info">Auto</Badge> : <Badge tone="accent">Manual Edit</Badge>) },
            { key: 'bayar', header: 'Bayar', render: (r) => (r.dibayar_at ? <Badge tone="success">Lunas</Badge> : <Badge tone="warning">Belum</Badge>) },
            { key: 'nominal', header: 'Nominal', align: 'right', render: (r) => <span className="num">{formatRupiah(r.nominal)}</span> },
            { key: 'catatan', header: 'Catatan', render: (r) => <span className="text-sm text-muted">{r.catatan || '—'}</span> },
            {
              key: 'aksi',
              header: '',
              render: (r) => (
                <div className="row-actions">
                  <Button variant="ghost" size="sm" aria-label={`Edit gaji ${r.tanggal}`} onClick={() => setEditTarget(r)}>
                    <Icon name="edit" size={15} />
                  </Button>
                </div>
              ),
            },
          ]}
          rows={rows}
        />
      )}

      <Modal open={Boolean(editTarget)} onClose={() => setEditTarget(null)} title={`Koreksi Gaji — ${editTarget?.tanggal}`}>
        <GajiEditForm
          target={editTarget}
          onCancel={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            toast.success('Gaji dikoreksi.');
            load().catch(() => {});
          }}
        />
      </Modal>

      <RateModal open={rateOpen} onClose={() => setRateOpen(false)} onSaved={() => toast.success('Rate tersimpan.')} />
    </div>
  );
}

function GajiEditForm({ target, onCancel, onSaved }) {
  const [nominal, setNominal] = useState(target?.nominal ? formatRupiahInput(String(target.nominal)) : '');
  const [catatan, setCatatan] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!nominal || parseRupiah(nominal) < 0) return setError('Nominal wajib diisi (0 ke atas).');
    setBusy(true);
    try {
      await api.put(`/gaji/${target.id}`, { nominal: parseRupiah(nominal), catatan: catatan.trim() || undefined });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm text-secondary" style={{ background: 'var(--warning-soft)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>
        Karyawan: <strong>{target?.nama || '-'}</strong> — tanggal {target?.tanggal} — sumber {target?.sumber}.
        Gunakan untuk kasus cuti tidak dibayar; perubahan tercatat di audit.
      </p>
      <Field label="Nominal gaji (Rp)" required>
        <Input type="text" inputMode="numeric" value={nominal} onChange={(e) => setNominal(formatRupiahInput(e.target.value))} />
      </Field>
      <Field label="Catatan (opsional)">
        <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. cuti tidak dibayar…" />
      </Field>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" type="button" onClick={onCancel}>Batal</Button>
        <Button type="submit" loading={busy}>Simpan</Button>
      </div>
    </form>
  );
}

function BagikanHasil({ data, busy, upahOwner, setUpahOwner, onReload }) {
  const toast = useToast();
  const [userId, setUserId] = useState('');
  const [persen, setPersen] = useState('');
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  if (!data) return <Loader />;
  const items = data.items || [];
  const sudah = new Set(items.map((i) => i.user_id));
  const belumAdaPorsi = (data.daftar_orang || []).filter((u) => !sudah.has(u.id));

  const simpanPorsi = async () => {
    setErr(null);
    if (!userId) return setErr('Pilih orang dulu.');
    const p = parseRupiah(persen);
    if (persen === '' || Number.isNaN(p) || p < 0 || p > 100) return setErr('Persen harus 0-100.');
    setSaving(true);
    try {
      await api.post('/gaji/bagi-hasil', { user_id: Number(userId), persen: p });
      toast.success('Porsi bagi hasil disimpan.');
      setUserId(''); setPersen('');
      onReload();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  const ubahPorsi = async (id, nilai) => {
    const p = parseRupiah(nilai);
    if (Number.isNaN(p) || p < 0 || p > 100) { setErr('Persen harus 0-100.'); return; }
    setSaving(true);
    try {
      await api.post('/gaji/bagi-hasil', { user_id: id, persen: p });
      toast.success('Porsi diperbarui.');
      onReload();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  const hapusPorsi = async (id, nama) => {
    if (!window.confirm(`Hapus porsi bagi hasil untuk ${nama}? Porsinya jadi 0%.`)) return;
    setSaving(true);
    try {
      await api.del(`/gaji/bagi-hasil-${id}`);
      toast.success('Porsi dihapus.');
      onReload();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  const simpanUpah = async () => {
    setErr(null);
    const n = parseRupiah(upahOwner);
    if (Number.isNaN(n) || n < 0) return setErr('Upah owner tidak valid.');
    setSaving(true);
    try {
      await api.put('/gaji/owner-upah', { nominal: n });
      toast.success('Upah harian owner disimpan.');
      onReload();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  return (
    <>
      <div className="table-wrap">
        <table className="table table-fit">
          <thead>
            <tr>
              <th>Orang</th>
              <th className="col-right">% bagi hasil</th>
              <th className="col-right">Laba servis (tanggal ini)</th>
              <th className="col-right">Diterima</th>
              <th className="col-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={5} className="text-muted text-sm">Belum ada porsi diatur untuk siapa pun. Semua orang (termasuk owner) mendapat 0%. Isi di bawah bila ada yang perlu berbagi hasil.</td></tr>
            )}
            {items.map((i) => (
              <tr key={i.user_id}>
                <td style={{ fontWeight: 600 }}>{i.nama} <span className="text-xs text-muted">({i.role})</span></td>
                <td className="col-right">
                  <Input
                    type="number" min="0" max="100" defaultValue={i.persen}
                    style={{ width: 82, textAlign: 'right' }}
                    aria-label={`Porsi ${i.nama}`}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== i.persen) ubahPorsi(i.user_id, e.target.value);
                    }}
                  />
                </td>
                <td className="col-right num">{formatRupiah(i.service_laba)}</td>
                <td className="col-right num text-success">{formatRupiah(i.share)}</td>
                <td className="col-right">
                  <Button variant="ghost" size="sm" disabled={busy || saving} onClick={() => hapusPorsi(i.user_id, i.nama)} aria-label={`Hapus porsi ${i.nama}`}>
                    <Icon name="trash" size={14} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr>
                <td style={{ fontWeight: 700 }}>Total</td>
                <td />
                <td className="col-right num" style={{ fontWeight: 700 }}>{formatRupiah(data.total_service_laba)}</td>
                <td className="col-right num" style={{ fontWeight: 700, color: 'var(--success)' }}>{formatRupiah(data.total_share)}</td>
                <td />
              </tr>
              <tr>
                <td colSpan={4} className="text-sm text-secondary">Sisa untuk toko ({formatRupiah(data.total_service_laba)} − {formatRupiah(data.total_share)})</td>
                <td className="col-right num" style={{ fontWeight: 700 }}>{formatRupiah(data.sisa_toko)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {data.service_tanpa_teknisi > 0 && (
        <p className="field-hint mt-2">
          Ada servis tanpa teknisi: laba <b className="num">{formatRupiah(data.service_tanpa_teknisi)}</b> — tidak dibagi ke siapa pun, menjadi bagian toko.
          Setel teknisi saat input servis agar ikut dibagikan.
        </p>
      )}

      <div className="grid-2 mt-3">
        <Field label="Tambah / ubah porsi (%)" hint=" Berlaku untuk admin (owner) maupun karyawan. Tersimpan di DB, bukan hardcoded — 0% berarti tidak bagi hasil. Contoh 50 = 50%, maksimal 100.">
          <div className="flex items-end gap-2">
            <Select value={userId} onChange={(e) => setUserId(e.target.value)} style={{ flex: 1 }} aria-label="Orang">
              <option value="">Pilih orang…</option>
              {(belumAdaPorsi.length ? belumAdaPorsi : (data.daftar_orang || [])).map((u) => (
                <option key={u.id} value={u.id}>{u.nama}</option>
              ))}
            </Select>
            <div style={{ position: 'relative', width: 96 }}>
              <Input
                type="number" min="0" max="100" step="1"
                value={persen} onChange={(e) => setPersen(e.target.value)}
                placeholder="0" style={{ textAlign: 'right', paddingRight: 26 }}
                aria-label="Porsi persen" inputMode="numeric"
              />
              <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none', fontSize: '0.85rem' }}>%</span>
            </div>
            <Button onClick={simpanPorsi} loading={saving}>Simpan</Button>
          </div>
        </Field>
        <Field label="Upah harian owner (Rp)" hint="Nominal per hari, bukan persen.">
          <div className="flex items-end gap-2">
            <Input
              value={upahOwner} onChange={(e) => setUpahOwner(e.target.value)}
              placeholder="50000" style={{ flex: 1 }} aria-label="Upah harian owner" inputMode="numeric"
            />
            <Button variant="secondary" onClick={simpanUpah} loading={saving}>Simpan</Button>
          </div>
        </Field>
      </div>

      {err && <p className="field-error" role="alert">{err}</p>}
    </>
  );
}

function RateModal({ open, onClose, onSaved }) {
  const [users, setUsers] = useState([]);
  const [rates, setRates] = useState({});
  const [sel, setSel] = useState('');
  const [tipe, setTipe] = useState('flat');
  const [rateFlat, setRateFlat] = useState('');
  const [custom, setCustom] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    api.get('/users', { limit: 200 }).then((r) => setUsers(r.items || [])).catch(() => {});
    api.get('/gaji/rate').then((r) => {
      const m = {};
      (r.items || []).forEach((r0) => (m[r0.user_id] = r0));
      setRates(m);
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (sel && rates[sel]) {
      setTipe(rates[sel].tipe);
      setRateFlat(rates[sel].rate_flat ?? '');
      //isi ulang rate per hari dari string "senin:60000,rabu:60000,..."
      const custom_ = {};
      for (const pair of String(rates[sel].custom_harian || '').split(',')) {
        const [hari, rate] = pair.split(':');
        if (hari) custom_[hari] = rate ?? '';
      }
      setCustom(custom_);
    } else if (sel) {
      setTipe('flat');
      setRateFlat('');
      setCustom({});
    }
  }, [sel, rates]);

  const save = async () => {
    setError(null);
    if (!sel) return setError('Pilih karyawan.');
    setBusy(true);
    try {
      if (tipe === 'flat') {
        if (!rateFlat || parseRupiah(rateFlat) <= 0) {
          setBusy(false);
          return setError('Rate flat wajib diisi.');
        }
        await api.post('/gaji/rate', { user_id: Number(sel), tipe: 'flat', rate_flat: parseRupiah(rateFlat) });
      } else {
        const harian = HARI.map((h) => ({ hari: h, rate: parseRupiah(custom[h]) }));
        if (harian.some((h) => h.rate <= 0)) {
          setBusy(false);
          return setError('Semua hari wajib diisi untuk tipe custom per hari.');
        }
        await api.post('/gaji/rate', { user_id: Number(sel), tipe: 'custom_harian', custom_harian: harian });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Atur Rate Gaji"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Tutup</Button>
          <Button onClick={save} loading={busy}>Simpan Rate</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Karyawan">
          <Select value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="">Pilih karyawan…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.nama} {rates[u.id] ? `(${rates[u.id].tipe === 'flat' ? 'flat' : 'custom harian'})` : ''}</option>
            ))}
          </Select>
        </Field>
        <Field label="Tipe rate">
          <Select value={tipe} onChange={(e) => setTipe(e.target.value)}>
            <option value="flat">Flat — 1 rate tetap per hari</option>
            <option value="custom_harian">Custom per hari dalam seminggu</option>
          </Select>
        </Field>
        {tipe === 'flat' ? (
          <Field label="Rate harian (Rp)" required>
            <Input type="text" inputMode="numeric" value={rateFlat} onChange={(e) => setRateFlat(formatRupiahInput(e.target.value))} />
          </Field>
        ) : (
          <div className="flex flex-col gap-2">
            {HARI.map((h) => (
              <div key={h} className="flex items-center gap-3">
                <span style={{ width: 90, fontSize: '0.88rem' }}>{HARI_LABEL[h]}</span>
                <Input type="text" inputMode="numeric" value={custom[h] ? formatRupiahInput(custom[h]) : ''} onChange={(e) => setCustom((c) => ({ ...c, [h]: formatRupiahInput(e.target.value) }))} placeholder="0" />
              </div>
            ))}
          </div>
        )}
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}