// Form buat/edit transaksi (multi-item) — POST/PUT /api/transaksi
// Integrasi strict ke API Contract Team 1: field & aturan tidak ditebak.
import { useState } from 'react';
import { api, newIdempotencyKey } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { METODE_PEMBAYARAN, formatRupiah, todayWIB, formatRupiahInput, parseRupiah } from '../../lib/format';
import { Button } from '../ui/Button';
import { Field, Input, Select } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';

// Kategori kirim-uang: produk dari kategori ini otomatis menampilkan input
// Nominal transfer + Akun sumber (checkbox "Kirim Uang" langsung tercentang).
const KIRIM_UANG_KATEGORI = /transfer|tarik|saldo|kirim/i;

export default function TransaksiForm({ initial, onSaved, onCancel, tanggalTransaksi: propTanggal, manualEntry = false, showKategoriFilter = true }) {
  const today = todayWIB();
  const maxBackdate = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  })();
  const [tanggalTransaksi, setTanggalTransaksi] = useState(() => propTanggal || today);
  const [keranjang, setKeranjang] = useState(() =>
    (initial?.items || []).map((i) => ({
      produk_id: i.produk_id ?? '',
      service_hp_id: i.service_hp_id ?? '',
      kode: i.service_hp_id ? 'SRV' : (i.kode ?? ''),
      nama: i.nama_produk_snapshot || i.nama_produk || '',
      harga: i.harga_snapshot ?? i.harga ?? 0,
      qty: i.qty ?? 1,
      isKirimUang: Boolean(i.nominal_referensi),
      nominal_referensi: i.nominal_referensi ?? '',
      akun_sumber: i.akun_sumber ?? '',
      kategoriNama: i.service_hp_id ? 'Service' : '',
    }))
  );
  const [metodeBayar, setMetodeBayar] = useState(initial?.metode_bayar || 'tunai');
  const [akunPenerima, setAkunPenerima] = useState(initial?.akun_penerima || '');
  const [pelangganId, setPelangganId] = useState(initial?.pelanggan_id || '');
  const [search, setSearch] = useState('');
  const [kategoriFilter, setKategoriFilter] = useState('');
  const [serviceModal, setServiceModal] = useState(false);
  const [serviceSearch, setServiceSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const produk = useAsync(() => api.get('/produk', { limit: 200 }), { deps: [] });
  const kategori = useAsync(() => api.get('/kategori'), { deps: [] });
  const akun = useAsync(() => api.get('/akun'), { deps: [] });
  const pelanggan = useAsync(() => api.get('/pelanggan', { limit: 200 }), { deps: [] });
  const services = useAsync(() => api.get('/service-hp', { limit: 500 }), { deps: [] });

  const allProduk = (produk.data?.items || []).filter((p) => !p.deleted_at);
  const kategoriList = (kategori.data?.items || []).filter((k) => !k.deleted_at);

  const onPickProduk = (p) => {
    const kat = kategoriList.find((k) => String(k.id) === String(p.kategori_id));
    const autoKirim = kat ? KIRIM_UANG_KATEGORI.test(kat.nama) : false;
    setKeranjang((prev) => {
      const existing = prev.find((it) => String(it.produk_id) === String(p.id));
      if (existing) {
        return prev.map((it) => (it === existing ? { ...it, qty: it.qty + 1 } : it));
      }
      return [
        ...prev,
        {
          produk_id: p.id,
          kode: p.kode,
          nama: p.nama,
          harga: p.harga,
          qty: 1,
          isKirimUang: autoKirim,
          nominal_referensi: '',
          akun_sumber: '',
          kategoriNama: kat?.nama || '',
        },
      ];
    });
    setSearch('');
  };

  // Item Service HP: mereferensikan record service_hp (bukan produk jasa terpisah).
  // Harga default = biaya service (atau estimasi), bisa diubah langsung di keranjang.
  const onPickService = (s) => {
    setKeranjang((prev) => {
      const existing = prev.find((it) => it.service_hp_id && String(it.service_hp_id) === String(s.id));
      if (existing) {
        return prev.map((it) => (it === existing ? { ...it, qty: it.qty + 1 } : it));
      }
      return [
        ...prev,
        {
          service_hp_id: s.id,
          produk_id: '',
          kode: 'SRV',
          nama: `Service: ${s.nama_device}`,
          harga: s.biaya || s.estimasi_biaya || '',
          qty: 1,
          isService: true,
          isKirimUang: false,
          nominal_referensi: '',
          akun_sumber: '',
          kategoriNama: 'Service',
        },
      ];
    });
    setServiceModal(false);
    setServiceSearch('');
  };

  const updateItem = (idx, patch) => {
    setKeranjang((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const removeItem = (idx) => setKeranjang((prev) => prev.filter((_, i) => i !== idx));

  // Total ditampilkan = omzet: nominal + fee untuk kirim uang, fee saja untuk tarik tunai.
  // Nominal berlaku per unit (qty 2 × nominal 150k = 300k).
  const totalOmzet = keranjang.reduce((sum, it) => {
    const fee = Number(it.harga) * Number(it.qty);
    const isTarik = /tarik/i.test(it.kategoriNama || '');
    const nominal = it.isKirimUang && !isTarik ? ((parseRupiah(it.nominal_referensi) || 0) * Number(it.qty)) : 0;
    return sum + fee + nominal;
  }, 0);

  const isEdit = Boolean(initial?.id);

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    if (keranjang.length === 0) {
      setSubmitError('Keranjang masih kosong. Pilih minimal satu produk.');
      return;
    }
    if (keranjang.some((it) => it.service_hp_id && !parseRupiah(it.harga))) {
      setSubmitError('Biaya service masih kosong. Isi biaya service sebelum menyimpan.');
      return;
    }
    if (metodeBayar === 'transfer' && !akunPenerima) {
      setSubmitError('Untuk metode Transfer, pilih akun penerima.');
      return;
    }

    const items = keranjang.map((it) =>
      it.service_hp_id
        ? {
            service_hp_id: Number(it.service_hp_id),
            qty: Number(it.qty),
            biaya: parseRupiah(it.harga) || undefined,
          }
        : {
            produk_id: Number(it.produk_id),
            qty: Number(it.qty),
            ...(it.isKirimUang
              ? {
                  nominal_referensi: parseRupiah(it.nominal_referensi),
                  akun_sumber: it.akun_sumber || undefined,
                }
              : {}),
          }
    );

    const body = {
      items,
      metode_bayar: metodeBayar,
      pelanggan_id: pelangganId ? Number(pelangganId) : null,
      ...(metodeBayar === 'transfer' ? { akun_penerima: akunPenerima } : {}),
      ...(isEdit ? {} : { manual_entry: Boolean(manualEntry), tanggal_transaksi: tanggalTransaksi || null }),
    };

    setBusy(true);
    try {
      if (isEdit) {
        await api.put(`/transaksi/${initial.id}`, body);
      } else {
        await api.post('/transaksi', body, newIdempotencyKey());
      }
      onSaved();
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const predikat = (it, q) => {
    const s = q.toLowerCase();
    return (
      it.kode?.toLowerCase().includes(s) ||
      it.nama?.toLowerCase().includes(s) ||
      it.id?.toString().includes(s)
    );
  };
  const matchKategori = (p) => {
    if (kategoriFilter === '') return true;
    if (kategoriFilter === 'none') return p.kategori_id == null;
    return String(p.kategori_id) === kategoriFilter;
  };
  // Saat mengetik: cari produk (dibatasi kategori). Saat tidak mengetik tetapi
  // kategori dipilih: langsung tampilkan produk dalam kategori itu, sehingga
  // filter kategori terasa "diterapkan".
  const hasilProduk = search
    ? allProduk.filter((p) => matchKategori(p) && predikat(p, search)).slice(0, 12)
    : kategoriFilter !== ''
      ? allProduk.filter(matchKategori).slice(0, 50)
      : null;

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="flex flex-col gap-4">
        {/* Filter kategori & pencarian */}
        {showKategoriFilter && (
          <Field label="Filter Kategori" hint="Saring produk berdasarkan kategori. Produk tanpa kategori tetap bisa dicari.">
            <Select value={kategoriFilter} onChange={(e) => setKategoriFilter(e.target.value)}>
              <option value="">Semua kategori</option>
              <option value="none">Tanpa kategori</option>
              {kategoriList.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.nama}
                  {!k.lacak_stok ? ' (non-stok)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Cari produk (kode / nama)">
          <Input
            type="search"
            value={search}
            placeholder="Ketikan kode atau nama produk…"
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted">Atau catat pembayaran jasa service HP langsung dari form Service.</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => setServiceModal(true)}>
            Tambah Service
          </Button>
        </div>

        {hasilProduk && hasilProduk.length > 0 && (
          <div className="card" style={{ padding: 'var(--space-2)', maxHeight: 190, overflowY: 'auto', boxShadow: 'none' }}>
            {hasilProduk.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex justify-between items-center w-full"
                style={{ background: 'none', border: 'none', padding: '8px 10px', borderRadius: 'var(--radius-sm)', textAlign: 'left' }}
                onClick={() => onPickProduk(p)}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span>
                  <span className="font-mono text-sm text-muted">{p.kode}</span> — {p.nama}
                </span>
                <span className="num text-sm">{formatRupiah(p.harga)}</span>
              </button>
            ))}
          </div>
        )}
        {!search && kategoriFilter !== '' && hasilProduk && hasilProduk.length === 0 && (
          <p className="text-sm text-muted">Tidak ada produk pada kategori ini.</p>
        )}

        {keranjang.length === 0 ? (
          <p className="text-sm text-muted">Belum ada produk di keranjang.</p>
        ) : (
          <fieldset
            className="table-wrap"
            style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2)' }}
          >
            <legend className="field-label" style={{ marginLeft: 'var(--space-2)' }}>Keranjang</legend>
            {keranjang.map((it, idx) => {
              const isTarik = /tarik/i.test(it.kategoriNama || '');
              return (
              <div key={idx} className="cart-item">
                <span className="cart-item-kode">{it.kode}</span>
                <div className="cart-item-nameline">
                  <span className="cart-item-nama">{it.nama}</span>
                  <div className="cart-item-side">
                    <div className="cart-item-stepper">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        aria-label={`Kurangi ${it.nama}`}
                        onClick={() => updateItem(idx, { qty: Math.max(1, Number(it.qty) - 1) })}
                      >
                        −
                      </button>
                      <span className="num cart-item-qty">{it.qty}</span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        aria-label={`Tambah ${it.nama}`}
                        onClick={() => updateItem(idx, { qty: Number(it.qty) + 1 })}
                      >
                        +
                      </button>
                    </div>
                    <span className="num cart-item-price">{formatRupiah(it.harga * it.qty)}</span>
                    <button type="button" className="btn btn-ghost btn-sm cart-item-trash" aria-label={`Hapus ${it.nama}`} onClick={() => removeItem(idx)}>
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </div>

                {/* Opsional: produk jasa kirim uang / tarik tunai (nominal referensi tidak masuk omzet, PRD 5.2.1) */}
                {!it.service_hp_id && (
                  <>
                    <label className="cart-item-opt">
                      <input
                        type="checkbox"
                        checked={it.isKirimUang}
                        onChange={(e) => updateItem(idx, { isKirimUang: e.target.checked })}
                      />
                      {isTarik
                        ? 'Produk jasa Tarik Tunai (isi nominal saldo yang diterima)'
                        : 'Produk jasa Kirim Uang (isi nominal yang ditransfer)'}
                    </label>
                    {it.isKirimUang && (
                  <div className="card" style={{ padding: 'var(--space-2)', gap: 'var(--space-1)', boxShadow: 'none', background: 'var(--bg-surface-alt)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-2" style={{ padding: '4px 6px' }}>
                      <span className="text-sm" style={{ flexShrink: 0 }}>{isTarik ? 'Nominal diterima' : 'Nominal transfer'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={it.nominal_referensi ? formatRupiahInput(String(it.nominal_referensi)) : ''}
                          onChange={(e) => updateItem(idx, { nominal_referensi: formatRupiahInput(e.target.value) })}
                          placeholder="mis. 500.000"
                          style={{ padding: '6px 8px', fontSize: '.82rem' }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2" style={{ padding: '4px 6px' }}>
                      <span className="text-sm" style={{ flexShrink: 0 }}>{isTarik ? 'Akun penerima saldo' : 'Akun sumber'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Select value={it.akun_sumber} onChange={(e) => updateItem(idx, { akun_sumber: e.target.value })} style={{ padding: '6px 8px', fontSize: '.82rem' }}>
                          <option value="">Pilih akun…</option>
                          {(akun.data?.items || []).map((a) => (
                            <option key={a.id} value={a.nama_akun}>
                              {a.nama_akun}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                  </div>
                )}
                  </>
                )}
                {it.service_hp_id && (
                  <div className="card" style={{ padding: 'var(--space-2)', gap: 'var(--space-1)', boxShadow: 'none', background: 'var(--bg-surface-alt)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-2" style={{ padding: '4px 6px' }}>
                      <span className="text-sm" style={{ flexShrink: 0 }}>Biaya service</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={it.harga ? formatRupiahInput(String(it.harga)) : ''}
                          onChange={(e) => updateItem(idx, { harga: formatRupiahInput(e.target.value) })}
                          placeholder="mis. 150.000"
                          style={{ padding: '6px 8px', fontSize: '.82rem' }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              );
            })}
          </fieldset>
        )}

        {/* Metode & atribut transaksi */}
        <div className="grid-2">
          <Field label="Metode bayar" required>
            <Select value={metodeBayar} onChange={(e) => setMetodeBayar(e.target.value)}>
              {METODE_PEMBAYARAN.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          {metodeBayar === 'transfer' && (
            <Field label="Akun penerima" required hint="Transaksi transfer menunggu konfirmasi pembayaran via NotifHook/manual.">
              <Select value={akunPenerima} onChange={(e) => setAkunPenerima(e.target.value)}>
                <option value="">Pilih akun…</option>
                {(akun.data?.items || []).map((a) => (
                  <option key={a.id} value={a.nama_akun}>
                    {a.nama_akun}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Pelanggan (opsional)">
            <Select value={pelangganId} onChange={(e) => setPelangganId(e.target.value)}>
              <option value="">Umum / Tanpa Nama</option>
              {(pelanggan.data?.items || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nama}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid-2">
          <Field label="Tanggal transaksi (WIB)">
            <Input type="date" min={maxBackdate} max={today} value={tanggalTransaksi} onChange={(e) => setTanggalTransaksi(e.target.value)} />
          </Field>
          {manualEntry && (
            <Field label="Catatan" hint="Manual transaksi untuk kasus lupa dicatat (PRD 5.4).">
              <p className="text-sm" style={{ color: 'var(--text-muted)', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                Transaksi ini akan ditandai sebagai <b>manual</b> dan tercatat pada <b>{tanggalTransaksi}</b> (bukan hari ini).
              </p>
            </Field>
          )}
        </div>

        <div className="flex justify-between items-center" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' }}>
          <div>
            <span className="text-sm text-secondary">Total</span>
            <div className="num" style={{ fontSize: '1.3rem', fontWeight: 800 }}>{formatRupiah(totalOmzet)}</div>
          </div>
          {submitError && <p className="field-error" role="alert">{submitError}</p>}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onCancel}>Batal</Button>
          <Button type="submit" loading={busy}>{isEdit ? 'Simpan Perubahan' : 'Simpan Transaksi'}</Button>
        </div>
      </div>

      <Modal open={serviceModal} onClose={() => setServiceModal(false)} title="Pilih Service HP" ariaLabel="Pilih Service HP">
        <div className="flex flex-col gap-2">
          <Input
            type="search"
            value={serviceSearch}
            placeholder="Cari nama device atau pelanggan…"
            onChange={(e) => setServiceSearch(e.target.value)}
            autoComplete="off"
          />
          <div className="card" style={{ padding: 'var(--space-2)', maxHeight: 300, overflowY: 'auto', boxShadow: 'none' }}>
            {(services.data?.items || [])
              .filter((s) => s.status !== 'diambil')
              .filter((s) => {
                const q = serviceSearch.trim().toLowerCase();
                if (!q) return true;
                return (
                  (s.nama_device || '').toLowerCase().includes(q) ||
                  (s.pelanggan_nama || '').toLowerCase().includes(q) ||
                  String(s.id).includes(q)
                );
              })
              .map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="flex justify-between items-center w-full"
                  style={{ background: 'none', border: 'none', padding: '8px 10px', borderRadius: 'var(--radius-sm)', textAlign: 'left' }}
                  onClick={() => onPickService(s)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span>
                    <span className="font-mono text-sm text-muted">#{s.id}</span> — {s.nama_device}
                    {s.pelanggan_nama ? ` (${s.pelanggan_nama})` : ''}
                  </span>
                  <span className="num text-sm">{formatRupiah(s.biaya || s.estimasi_biaya || 0)}</span>
                </button>
              ))}
            {(services.data?.items || []).filter((s) => s.status !== 'diambil').length === 0 && (
              <p className="text-sm text-muted">Belum ada service. Buat dulu lewat menu Service HP.</p>
            )}
          </div>
        </div>
      </Modal>
    </form>
  );
}