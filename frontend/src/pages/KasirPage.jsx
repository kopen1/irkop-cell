// Halaman Kasir (PRD 5.3): Opening → Closing (rekonsiliasi), 1 sesi per hari.
// Semua angka saldo = nilai resmi backend (GET /api/kasir/current). Frontend
// TIDAK menebak atau menghitung ulang saldo. Closing TIDAK membuat mutasi baru.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { useAsync } from '../hooks/useAsync';
import { todayWIB, formatRupiah, formatDateTime, formatSignedRupiah, formatRupiahInput, parseRupiah } from '../lib/format';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Field, Input, Textarea } from '../components/ui/Field';
import { Loader, ErrorState, EmptyState } from '../components/ui/States';
import { Modal } from '../components/ui/Modal';
import { KasirStatusBadge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';

function yesterdayWIB() {
  const d = new Date(`${todayWIB()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default function KasirPage() {
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [date] = useState(todayWIB());
  const kemarin = yesterdayWIB();

  const sesi = useAsync(() => api.get('/kasir/current'), { deps: [] });
  const akun = useAsync(() => api.get('/akun'), { deps: [] });
  const reminder = useAsync(() => api.get('/kasir/reminder-closing'), { deps: [] });

  const [opening, setOpening] = useState(null);
  const [openingBusy, setOpeningBusy] = useState(false);
  const [konfirmasiOpening, setKonfirmasiOpening] = useState(null);
  // Float uang laci untuk besok (bisa diubah, disimpan di perangkat).
  const [floatLaci, setFloatLaci] = useState(() => {
    const v = Number(localStorage.getItem('irkop_cell_float_laci'));
    return Number.isFinite(v) && v >= 0 ? v : 500000;
  });
  const [siapkanTarget, setSiapkanTarget] = useState(null);
  const [siapkanBusy, setSiapkanBusy] = useState(false);
  const AKUN_LACI = 'Tunai Laci';
  const AKUN_CADANGAN = 'Uang Cadangan';
  const [koreksiBusy, setKoreksiBusy] = useState(false);
  const [koreksiRows, setKoreksiRows] = useState(null);
  const [closing, setClosing] = useState(null);
  const [closingCatatan, setClosingCatatan] = useState('');
  const [closingBusy, setClosingBusy] = useState(false);
  const [errForm, setErrForm] = useState(null);

  const [editSesi, setEditSesi] = useState(null);
  const [editRows, setEditRows] = useState([]);
  const [editCatatan, setEditCatatan] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState(null);
  const [reopenBusy, setReopenBusy] = useState(false);
  const [reopenTgl, setReopenTgl] = useState('');
  const [reopenLampauBusy, setReopenLampauBusy] = useState(false);

  useEffect(() => {
    if (sesi.status === 'error') return;
    if (sesi.status !== 'success') return;
    if (sesi.data?.status === 'belum_buka' && akun.status === 'success') {
      const akunList = (akun.data?.items || []).filter((a) => a.tipe !== 'lainnya');
      const saran = Object.fromEntries((sesi.data.saldo_awal_saran || []).map((s) => [s.nama_akun, s.saldo]));
      setOpening(
        akunList.length
          ? akunList.map((a) => ({
              nama_akun: a.nama_akun,
              saldo: saran[a.nama_akun] != null ? formatRupiahInput(String(saran[a.nama_akun])) : 0,
            }))
          : []
      );
    }
    if (sesi.data?.status === 'buka') {
      const s = (sesi.data.saldo || []).filter((x) => x.nama_akun !== 'Total Saldo');
      setClosing(
        s.length
          ? s.map((x) => ({
              nama_akun: x.nama_akun,
              saldo_sistem: x.saldo_sistem ?? 0,
              saldo_real: x.saldo_sistem ?? 0,
            }))
          : []
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesi.status, sesi.data, akun.status]);

  if (sesi.status === 'loading') return <Loader />;
  if (sesi.status === 'error') {
    return (
      <div className="page">
        <ErrorState error={sesi.error} onRetry={() => sesi.run()} />
      </div>
    );
  }

  const status = sesi.data?.status;
  const perluDiingatkan = reminder.data?.perlu_diingatkan;
  const sesiLampau = reminder.data?.sesi_buka_lampau || [];
  // Akun tipe "Lainnya" sengaja tidak bisa dipakai di opening/closing.
  // Kalau ada, beri tahu supaya tidak hilang diam-diam.
  const akunTersembunyi = (akun.data?.items || []).filter((a) => a.tipe === 'lainnya');

  const doOpening = async (e) => {
    e.preventDefault();
    setErrForm(null);
    const entries = (opening || []).filter((o) => o.saldo !== '' && o.saldo !== null);
    if (entries.length === 0) {
      setErrForm('Isi saldo awal minimal satu akun.');
      return;
    }
    // Tampilkan dulu ringkasannya supaya angka bisa dicek sebelum tersimpan.
    setKonfirmasiOpening(entries);
  };

  const konfirmasiOpeningJalog = async () => {
    const entries = konfirmasiOpening || [];
    setOpeningBusy(true);
    try {
      const res = await api.post('/kasir/opening', {
        saldo_awal: entries.map((o) => ({ nama_akun: o.nama_akun, saldo: parseRupiah(o.saldo) })),
      });
      toast.success('Kasir dibuka.');
      setKonfirmasiOpening(null);
      if (res.notif_admin) toast.info('Notifikasi Opening telah dikirim ke Admin.');
      sesi.run();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setOpeningBusy(false);
    }
  };

  const mulaiKoreksi = () => {
    const rows = (sesi.data?.saldo || [])
      .filter((s) => s.nama_akun !== 'Total Saldo')
      .map((s) => ({ nama_akun: s.nama_akun, saldo: formatRupiahInput(String(s.saldo_opening ?? 0)) }));
    setKoreksiRows(rows);
  };

  const simpanKoreksi = async () => {
    const entries = (koreksiRows || []).filter((r) => r.saldo !== '' && r.saldo !== null);
    if (entries.length === 0) return;
    setKoreksiBusy(true);
    try {
      await api.put('/kasir/opening', {
        saldo_awal: entries.map((r) => ({ nama_akun: r.nama_akun, saldo: parseRupiah(r.saldo) })),
      });
      toast.success('Saldo awal dikoreksi.');
      setKoreksiRows(null);
      sesi.run();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setKoreksiBusy(false);
    }
  };

  // Saldo real Tunai Laci yang sedang diketik di form Closing (bukan saldo sistem),
  // supaya angkanya sama dengan yang akan benar-benar dihitung user.
  const saldoLaciSekarang = () => {
    const c = (closing || []).find((x) => x.nama_akun === AKUN_LACI);
    if (!c) return 0;
    const v = Number(c.saldo_real);
    return Number.isFinite(v) ? v : Number(c.saldo_sistem || 0);
  };

  const bukaSiapkan = () => {
    const kini = saldoLaciSekarang();
    const sisa = Math.max(0, kini - floatLaci);
    if (sisa <= 0) {
      toast.info(`Uang laci ${formatRupiah(kini)} sudah <= float ${formatRupiah(floatLaci)}. Tidak ada yang perlu dipindahkan.`);
      return;
    }
    setSiapkanTarget({ kini, float: floatLaci, sisa, tanggal: sesi.data?.tanggal });
  };

  // Pindahkan kelebihan laci ke Uang Cadangan sebagai transfer antar akun
  // (uang tetap milik toko, jadi Total Saldo tidak berubah dan rekonsiliasi aman).
  const eksekusiSiapkan = async () => {
    if (!siapkanTarget) return;
    setSiapkanBusy(true);
    try {
      await api.post('/transfer-saldo', {
        dari_akun: AKUN_LACI,
        ke_akun: AKUN_CADANGAN,
        nominal: siapkanTarget.sisa,
        tanggal: siapkanTarget.tanggal || sesi.data?.tanggal,
        catatan: `Float kasir besok ${formatRupiah(siapkanTarget.float)}`,
      });
      toast.success(`${formatRupiah(siapkanTarget.sisa)} dipindahkan ke ${AKUN_CADANGAN}.`);
      setSiapkanTarget(null);
      sesi.run();
      akun.run?.();
      setClosing((c) => c.map((x) => (x.nama_akun === AKUN_LACI ? { ...x, saldo_real: x.saldo_sistem } : x)));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSiapkanBusy(false);
    }
  };

  const doClosing = async (e) => {
    e.preventDefault();
    setErrForm(null);
    if (!closing || closing.length === 0) {
      setErrForm('Tidak ada akun untuk direkonsiliasi.');
      return;
    }
    setClosingBusy(true);
    try {
      await api.post('/kasir/closing', {
        saldo_real: closing.map((c) => ({ nama_akun: c.nama_akun, saldo_real: parseRupiah(c.saldo_real) })),
        catatan_closing: closingCatatan || undefined,
      });
      toast.success('Kasir ditutup. Rekonsiliasi tersimpan.');
      sesi.run();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setClosingBusy(false);
    }
  };

  // Edit sesi lampau (dari reminder): koreksi saldo_real (klosing) + catatan,
  // lalu simpan = melakukan closing untuk sesi tersebut (rekonsiliasi tanpa
  // membuat mutasi baru — aman dan tercatat di audit).
  const openEdit = async (s) => {
    setEditSesi({ ...s });
    setEditRows([]);
    setEditCatatan('');
    setEditErr(null);
    setEditLoading(true);
    setEditBusy(false);
    try {
      const data = await api.get('/kasir/current', { kasir_sesi_id: s.kasir_sesi_id });
      const rows = data.closing?.length
        ? data.closing
            .filter((c) => c.nama_akun !== 'Total Saldo')
            .map((c) => ({ nama_akun: c.nama_akun, saldo_sistem: c.saldo_sistem ?? 0, saldo_real: c.saldo_real ?? c.saldo_sistem ?? 0 }))
        : (data.saldo || [])
            .filter((x) => x.nama_akun !== 'Total Saldo')
            .map((x) => ({ nama_akun: x.nama_akun, saldo_sistem: x.saldo_sistem ?? 0, saldo_real: x.saldo_sistem ?? 0 }));
      setEditRows(rows);
      setEditCatatan(data.catatan_closing || '');
      setEditSesi((prev) => ({ ...prev, status: data.status }));
    } catch (err) {
      setEditErr(err.message);
    } finally {
      setEditLoading(false);
    }
  };

  const doReopen = async () => {
    if (!window.confirm('Buka ulang sesi kasir hari ini? Hasil closing lama akan dihapus dan sesi kembali berstatus buka.')) return;
    setReopenBusy(true);
    try {
      await api.post('/kasir/reopen', {});
      toast.success('Sesi kasir dibuka ulang.');
      sesi.run();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setReopenBusy(false);
    }
  };

  // Buka ulang sesi kasir tanggal lampau (admin). Backend menerima { tanggal }.
  const doReopenLampau = async () => {
    const tgl = reopenTgl;
    if (!tgl) {
      toast.error('Pilih tanggal sesi yang mau dibuka ulang.');
      return;
    }
    setReopenLampauBusy(true);
    try {
      const info = await api.get('/kasir/current', { tanggal: tgl });
      if (!info?.kasir_sesi_id) throw new Error(`Belum ada sesi kasir pada ${tgl} — sesi dibuat lewat menu Opening, bukan Buka Ulang.`);
      if (info.status === 'buka') throw new Error(`Sesi ${tgl} masih berstatus buka — tidak perlu dibuka ulang.`);
      if (!window.confirm(`Buka ulang sesi kasir ${tgl}? Hasil closing lama akan dihapus, sehingga sesi bisa dipakai untuk edit transaksi pada tanggal tersebut.`)) return;
      await api.post('/kasir/reopen', { tanggal: tgl });
      toast.success(`Sesi kasir ${tgl} dibuka ulang.`);
      setReopenTgl('');
      sesi.run();
      reminder.run();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setReopenLampauBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editSesi?.kasir_sesi_id) return;
    setEditErr(null);
    if (!editRows || editRows.length === 0) {
      setEditErr('Tidak ada akun untuk direkonsiliasi.');
      return;
    }
    setEditBusy(true);
    try {
      await api.post('/kasir/closing', {
        kasir_sesi_id: editSesi.kasir_sesi_id,
        saldo_real: editRows.map((r) => ({ nama_akun: r.nama_akun, saldo_real: parseRupiah(r.saldo_real) })),
        catatan_closing: editCatatan || undefined,
      });
      toast.success('Sesi lampau ditutup. Rekonsiliasi tersimpan.');
      setEditSesi(null);
      reminder.run();
      sesi.run();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Kasir"
        subtitle={`Sesi harian — ${date} (WIB). Satu sesi per hari untuk semua karyawan.`}
      />

      <div className="mb-4 flex items-center gap-2">
        <KasirStatusBadge status={status} />
        {status === 'buka' && sesi.data?.dibuka_at && (
          <span className="text-sm text-secondary">Dibuka {formatDateTime(sesi.data.dibuka_at)}</span>
        )}
        {status === 'tutup' && sesi.data?.catatan_closing && (
          <span className="text-sm text-secondary">Catatan closing: {sesi.data.catatan_closing}</span>
        )}
      </div>

      {perluDiingatkan && (
        <Card className="mb-4" style={{ background: 'var(--warning-soft)', borderColor: 'var(--warning)' }}>
          <div className="flex items-start gap-3">
            <span className="state-icon" style={{ color: 'var(--warning)' }}><Icon name="alert" size={20} /></span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Perlu Closing — Ada Sesi Lampau</div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)', margin: '0 0 8px' }}>
                Terdapat {sesiLampau.length} sesi kasir yang masih berstatus <b>buka</b> dari hari sebelum <b>{date}</b>. Klik <b>Edit</b> pada sesi untuk mengoreksi saldo real (klosing) &amp; catatan, lalu simpan untuk menutup sesi tersebut.
              </p>
              {sesiLampau.length > 0 && (
                <div className="flex flex-col gap-2">
                  {sesiLampau.map((s) => (
                    <div key={s.kasir_sesi_id} className="akun-row" style={{ gridTemplateColumns: '1fr auto' }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{s.tanggal}</div>
                        <div className="text-xs text-secondary">{formatDateTime(s.dibuka_at)}</div>
                        <div className="text-xs text-secondary">Oleh: {s.dibuka_oleh || '—'}</div>
                      </div>
                      <div className="flex items-center">
                        <Button variant="secondary" size="sm" onClick={() => openEdit(s)}>
                          <Icon name="edit" size={14} /> Edit
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {isAdmin && (
        <Card className="mb-4" title="Buka Ulang Sesi Tanggal Lain (Admin)">
          <p className="field-hint mb-2">
            Untuk mengoreksi transaksi tanggal lain yang sesinya sudah ditutup (bukan sesi hari ini).
            Hasil closing lama dihapus, jadi tutup kembali sesinya setelah selesai edit.
          </p>
          <div className="flex items-end gap-2">
            <Field label="Tanggal Sesi" style={{ flex: 1 }}>
              <Input type="date" value={reopenTgl} max={kemarin} onChange={(e) => setReopenTgl(e.target.value)} />
            </Field>
            <Button variant="secondary" size="sm" className="btn-compact" onClick={doReopenLampau} loading={reopenLampauBusy} disabled={!reopenTgl}>
              <Icon name="refresh" size={14} /> Buka Ulang
            </Button>
          </div>
        </Card>
      )}

      {status === 'belum_buka' && (
        <Card title="Opening — Saldo Awal">
          <form onSubmit={doOpening}>
            <p className="field-hint mb-2">Saldo awal otomatis diisi dari sesi terakhir. Sesuaikan bila ada perubahan.</p>
            {akunTersembunyi.length > 0 && (
              <p className="field-error mb-2" role="alert">
                Ada akun yang tidak ikut tampil di form ini karena tipenya &quot;Lainnya&quot;:{' '}
                <strong>{akunTersembunyi.map((a) => a.nama_akun).join(', ')}</strong>. Kalau uangnya memang
                ada (mis. uang darurat), ubah tipenya jadi Tunai/Bank di Pengaturan → Akun Master supaya bisa
                dicatat di kasir.
              </p>
            )}
            <div className="flex flex-col gap-3">
              {opening && opening.length > 0 ? (
                opening.map((o, idx) => (
                  <div key={o.nama_akun} className="akun-row">
                    <div className="flex items-center">
                      <span style={{ fontWeight: 600 }}>{o.nama_akun}</span>
                    </div>
                    <Field label="Saldo awal (Rp)">
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={o.saldo}
                        onChange={(e) =>
                          setOpening((prev) => prev.map((x, i) => (i === idx ? { ...x, saldo: formatRupiahInput(e.target.value) } : x)))
                        }
                      />
                    </Field>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted">Belum ada akun. Admin dapat menambah akun di Pengaturan.</p>
              )}
              {errForm && <p className="field-error" role="alert">{errForm}</p>}

              <div className="page-actions">
                <Button type="submit" loading={openingBusy} disabled={!opening?.length}>
                  <Icon name="wallet" size={16} /> Buka Kasir
                </Button>
              </div>
            </div>
          </form>
        </Card>
      )}

      {status === 'buka' && (
        <>
          <Card title="Saldo Sistem (berjalan)">
            <div className="mb-3 flex items-center justify-between gap-2 wrap" style={{ flexWrap: 'wrap' }}>
              <span className="text-sm text-muted">
                Saldo awal masih bisa dikoreksi selama sesi ini belum punya transaksi.
              </span>
              <div className="row-actions">
                <Button variant="secondary" size="sm" onClick={() => sesi.run()}>
                  <Icon name="refresh" size={14} /> Muat ulang
                </Button>
                <Button variant="secondary" size="sm" onClick={mulaiKoreksi}>
                  <Icon name="edit" size={14} /> Koreksi Saldo Awal
                </Button>
              </div>
            </div>
            <BalanceTable rows={sesi.data?.saldo || []} />
          </Card>

          <div className="mt-4">
            <Card title="Closing — Rekonsiliasi">
              <form onSubmit={doClosing}>
                <div className="flex flex-col gap-3">
                  {(closing || []).map((c, idx) => (
                    <div key={c.nama_akun} className="akun-row">
                      <div>
                        <div style={{ fontWeight: 600 }}>{c.nama_akun}</div>
                        <span className="num text-sm text-primary font-bold">Sistem: {formatRupiah(c.saldo_sistem)}</span>
                      </div>
                      <Field label="Saldo real (Rp)">
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={c.saldo_real}
                          onChange={(e) =>
                            setClosing((prev) => prev.map((x, i) => (i === idx ? { ...x, saldo_real: formatRupiahInput(e.target.value) } : x)))
                          }
                        />
                      </Field>
                    </div>
                  ))}
                  <Field label="Catatan closing (opsional)">
                    <Textarea
                      value={closingCatatan}
                      onChange={(e) => setClosingCatatan(e.target.value)}
                      placeholder="Isi jika ada selisih / note rekonsiliasi…"
                    />
                  </Field>
                  {errForm && <p className="field-error" role="alert">{errForm}</p>}

                  {/* Siapkan kasir besok: sisihkan kelebihan uang laci ke Uang
                      Cadangan supaya laci besok hanya berisi float. */}
                  <div className="card" style={{ padding: 'var(--space-3)', background: 'var(--bg-surface-alt)' }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Siapkan Kasir Besok</div>
                    <p className="text-sm text-secondary" style={{ marginBottom: 'var(--space-3)' }}>
                      Uang laci sekarang <span className="num">{formatRupiah(saldoLaciSekarang())}</span>.
                      Sisakan <span className="num">{formatRupiah(floatLaci)}</span> untuk laci besok, sisanya
                      dipindahkan ke <strong>{AKUN_CADANGAN}</strong>. Total uang tidak berubah.
                    </p>
                    <div className="flex items-end gap-2" style={{ flexWrap: 'wrap' }}>
                      <Field label="Float laci besok (Rp)">
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={formatRupiahInput(String(floatLaci))}
                          onChange={(e) => {
                            const v = parseRupiah(e.target.value) || 0;
                            setFloatLaci(v);
                            localStorage.setItem('irkop_cell_float_laci', String(v));
                          }}
                          style={{ width: 150 }}
                        />
                      </Field>
                      <Button type="button" variant="secondary" onClick={bukaSiapkan} disabled={siapkanBusy}>
                        <Icon name="transfer" size={15} /> Hitung &amp; Pindahkan
                      </Button>
                    </div>
                  </div>

                  <div className="page-actions">
                    <Button type="submit" variant="primary" loading={closingBusy}>
                      <Icon name="check" size={16} /> Tutup Kasir
                    </Button>
                  </div>
                </div>
              </form>
            </Card>
          </div>
        </>
      )}

      {status === 'tutup' && (
        <>
          <div className="mb-3 text-right">
            <Button variant="secondary" size="sm" className="btn-compact" onClick={doReopen} loading={reopenBusy}>
              <Icon name="refresh" size={14} /> Buka ulang sesi
            </Button>
          </div>
          <Card title="Hasil Rekonsiliasi">
            {sesi.data?.closing?.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Akun</th>
                      <th className="col-right">Saldo Sistem</th>
                      <th className="col-right">Saldo Real</th>
                      <th className="col-right">Selisih</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sesi.data.closing.map((c) => {
                      const selisih = Number(c.selisih) || 0;
                      return (
                        <tr key={c.nama_akun}>
                          <td>{c.nama_akun}</td>
                          <td className="col-right num">{formatRupiah(c.saldo_sistem)}</td>
                          <td className="col-right num">{formatRupiah(c.saldo_real)}</td>
                          <td
                            className={`col-right num ${selisih === 0 ? 'text-success' : 'text-warning'}`}
                          >
                            {formatSignedRupiah(selisih)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="Belum ada data closing" description="Data rekonsiliasi akan tampil setelah sesi ditutup." icon="kasir" />
            )}
          </Card>

          <div className="mt-4">
            <Card title="Saldo Sistem (sesi dimulai)">
              <BalanceTable rows={sesi.data?.saldo || []} />
            </Card>
          </div>
        </>
      )}

      <Modal
        open={Boolean(siapkanTarget)}
        onClose={() => (siapkanBusy ? null : setSiapkanTarget(null))}
        title="Siapkan Kasir Besok"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSiapkanTarget(null)} disabled={siapkanBusy}>
              Batal
            </Button>
            <Button onClick={eksekusiSiapkan} loading={siapkanBusy}>
              <Icon name="transfer" size={16} /> Ya, Pindahkan
            </Button>
          </>
        }
      >
        <div className="table-wrap table-fit">
          <table className="table">
            <tbody>
              <tr>
                <td>Uang laci sekarang</td>
                <td className="col-right num">{formatRupiah(siapkanTarget?.kini ?? 0)}</td>
              </tr>
              <tr>
                <td>Float untuk laci besok</td>
                <td className="col-right num">-{formatRupiah(siapkanTarget?.float ?? 0)}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Dipindah ke {AKUN_CADANGAN}</td>
                <td className="col-right num" style={{ fontWeight: 700 }}>
                  {formatRupiah(siapkanTarget?.sisa ?? 0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="field-hint mt-3">
          Dicatat sebagai transfer antar akun: <strong>{AKUN_LACI}</strong> berkurang,{' '}
          <strong>{AKUN_CADANGAN}</strong> bertambah. Total uang dan rekonsiliasi tidak berubah —
          uang hanya dipindah dari laci ke tempat aman. Setelah itu tinggal tekan <strong>Tutup Kasir</strong>.
        </p>
      </Modal>

      <Modal
        open={Boolean(konfirmasiOpening)}
        onClose={() => (openingBusy ? null : setKonfirmasiOpening(null))}
        title="Periksa Saldo Awal"
        footer={
          <>
            <Button variant="ghost" onClick={() => setKonfirmasiOpening(null)} disabled={openingBusy}>
              Kembali
            </Button>
            <Button onClick={konfirmasiOpeningJalog} loading={openingBusy}>
              <Icon name="check" size={16} /> Ya, Buka Kasir
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Kasir <strong>belum</strong> dibuka. Cek dulu saldo di bawah — setelah dibuka, angka ini
          jadi acuan seluruh pembukuan hari ini.
        </p>
        <div className="table-wrap table-fit mt-3">
          <table className="table">
            <thead>
              <tr>
                <th>Akun</th>
                <th className="col-right">Saldo awal</th>
              </tr>
            </thead>
            <tbody>
              {(konfirmasiOpening || []).map((o) => {
                const n = parseRupiah(o.saldo);
                return (
                  <tr key={o.nama_akun}>
                    <td>{o.nama_akun}</td>
                    <td className="col-right num font-bold" style={{ color: n === 0 ? 'var(--warning)' : undefined }}>
                      {formatRupiah(n)}
                      {n === 0 && <span className="text-xs text-warning"> (nol)</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(konfirmasiOpening || []).every((o) => parseRupiah(o.saldo) === 0) && (
          <p className="field-error mt-3" role="alert">
            Semua saldo awal 0. Kalau memang belum ada uang tercatat, tidak apa-apa — tapi kalau
            ada uang di laci atau e-wallet, isi dulu agar pembukuan tidak meleset.
          </p>
        )}
      </Modal>

      <Modal
        open={Boolean(koreksiRows)}
        onClose={() => (koreksiBusy ? null : setKoreksiRows(null))}
        title="Koreksi Saldo Awal"
        footer={
          <>
            <Button variant="ghost" onClick={() => setKoreksiRows(null)} disabled={koreksiBusy}>
              Batal
            </Button>
            <Button onClick={simpanKoreksi} loading={koreksiBusy}>
              <Icon name="check" size={16} /> Simpan Koreksi
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Isi ulang saldo awal sesi hari ini. Bisa dipakai selama sesi <strong>belum punya transaksi</strong>.
          Semua perubahan tercatat di audit log.
        </p>
        <div className="flex flex-col gap-2 mt-3">
          {(koreksiRows || []).map((r, i) => (
            <div key={r.nama_akun} className="akun-row">
              <div style={{ fontWeight: 600 }}>{r.nama_akun}</div>
              <input
                type="text"
                inputMode="numeric"
                className="input"
                style={{ maxWidth: 180, textAlign: 'right' }}
                value={r.saldo}
                onChange={(e) =>
                  setKoreksiRows((rows) => rows.map((x, j) => (j === i ? { ...x, saldo: formatRupiahInput(e.target.value) } : x)))
                }
              />
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        open={Boolean(editSesi)}
        onClose={() => setEditSesi(null)}
        title={editSesi ? `Edit Sesi — ${editSesi.tanggal}` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditSesi(null)} disabled={editBusy}>
              Batal
            </Button>
            <Button
              variant="primary"
              onClick={saveEdit}
              loading={editBusy}
              disabled={!editRows?.length || editSesi?.status === 'tutup'}
            >
              <Icon name="check" size={16} /> Simpan &amp; Closing
            </Button>
          </>
        }
      >
        {editLoading ? (
          <Loader />
        ) : editErr ? (
          <p className="field-error" role="alert">{editErr}</p>
        ) : editSesi?.status === 'tutup' ? (
          <p className="text-sm text-secondary">Sesi ini sudah ditutup. Perbarui halaman untuk melihat hasilnya.</p>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              {(editRows || []).map((c, idx) => (
                <div key={c.nama_akun} className="akun-row">
                  <div>
                    <div style={{ fontWeight: 600 }}>{c.nama_akun}</div>
                    <span className="num text-sm text-primary font-bold">Sistem: {formatRupiah(c.saldo_sistem)}</span>
                  </div>
                  <Field label="Saldo real (Rp)">
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={c.saldo_real}
                      onChange={(e) =>
                        setEditRows((prev) => prev.map((x, i) => (i === idx ? { ...x, saldo_real: formatRupiahInput(e.target.value) } : x)))
                      }
                    />
                  </Field>
                </div>
              ))}
              <Field label="Catatan closing (opsional)">
                <Textarea
                  value={editCatatan}
                  onChange={(e) => setEditCatatan(e.target.value)}
                  placeholder="Isi jika ada selisih / note rekonsiliasi…"
                />
              </Field>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function BalanceTable({ rows }) {
  if (!rows || rows.length === 0) {
    return <EmptyState title="Tidak ada akun pada sesi ini" description="Opening terlebih dahulu." icon="kasir" />;
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Akun</th>
            <th className="col-right">Saldo Opening</th>
            <th className="col-right">Mutasi</th>
            <th className="col-right">Saldo Sistem</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.nama_akun}>
              <td>{r.nama_akun}</td>
              <td className="col-right num text-primary font-bold">{formatRupiah(r.saldo_opening)}</td>
              <td className="col-right num text-success">+{formatSignedRupiah(r.mutasi || 0)}</td>
              <td className="col-right num" style={{ fontWeight: 800 }}>{formatRupiah(r.saldo_sistem)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}