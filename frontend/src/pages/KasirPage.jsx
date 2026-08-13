// Halaman Kasir (PRD 5.3): Opening → Closing (rekonsiliasi), 1 sesi per hari.
// Semua angka saldo = nilai resmi backend (GET /api/kasir/current). Frontend
// TIDAK menebak atau menghitung ulang saldo. Closing TIDAK membuat mutasi baru.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useAsync } from '../hooks/useAsync';
import { todayWIB, formatRupiah, formatDateTime, formatSignedRupiah, formatRupiahInput, parseRupiah } from '../lib/format';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Field, Input, Textarea } from '../components/ui/Field';
import { Loader, ErrorState, EmptyState } from '../components/ui/States';
import { KasirStatusBadge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';

export default function KasirPage() {
  const toast = useToast();
  const [date] = useState(todayWIB());

  const sesi = useAsync(() => api.get('/kasir/current'), { deps: [] });
  const akun = useAsync(() => api.get('/akun'), { deps: [] });
  const reminder = useAsync(() => api.get('/kasir/reminder-closing'), { deps: [] });

  const [opening, setOpening] = useState(null);
  const [openingBusy, setOpeningBusy] = useState(false);
  const [closing, setClosing] = useState(null);
  const [closingCatatan, setClosingCatatan] = useState('');
  const [closingBusy, setClosingBusy] = useState(false);
  const [errForm, setErrForm] = useState(null);

  useEffect(() => {
    if (sesi.status === 'error') return;
    if (sesi.status !== 'success') return;
    if (sesi.data?.status === 'belum_buka' && akun.status === 'success') {
      const akunList = akun.data?.items || [];
      setOpening(
        akunList.length
          ? akunList.map((a) => ({ nama_akun: a.nama_akun, saldo: 0 }))
          : []
      );
    }
    if (sesi.data?.status === 'buka') {
      const s = sesi.data.saldo || [];
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

  const doOpening = async (e) => {
    e.preventDefault();
    setErrForm(null);
    const entries = (opening || []).filter((o) => o.saldo !== '' && o.saldo !== null);
    if (entries.length === 0) {
      setErrForm('Isi saldo awal minimal satu akun.');
      return;
    }
    setOpeningBusy(true);
    try {
      const res = await api.post('/kasir/opening', {
        saldo_awal: entries.map((o) => ({ nama_akun: o.nama_akun, saldo: parseRupiah(o.saldo) })),
      });
      toast.success('Kasir dibuka.');
      if (res.notif_admin) toast.info('Notifikasi Opening telah dikirim ke Admin.');
      sesi.run();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setOpeningBusy(false);
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
                Terdapat {sesiLampau.length} sesi kasir yang masih berstatus <b>buka</b> dari hari sebelum <b>{date}</b>. Mohon segera lakukan closing untuk setiap sesi yang belum ditutup.
              </p>
              {sesiLampau.length > 0 && (
                <div className="table-wrap" style={{ maxHeight: 140, overflowY: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Tanggal</th>
                        <th>Dibuka</th>
                        <th>Oleh</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sesiLampau.map((s) => (
                        <tr key={s.kasir_sesi_id}>
                          <td className="num">{s.tanggal}</td>
                          <td className="text-xs">{formatDateTime(s.dibuka_at)}</td>
                          <td>{s.dibuka_oleh || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {status === 'belum_buka' && (
        <Card
          title="Opening — Saldo Awal"
          subtitle="Saldo awal setiap akun saat memulai sesi. Closing & saldo sistem dihitung backend dari saldo awal + mutasi."
        >
          <form onSubmit={doOpening}>
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
              <div>
                <Button type="submit" loading={openingBusy} disabled={!opening?.length}>
                  <Icon name="wallet" size={16} /> Buka Kasir
                </Button>
                <p className="field-hint mt-3">
                  Jika dibuka oleh Karyawan, sistem otomatis mencatat gaji harian (berdasarkan rate hari ini) dan mengirim notifikasi ke Admin.
                </p>
              </div>
            </div>
          </form>
        </Card>
      )}

      {status === 'buka' && (
        <>
          <Card title="Saldo Sistem (berjalan)" subtitle="Nilai resmi backend: saldo_opening + mutasi. Closing tidak mengurangi/menambah saldo lagi (PRD 12.2).">
            <BalanceTable rows={sesi.data?.saldo || []} />
          </Card>

          <div className="mt-4">
            <Card
              title="Closing — Rekonsiliasi"
              subtitle={`Cocokkan saldo real tiap aplikasi dengan saldo sistem. Selisih = saldo_real − saldo_sistem (dihitung backend).`}
            >
              <form onSubmit={doClosing}>
                <div className="flex flex-col gap-3">
                  {(closing || []).map((c, idx) => (
                    <div key={c.nama_akun} className="akun-row">
                      <div>
                        <div style={{ fontWeight: 600 }}>{c.nama_akun}</div>
                        <span className="num text-sm text-secondary">Sistem: {formatRupiah(c.saldo_sistem)}</span>
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
                  <div>
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
            <Card title="Saldo Sistem (sesi dimulai)" subtitle="Saldo awal + mutasi sepanjang sesi (nilai backend).">
              <BalanceTable rows={sesi.data?.saldo || []} />
            </Card>
          </div>
        </>
      )}
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
              <td className="col-right num">{formatRupiah(r.saldo_opening)}</td>
              <td className="col-right num text-success">+{formatSignedRupiah(r.mutasi || 0)}</td>
              <td className="col-right num" style={{ fontWeight: 800 }}>{formatRupiah(r.saldo_sistem)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}