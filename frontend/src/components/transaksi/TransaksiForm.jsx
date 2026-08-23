import { useState, useMemo } from 'react';
import { api, newIdempotencyKey } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { METODE_PEMBAYARAN, formatRupiah, todayWIB, formatRupiahInput, parseRupiah } from '../../lib/format';
import { Button } from '../ui/Button';
import { Field, Input, Select } from '../ui/Field';
import { Icon } from '../ui/Icon';

const JENIS_OPTIONS = [
  { value: '', label: '-- Pilih Jenis --' },
  { value: 'penjualan', label: 'Penjualan' },
  { value: 'produkdigital', label: 'Produk Digital' },
  { value: 'tariktunai', label: 'Tarik Tunai' },
  { value: 'service', label: 'Service HP' },
];

const SUB_JENIS_OPTIONS = [
  { value: 'pulsa', label: 'Pulsa / Data / Token' },
  { value: 'dana', label: 'Top Up DANA' },
  { value: 'transfer', label: 'Transfer / Kirim Bank' },
];

const SUB_JENIS_AKUN_MAP = {
  pulsa: 'OrderKuota',
  dana: 'DANA',
  transfer: 'SeaBank',
};

const ADMIN_PRESETS = [
  { value: '', label: 'Preset' },
  { value: '0', label: '0' },
  { value: '2000', label: '2.000' },
  { value: '3000', label: '3.000' },
  { value: '5000', label: '5.000' },
  { value: '10000', label: '10.000' },
  { value: '15000', label: '15.000' },
  { value: '20000', label: '20.000' },
  { value: '25000', label: '25.000' },
];

const TIPE_ADMIN_OPTIONS = [
  { value: 'dalam', label: 'Dalam (fee potong dari tunai)' },
  { value: 'luar', label: 'Luar (fee ditambah ke pelanggan)' },
];

function AdminPreset({ value, onChange, presetValue, onPresetChange }) {
  return (
    <div className="input-group">
      <Select
        value={presetValue}
        onChange={onPresetChange}
        style={{ flexShrink: 0, width: 90 }}
      >
        {ADMIN_PRESETS.map((p) => (
          <option key={p.value + presetValue} value={p.value}>{p.label}</option>
        ))}
      </Select>
      <Input
        type="text"
        inputMode="numeric"
        value={value ? formatRupiahInput(String(value)) : ''}
        onChange={(e) => onChange(formatRupiahInput(e.target.value))}
        placeholder="0"
        style={{ flex: 1 }}
      />
    </div>
  );
}

function LabaDisplay({ value }) {
  const num = Number(value) || 0;
  if (num < 0) {
    return (
      <div className="flex items-center gap-2" style={{ minHeight: 38 }}>
        <span className="num" style={{ fontWeight: 700, color: 'var(--danger)' }}>{formatRupiah(num)}</span>
        <span className="badge badge-danger">Nominal Kurang</span>
      </div>
    );
  }
  if (num === 0) {
    return (
      <div className="flex items-center" style={{ minHeight: 38 }}>
        <span className="num" style={{ fontWeight: 700, color: 'var(--text-muted)' }}>{formatRupiah(0)}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center" style={{ minHeight: 38 }}>
      <span className="num" style={{ fontWeight: 700, color: 'var(--success)' }}>{formatRupiah(num)}</span>
    </div>
  );
}

export default function TransaksiForm({ initial, onSaved, onCancel: _onCancel }) {
  const today = todayWIB();
  const maxBackdate = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  })();

  const isEdit = Boolean(initial?.id);

  const produk = useAsync(() => api.get('/produk', { limit: 500 }), { deps: [] });
  const kategori = useAsync(() => api.get('/kategori'), { deps: [] });
  const akun = useAsync(() => api.get('/akun'), { deps: [] });
  const pelanggan = useAsync(() => api.get('/pelanggan', { limit: 500 }), { deps: [] });
  const kasir = useAsync(() => api.get('/kasir/current'), { deps: [] });

  const allProduk = useMemo(() => (produk.data?.items || []).filter((p) => !p.deleted_at), [produk.data]);
  const kategoriList = useMemo(() => (kategori.data?.items || []).filter((k) => !k.deleted_at), [kategori.data]);
  const akunList = useMemo(() => akun.data?.items || [], [akun.data]);
  const bankAkun = useMemo(
    () => akunList.filter((a) => a.tipe === 'bank' || a.tipe === 'e_wallet' || a.tipe === 'digital'),
    [akunList]
  );
  const pelangganList = useMemo(() => pelanggan.data?.items || [], [pelanggan.data]);
  const kasirData = kasir.data;

  const getSaldo = (namaAkun) => {
    const s = (kasirData?.saldo || []).find((x) => x.nama_akun === namaAkun);
    return s?.saldo_sistem ?? 0;
  };

  const pelangganOptions = useMemo(() => {
    const list = [{ id: '', nama: 'Umum / Tanpa Pelanggan' }];
    for (const p of pelangganList) {
      list.push({ id: p.id, nama: p.nama });
    }
    return list;
  }, [pelangganList]);

  const [jenis, setJenis] = useState(() => {
    if (initial?.jenis === 'produkdigital') return 'produkdigital';
    if (initial?.jenis === 'tariktunai') return 'tariktunai';
    if (initial?.jenis === 'service') return 'service';
    if (initial?.jenis === 'penjualan') return 'penjualan';
    return '';
  });
  const [tanggal, setTanggal] = useState(() => initial?.tanggal_transaksi || today);
  const [pelangganInput, setPelangganInput] = useState(() => initial?.pelanggan_nama || 'Umum / Tanpa Pelanggan');
  const [pelangganId, setPelangganId] = useState(() => initial?.pelanggan_id || '');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const [metodeBayar, setMetodeBayar] = useState(initial?.metode_bayar || 'tunai');
  const [akunPenerima, setAkunPenerima] = useState(initial?.akun_penerima || '');

  const [keranjang, setKeranjang] = useState(() =>
    (initial?.items || []).map((i) => ({
      produk_id: i.produk_id ?? '',
      nama: i.nama_produk_snapshot || i.nama_produk || '',
      harga: i.harga_snapshot ?? i.harga ?? 0,
      modal: i.harga_modal ?? i.modal ?? 0,
      qty: i.qty ?? 1,
    }))
  );
  const [search, setSearch] = useState('');
  const [kategoriFilter, setKategoriFilter] = useState('');

  const [subJenis, setSubJenis] = useState(initial?.sub_jenis || 'pulsa');
  const [akunBankDigital, setAkunBankDigital] = useState(initial?.akun_sumber || '');
  const [searchDigital, setSearchDigital] = useState('');
  const [selectedDigitalProduk, setSelectedDigitalProduk] = useState(null);
  const [hargaJualDigital, setHargaJualDigital] = useState(initial?.harga_jual ? String(initial.harga_jual) : '');
  const [adminFeeDigital, setAdminFeeDigital] = useState(initial?.admin_fee ? String(initial.admin_fee) : '');
  const [modalDigital, setModalDigital] = useState(initial?.harga_modal ? String(initial.harga_modal) : '');
  const [qtyDigital, setQtyDigital] = useState(initial?.qty || 1);
  const [adminPresetDigital, setAdminPresetDigital] = useState('');

  const [akunBankTarik, setAkunBankTarik] = useState(initial?.akun_sumber || '');
  const [nominalTarik, setNominalTarik] = useState(initial?.nominal ? String(initial.nominal) : '');
  const [adminFeeTarik, setAdminFeeTarik] = useState(initial?.admin_fee ? String(initial.admin_fee) : '');
  const [tipeAdmin, setTipeAdmin] = useState(initial?.admin_type || 'dalam');
  const [qtyTarik, setQtyTarik] = useState(initial?.qty || 1);
  const [adminPresetTarik, setAdminPresetTarik] = useState('');

  const [namaDevice, setNamaDevice] = useState(initial?.service?.nama_device || '');
  const [kerusakan, setKerusakan] = useState(initial?.service?.deskripsi_kerusakan || '');
  const [biayaService, setBiayaService] = useState(initial?.service?.biaya ? String(initial.service.biaya) : '');
  const [modalService, setModalService] = useState(initial?.service?.harga_modal ? String(initial.service.harga_modal) : '');
  const [tanggalMasuk, setTanggalMasuk] = useState(initial?.service?.tanggal_masuk || today);
  const [tanggalGaransi, setTanggalGaransi] = useState(initial?.service?.tanggal_garansi || '');
  const [catatanTeknisi, setCatatanTeknisi] = useState(initial?.service?.catatan || '');
  const [metodeBayarService, setMetodeBayarService] = useState(initial?.metode_bayar || 'tunai');

  const handleJenisChange = (val) => {
    setJenis(val);
    setSubmitError(null);
    if (val === 'produkdigital' && !akunBankDigital && bankAkun.length > 0) {
      setAkunBankDigital(SUB_JENIS_AKUN_MAP[subJenis] || bankAkun[0]?.nama_akun || '');
    }
    if (val === 'tariktunai') {
      if (!akunBankTarik && bankAkun.length > 0) {
        setAkunBankTarik(bankAkun[0]?.nama_akun || '');
      }
      // Auto-select produk TT
      if (!selectedDigitalProduk) {
        const ttProduk = allProduk.find((p) => p.nama.toLowerCase().includes('tarik tunai') || p.kode.toLowerCase().includes('tt'));
        if (ttProduk) handlePickDigitalProduk(ttProduk);
      }
    }
  };

  const handleSubJenisChange = (val) => {
    setSubJenis(val);
    const mapped = SUB_JENIS_AKUN_MAP[val];
    if (mapped) setAkunBankDigital(mapped);
  };

  const handlePelangganInput = (val) => {
    setPelangganInput(val);
    const match = pelangganList.find((p) => p.nama === val);
    setPelangganId(match ? match.id : '');
  };

  const predikat = (item, q) => {
    const s = q.toLowerCase();
    return (
      (item.kode || '').toLowerCase().includes(s) ||
      (item.nama || '').toLowerCase().includes(s)
    );
  };

  const matchKategori = (p) => {
    if (kategoriFilter === '') return true;
    if (kategoriFilter === 'none') return p.kategori_id == null;
    return String(p.kategori_id) === kategoriFilter;
  };

  const hasilPenjualan = useMemo(() => {
    if (!search) return null;
    return allProduk.filter((p) => matchKategori(p) && predikat(p, search)).slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, allProduk, kategoriFilter]);

  const hasilDigital = useMemo(() => {
    if (!searchDigital) return null;
    return allProduk.filter((p) => predikat(p, searchDigital)).slice(0, 12);
  }, [searchDigital, allProduk]);

  const onPickProduk = (p) => {
    setKeranjang((prev) => {
      const existing = prev.find((it) => String(it.produk_id) === String(p.id));
      if (existing) return prev.map((it) => (it === existing ? { ...it, qty: it.qty + 1 } : it));
      return [...prev, { produk_id: p.id, nama: p.nama, harga: p.harga, modal: p.harga_modal || 0, qty: 1 }];
    });
    setSearch('');
  };

  const updateItem = (idx, patch) =>
    setKeranjang((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx) => setKeranjang((prev) => prev.filter((_, i) => i !== idx));

  const totalKeranjang = keranjang.reduce((s, it) => s + (Number(it.harga) || 0) * Number(it.qty || 1), 0);

  const handlePickDigitalProduk = (p) => {
    setSelectedDigitalProduk(p);
    setHargaJualDigital(String(p.harga || ''));
    setModalDigital(String(p.harga_modal || ''));
    const h = Number(p.harga) || 0;
    const m = Number(p.harga_modal) || 0;
    const a = h - m;
    setAdminFeeDigital(String(a > 0 ? a : ''));
    setAdminPresetDigital('');
    setSearchDigital('');
  };

  const hargaJualNum = parseRupiah(hargaJualDigital) || 0;
  const adminFeeDigitalNum = parseRupiah(adminFeeDigital) || 0;
  const modalDigitalNum = parseRupiah(modalDigital) || 0;

  const computeDigital = (source, rawHarga, rawAdmin, rawModal) => {
    const h = rawHarga != null ? rawHarga : hargaJualNum;
    const a = rawAdmin != null ? rawAdmin : adminFeeDigitalNum;
    const m = rawModal != null ? rawModal : modalDigitalNum;
    if (source === 'harga') {
      // Harga jual berubah → admin = harga - modal (modal tetap dari produk)
      setAdminFeeDigital(String(Math.max(0, h - m)));
      setAdminPresetDigital('');
    } else if (source === 'admin') {
      // Admin berubah → modal = harga - admin
      setModalDigital(String(Math.max(0, h - a)));
    } else if (source === 'modal') {
      // Modal berubah manual → admin = harga - modal
      setAdminFeeDigital(String(Math.max(0, h - m)));
      setAdminPresetDigital('');
    }
  };

  const handleAdminPresetDigital = (val) => {
    setAdminPresetDigital(val);
    if (val !== '') {
      setAdminFeeDigital(val);
      const adminNum = Number(val) || 0;
      const m = hargaJualNum - adminNum;
      setModalDigital(m > 0 ? String(m) : '0');
    }
  };

  const labaDigital = hargaJualNum - modalDigitalNum;
  const totalDigital = hargaJualNum * qtyDigital;
  const saldoDigital = getSaldo(akunBankDigital);
  const saldoAfterDigital = saldoDigital - modalDigitalNum * qtyDigital;

  const nominalTarikNum = parseRupiah(nominalTarik) || 0;
  const adminFeeTarikNum = parseRupiah(adminFeeTarik) || 0;
  const tunaiDikeluarkan = tipeAdmin === 'dalam' ? nominalTarikNum - adminFeeTarikNum : nominalTarikNum;
  const totalTarik = nominalTarikNum * qtyTarik;
  const saldoTarikVal = getSaldo(akunBankTarik);
  const saldoTarikAfter = tipeAdmin === 'dalam'
    ? saldoTarikVal + nominalTarikNum - adminFeeTarikNum
    : saldoTarikVal + nominalTarikNum;

  const handleAdminPresetTarik = (val) => {
    setAdminPresetTarik(val);
    if (val !== '') setAdminFeeTarik(val);
  };

  const biayaServiceNum = parseRupiah(biayaService) || 0;
  const modalServiceNum = parseRupiah(modalService) || 0;
  const labaService = biayaServiceNum - modalServiceNum;

  const isTransfer = metodeBayar === 'transfer';

  const digitalDesc = useMemo(() => {
    if (subJenis === 'transfer') {
      return `Toko kirim saldo ${formatRupiah(hargaJualNum)} ke pelanggan via ${akunBankDigital || '-'}.`;
    }
    return `Pelanggan bayar ${formatRupiah(hargaJualNum + adminFeeDigitalNum)}, toko beli ${formatRupiah(modalDigitalNum)} via ${akunBankDigital || '-'}.`;
  }, [subJenis, hargaJualNum, adminFeeDigitalNum, modalDigitalNum, akunBankDigital]);

  const tarikDesc = `Pelanggan kirim ${formatRupiah(nominalTarikNum)} ke ${akunBankTarik || '-'}, toko berikan tunai ${formatRupiah(tunaiDikeluarkan)}.`;

  const handleReset = () => {
    setKeranjang([]);
    setPelangganInput('Umum / Tanpa Pelanggan');
    setPelangganId('');
    setMetodeBayar('tunai');
    setAkunPenerima('');
    setSearch('');
    setKategoriFilter('');
    setSelectedDigitalProduk(null);
    setSearchDigital('');
    setHargaJualDigital('');
    setAdminFeeDigital('');
    setModalDigital('');
    setQtyDigital(1);
    setAdminPresetDigital('');
    setNominalTarik('');
    setAdminFeeTarik('');
    setQtyTarik(1);
    setAdminPresetTarik('');
    setNamaDevice('');
    setKerusakan('');
    setBiayaService('');
    setModalService('');
    setTanggalGaransi('');
    setCatatanTeknisi('');
    setMetodeBayarService('tunai');
    setSubmitError(null);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    if (!jenis) {
      setSubmitError('Pilih jenis transaksi terlebih dahulu.');
      return;
    }

    if (jenis === 'penjualan') {
      if (keranjang.length === 0) {
        setSubmitError('Keranjang kosong!');
        return;
      }
    } else if (jenis === 'produkdigital') {
      if (!selectedDigitalProduk) {
        setSubmitError('Pilih produk digital terlebih dahulu!');
        return;
      }
      if (!hargaJualNum) {
        setSubmitError('Harga jual harus diisi!');
        return;
      }
    } else if (jenis === 'tariktunai') {
      if (!nominalTarikNum) {
        setSubmitError('Nominal saldo masuk harus diisi!');
        return;
      }
    } else if (jenis === 'service') {
      if (!namaDevice.trim()) {
        setSubmitError('Nama device harus diisi!');
        return;
      }
      if (!kerusakan.trim()) {
        setSubmitError('Kerusakan harus diisi!');
        return;
      }
      if (!biayaServiceNum) {
        setSubmitError('Biaya service harus diisi!');
        return;
      }
    }

    let body;

    if (jenis === 'penjualan') {
      body = {
        items: keranjang.map((it) => ({
          produk_id: Number(it.produk_id),
          qty: Number(it.qty),
        })),
        metode_bayar: metodeBayar,
        pelanggan_id: pelangganId || null,
        ...(metodeBayar === 'transfer' ? { akun_penerima: akunPenerima } : {}),
        ...(isEdit ? {} : { tanggal_transaksi: tanggal || null }),
      };
    } else if (jenis === 'produkdigital') {
      body = {
        items: [
          {
            produk_id: Number(selectedDigitalProduk.id),
            qty: qtyDigital,
            harga_jual: hargaJualNum,
            harga_modal: modalDigitalNum,
            admin_fee: adminFeeDigitalNum,
          },
        ],
        metode_bayar: metodeBayar,
        akun_sumber: akunBankDigital,
        admin_fee: adminFeeDigitalNum,
        sub_jenis: subJenis,
        pelanggan_id: pelangganId || null,
        ...(metodeBayar === 'transfer' ? { akun_penerima: akunPenerima } : {}),
        ...(isEdit ? {} : { tanggal_transaksi: tanggal || null }),
      };
    } else if (jenis === 'tariktunai') {
      body = {
        nominal: nominalTarikNum,
        mitra: akunBankTarik,
        admin_type: tipeAdmin,
        admin: adminFeeTarikNum,
        metode_pembayaran: 'Tunai Laci',
        pelanggan_id: pelangganId || null,
        ...(isEdit ? {} : { tanggal_transaksi: tanggal || null }),
        jenis: 'tariktunai',
      };
    } else if (jenis === 'service') {
      body = {
        items: [],
        metode_bayar: metodeBayarService,
        pelanggan_id: pelangganId || null,
        service: {
          nama_device: namaDevice.trim(),
          deskripsi_kerusakan: kerusakan.trim(),
          biaya: biayaServiceNum,
          harga_modal: modalServiceNum,
          tanggal_masuk: tanggalMasuk || null,
          tanggal_garansi: tanggalGaransi || null,
          catatan: catatanTeknisi || null,
        },
        ...(isEdit ? {} : { tanggal_transaksi: tanggal || null }),
      };
    }

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

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="flex flex-col gap-4">
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div className="grid-3">
            <Field label="Jenis Transaksi" required>
              <Select value={jenis} onChange={(e) => handleJenisChange(e.target.value)}>
                {JENIS_OPTIONS.map((j) => (
                  <option key={j.value} value={j.value}>{j.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Pelanggan">
              <input
                className="input"
                type="text"
                list="pelanggan-list-transaksi"
                value={pelangganInput}
                onChange={(e) => handlePelangganInput(e.target.value)}
                placeholder="Ketik nama atau pilih..."
              />
              <datalist id="pelanggan-list-transaksi">
                {pelangganOptions.map((p) => (
                  <option key={p.id} value={p.nama} />
                ))}
              </datalist>
              <span className="field-hint">Ketik nama baru atau pilih dari daftar</span>
            </Field>
            <Field label="Tanggal">
              <Input
                type="date"
                min={maxBackdate}
                max={today}
                value={tanggal}
                onChange={(e) => setTanggal(e.target.value)}
              />
            </Field>
          </div>
        </div>

        {jenis === 'penjualan' && (
          <div className="card" style={{ padding: 'var(--space-4)' }}>
            <div className="grid-2 mb-3">
              <Field label="Filter Kategori">
                <Select value={kategoriFilter} onChange={(e) => setKategoriFilter(e.target.value)}>
                  <option value="">Semua kategori</option>
                  <option value="none">Tanpa kategori</option>
                  {kategoriList.map((k) => (
                    <option key={k.id} value={k.id}>{k.nama}{!k.lacak_stok ? ' (non-stok)' : ''}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Cari produk" hint="Ketik kode/nama...">
                <Input
                  type="search"
                  value={search}
                  placeholder="Ketik kode atau nama..."
                  onChange={(e) => setSearch(e.target.value)}
                  autoComplete="off"
                />
              </Field>
            </div>

            {hasilPenjualan && hasilPenjualan.length > 0 && (
              <div
                className="card"
                style={{ padding: 'var(--space-2)', maxHeight: 190, overflowY: 'auto', boxShadow: 'none' }}
              >
                {hasilPenjualan.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="flex justify-between items-center w-full"
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                    onClick={() => onPickProduk(p)}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span>
                      <span className="font-mono text-sm text-muted">{p.kode}</span> -- {p.nama}
                    </span>
                    <span className="num text-sm" style={{ color: 'var(--success)' }}>{formatRupiah(p.harga)}</span>
                  </button>
                ))}
              </div>
            )}
            {hasilPenjualan && hasilPenjualan.length === 0 && (
              <p className="text-sm text-muted" style={{ padding: '8px 10px' }}>Tidak ditemukan</p>
            )}

            {keranjang.length > 0 && (
              <fieldset
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2)',
                  marginTop: 12,
                }}
              >
                <legend className="field-label" style={{ marginLeft: 'var(--space-2)' }}>Keranjang</legend>
                {keranjang.map((it, idx) => (
                  <div key={idx} className="cart-item">
                    <div className="cart-item-nameline">
                      <span className="cart-item-nama">{it.nama}</span>
                      <div className="cart-item-side">
                        <div className="cart-item-stepper">
                          <button type="button" className="btn btn-secondary btn-sm"
                            onClick={() => updateItem(idx, { qty: Math.max(1, Number(it.qty) - 1) })}>
                            -
                          </button>
                          <span className="num cart-item-qty">{it.qty}</span>
                          <button type="button" className="btn btn-secondary btn-sm"
                            onClick={() => updateItem(idx, { qty: Number(it.qty) + 1 })}>
                            +
                          </button>
                        </div>
                        <span className="num cart-item-price">{formatRupiah((Number(it.harga) || 0) * it.qty)}</span>
                        <button type="button" className="btn btn-ghost btn-sm cart-item-trash"
                          onClick={() => removeItem(idx)}>
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </fieldset>
            )}

            <div className="grid-2" style={{ marginTop: 12 }}>
              <Field label="Metode Bayar" required>
                <Select value={metodeBayar} onChange={(e) => setMetodeBayar(e.target.value)}>
                  {METODE_PEMBAYARAN.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </Select>
              </Field>
              {isTransfer && (
                <Field label="Akun Penerima Transfer" required>
                  <Select value={akunPenerima} onChange={(e) => setAkunPenerima(e.target.value)}>
                    <option value="">Pilih akun...</option>
                    {bankAkun.map((a) => (
                      <option key={a.id} value={a.nama_akun}>{a.nama_akun}</option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>

            <div
              className="flex justify-between items-center"
              style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)', marginTop: 'var(--space-3)' }}
            >
              <div>
                <span className="text-sm text-secondary">Total</span>
                <div className="num" style={{ fontSize: '1.3rem', fontWeight: 800 }}>{formatRupiah(totalKeranjang)}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" type="button" onClick={handleReset}>Batal</Button>
                <Button type="submit" loading={busy}>Simpan Transaksi</Button>
              </div>
            </div>
          </div>
        )}

        {jenis === 'produkdigital' && (
          <div className="card" style={{ padding: 'var(--space-4)' }}>
            <div className="grid-2 mb-3">
              <Field label="Sub Jenis" required>
                <Select value={subJenis} onChange={(e) => handleSubJenisChange(e.target.value)}>
                  {SUB_JENIS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Akun Bank Toko (sumber modal)" required>
                <Select value={akunBankDigital} onChange={(e) => setAkunBankDigital(e.target.value)}>
                  <option value="">Pilih akun...</option>
                  {bankAkun.map((a) => (
                    <option key={a.id} value={a.nama_akun}>{a.nama_akun}</option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="Cari produk" required hint="Ketik kode/nama...">
              <Input
                type="search"
                value={searchDigital}
                placeholder="Ketik kode/nama..."
                onChange={(e) => setSearchDigital(e.target.value)}
                autoComplete="off"
              />
            </Field>

            {hasilDigital && hasilDigital.length > 0 && (
              <div
                className="card"
                style={{ padding: 'var(--space-2)', maxHeight: 190, overflowY: 'auto', boxShadow: 'none', marginTop: 8 }}
              >
                {hasilDigital.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="flex justify-between items-center w-full"
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                    onClick={() => handlePickDigitalProduk(p)}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span>
                      <span className="font-mono text-sm text-muted">{p.kode}</span> -- {p.nama}
                    </span>
                    <span className="num text-sm" style={{ color: 'var(--success)' }}>{formatRupiah(p.harga)}</span>
                  </button>
                ))}
              </div>
            )}
            {hasilDigital && hasilDigital.length === 0 && (
              <p className="text-sm text-muted" style={{ padding: '8px 10px' }}>Tidak ditemukan</p>
            )}

            {selectedDigitalProduk && (
              <div style={{ marginTop: 12 }}>
                <div
                  className="card"
                  style={{
                    padding: 'var(--space-2)',
                    boxShadow: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span className="font-mono text-sm text-muted">{selectedDigitalProduk.kode}</span>
                  <span className="cart-item-nama" style={{ flex: 1 }}>{selectedDigitalProduk.nama}</span>
                  <span className="num text-sm" style={{ color: 'var(--success)' }}>{formatRupiah(selectedDigitalProduk.harga)}</span>
                </div>
              </div>
            )}

            <div
              className="card"
              style={{
                padding: 'var(--space-2)',
                background: 'var(--bg-surface-alt)',
                boxShadow: 'none',
                marginTop: 12,
              }}
            >
              <div className="flex justify-between items-center" style={{ fontSize: '.85rem', marginBottom: 4 }}>
                <span className="text-muted">Saldo Akun</span>
              </div>
              <div className="flex justify-between items-center" style={{ fontSize: '.85rem' }}>
                <span className="text-muted">Tersedia</span>
                <span className="num" style={{ fontWeight: 700 }}>{formatRupiah(saldoDigital)}</span>
              </div>
              {hargaJualNum > 0 && (
                <div className="flex justify-between items-center" style={{ fontSize: '.85rem', marginTop: 2 }}>
                  <span className="text-muted">Setelah transaksi</span>
                  <span
                    className="num"
                    style={{ fontWeight: 700, color: saldoAfterDigital < 0 ? 'var(--danger)' : 'var(--success)' }}
                  >
                    {formatRupiah(saldoAfterDigital)}
                  </span>
                </div>
              )}
            </div>

            <div className="grid-2" style={{ marginTop: 12 }}>
              <Field label="Harga Jual (Rp)">
                <Input
                  type="text"
                  inputMode="numeric"
                  value={hargaJualDigital ? formatRupiahInput(hargaJualDigital) : ''}
                  onChange={(e) => {
                    const raw = formatRupiahInput(e.target.value);
                    setHargaJualDigital(raw);
                    computeDigital('harga', parseRupiah(raw), adminFeeDigitalNum, modalDigitalNum);
                  }}
                  placeholder="Harga ke pelanggan"
                />
              </Field>
              <Field label="Admin / Fee (Rp)" hint="Isi harga jual + admin -> modal auto. Atau harga jual + modal -> admin auto.">
                <AdminPreset
                  value={adminFeeDigital}
                  onChange={(val) => {
                    setAdminFeeDigital(val);
                    computeDigital('admin', hargaJualNum, parseRupiah(val), modalDigitalNum);
                  }}
                  presetValue={adminPresetDigital}
                  onPresetChange={(e) => handleAdminPresetDigital(e.target.value)}
                />
              </Field>
            </div>

            <div className="grid-2" style={{ marginTop: 12 }}>
              <Field label="Modal / Harga Beli (Rp)">
                <Input
                  type="text"
                  inputMode="numeric"
                  value={modalDigital ? formatRupiahInput(modalDigital) : ''}
                  onChange={(e) => {
                    const raw = formatRupiahInput(e.target.value);
                    setModalDigital(raw);
                    computeDigital('modal', hargaJualNum, adminFeeDigitalNum, parseRupiah(raw));
                  }}
                  placeholder="Auto dari harga jual - admin"
                />
                <span className="field-hint">Otomatis terhitung, atau input manual</span>
              </Field>
              <Field label="Laba">
                <LabaDisplay value={labaDigital} />
              </Field>
            </div>

            <div className="flex items-center gap-3" style={{ marginTop: 12 }}>
              <span className="text-sm text-muted">Banyak Transaksi</span>
              <div className="cart-item-stepper">
                <button type="button" className="btn btn-secondary btn-sm"
                  onClick={() => setQtyDigital((q) => Math.max(1, q - 1))}>-</button>
                <span className="num cart-item-qty">{qtyDigital}</span>
                <button type="button" className="btn btn-secondary btn-sm"
                  onClick={() => setQtyDigital((q) => q + 1)}>+</button>
              </div>
              {qtyDigital > 1 && (
                <span className="text-sm text-muted">
                  Total {qtyDigital}x: {formatRupiah(totalDigital)}
                </span>
              )}
            </div>

            <div
              style={{
                background: 'var(--info-soft)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 12px',
                fontSize: '.8rem',
                color: 'var(--accent)',
                marginTop: 8,
              }}
            >
              {digitalDesc}
            </div>

            <div className="grid-2" style={{ marginTop: 12 }}>
              <Field label="Metode Bayar">
                <Select value={metodeBayar} onChange={(e) => setMetodeBayar(e.target.value)}>
                  {METODE_PEMBAYARAN.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </Select>
              </Field>
              {isTransfer && (
                <Field label="Transfer Ke Bank / Akun" required>
                  <Select value={akunPenerima} onChange={(e) => setAkunPenerima(e.target.value)}>
                    <option value="">Pilih tujuan transfer...</option>
                    {bankAkun.map((a) => (
                      <option key={a.id} value={a.nama_akun}>{a.nama_akun}</option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>

            <div
              className="flex justify-between items-center"
              style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)', marginTop: 'var(--space-3)' }}
            >
              <div>
                <span className="text-sm text-secondary">Total</span>
                <div className="num" style={{ fontSize: '1.3rem', fontWeight: 800 }}>{formatRupiah(totalDigital)}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" type="button" onClick={handleReset}>Batal</Button>
                <Button type="submit" loading={busy}>Simpan Transaksi</Button>
              </div>
            </div>
          </div>
        )}

        {jenis === 'tariktunai' && (
          <div className="card" style={{ padding: 'var(--space-4)' }}>
            <div
              className="card"
              style={{ padding: 'var(--space-2)', boxShadow: 'none', marginBottom: 12 }}
            >
              <div className="flex justify-between items-center">
                <span className="font-mono text-sm text-muted">TT-5</span>
                <span style={{ flex: 1, paddingLeft: 8 }}>Tarik Tunai</span>
                <span className="num text-sm" style={{ color: 'var(--success)' }}>Fee admin</span>
              </div>
            </div>
            <div className="grid-2 mb-3">
              <Field label="Akun Bank Toko (penerima)" required>
                <Select value={akunBankTarik} onChange={(e) => setAkunBankTarik(e.target.value)}>
                  <option value="">Pilih akun...</option>
                  {bankAkun.map((a) => (
                    <option key={a.id} value={a.nama_akun}>{a.nama_akun}</option>
                  ))}
                </Select>
              </Field>
              <div>
                <label className="field-label">Saldo Akun</label>
                <div
                  className="card"
                  style={{ padding: 'var(--space-2)', background: 'var(--bg-surface-alt)', boxShadow: 'none' }}
                >
                  <div className="flex justify-between items-center" style={{ fontSize: '.85rem', marginBottom: 2 }}>
                    <span className="text-muted">Tersedia</span>
                    <span className="num" style={{ fontWeight: 700 }}>{formatRupiah(saldoTarikVal)}</span>
                  </div>
                  {nominalTarikNum > 0 && (
                    <div className="flex justify-between items-center" style={{ fontSize: '.85rem' }}>
                      <span className="text-muted">Setelah transaksi</span>
                      <span
                        className="num"
                        style={{ fontWeight: 700, color: saldoTarikAfter < 0 ? 'var(--danger)' : 'var(--success)' }}
                      >
                        {formatRupiah(saldoTarikAfter)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid-3">
              <Field label="Saldo Masuk dari Pelanggan (Rp)" required>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={nominalTarik ? formatRupiahInput(nominalTarik) : ''}
                  onChange={(e) => setNominalTarik(formatRupiahInput(e.target.value))}
                  placeholder="mis. 100.000"
                />
              </Field>
              <Field label="Admin / Fee (Rp)">
                <AdminPreset
                  value={adminFeeTarik}
                  onChange={(val) => setAdminFeeTarik(val)}
                  presetValue={adminPresetTarik}
                  onPresetChange={(e) => handleAdminPresetTarik(e.target.value)}
                />
              </Field>
              <Field label="Tipe Admin">
                <Select value={tipeAdmin} onChange={(e) => setTipeAdmin(e.target.value)}>
                  {TIPE_ADMIN_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid-2" style={{ marginTop: 12 }}>
              <Field label="Tunai Dikeluarkan (Rp)">
                <Input
                  type="text"
                  readOnly
                  value={tunaiDikeluarkan > 0 ? formatRupiah(tunaiDikeluarkan) : ''}
                  placeholder="Otomatis"
                  style={{ background: 'var(--bg-surface-alt)', cursor: 'not-allowed' }}
                  tabIndex={-1}
                />
                <span className="field-hint">
                  {tipeAdmin === 'dalam'
                    ? 'Otomatis: Saldo Masuk - Admin'
                    : 'Otomatis: = Saldo Masuk'}
                </span>
              </Field>
              <Field label="Banyak Transaksi">
                <div className="flex items-center gap-3" style={{ marginTop: 6 }}>
                  <div className="cart-item-stepper">
                    <button type="button" className="btn btn-secondary btn-sm"
                      onClick={() => setQtyTarik((q) => Math.max(1, q - 1))}>-</button>
                    <span className="num cart-item-qty">{qtyTarik}</span>
                    <button type="button" className="btn btn-secondary btn-sm"
                      onClick={() => setQtyTarik((q) => q + 1)}>+</button>
                  </div>
                  {qtyTarik > 1 && (
                    <span className="text-sm text-muted">
                      Total {qtyTarik}x: {formatRupiah(totalTarik)}
                    </span>
                  )}
                </div>
              </Field>
            </div>

            <div
              style={{
                background: 'var(--info-soft)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 12px',
                fontSize: '.8rem',
                color: 'var(--accent)',
                marginTop: 8,
              }}
            >
              {tarikDesc}
            </div>

            <div
              className="flex justify-between items-center"
              style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)', marginTop: 'var(--space-3)' }}
            >
              <div>
                <span className="text-sm text-secondary">Total</span>
                <div className="num" style={{ fontSize: '1.3rem', fontWeight: 800 }}>{formatRupiah(totalTarik)}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" type="button" onClick={handleReset}>Batal</Button>
                <Button type="submit" loading={busy}>Simpan Transaksi</Button>
              </div>
            </div>
          </div>
        )}

        {jenis === 'service' && (
          <div className="card" style={{ padding: 'var(--space-4)' }}>
            <div className="grid-2 mb-3">
              <Field label="Nama Device" required>
                <Input
                  type="text"
                  value={namaDevice}
                  onChange={(e) => setNamaDevice(e.target.value)}
                  placeholder="mis. Xiaomi Redmi Note 12"
                />
              </Field>
              <Field label="Kerusakan" required>
                <Input
                  type="text"
                  value={kerusakan}
                  onChange={(e) => setKerusakan(e.target.value)}
                  placeholder="mis. LCD retak"
                />
              </Field>
            </div>

            <div className="grid-3">
              <Field label="Biaya (Rp)" required>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={biayaService ? formatRupiahInput(biayaService) : ''}
                  onChange={(e) => setBiayaService(formatRupiahInput(e.target.value))}
                  placeholder="Harga ke pelanggan"
                />
              </Field>
              <Field label="Modal (Rp)">
                <Input
                  type="text"
                  inputMode="numeric"
                  value={modalService ? formatRupiahInput(modalService) : ''}
                  onChange={(e) => setModalService(formatRupiahInput(e.target.value))}
                  placeholder="Biaya part/bahan"
                />
              </Field>
              <Field label="Laba">
                <div
                  className="card"
                  style={{
                    padding: 'var(--space-2)',
                    background: 'var(--bg-surface-alt)',
                    boxShadow: 'none',
                    minHeight: 38,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <span
                    className="num"
                    style={{
                      fontWeight: 700,
                      color: labaService < 0 ? 'var(--danger)' : 'var(--success)',
                    }}
                  >
                    {formatRupiah(labaService)}
                  </span>
                </div>
              </Field>
            </div>

            <div className="grid-2" style={{ marginTop: 12 }}>
              <Field label="Tanggal Masuk">
                <Input
                  type="date"
                  value={tanggalMasuk}
                  onChange={(e) => setTanggalMasuk(e.target.value)}
                />
              </Field>
              <Field label="Tanggal Garansi Sampai">
                <Input
                  type="date"
                  value={tanggalGaransi}
                  onChange={(e) => setTanggalGaransi(e.target.value)}
                />
                <span className="field-hint">Batas garansi service</span>
              </Field>
            </div>

            <Field label="Catatan Teknisi" style={{ marginTop: 12 }}>
              <textarea
                className="textarea"
                value={catatanTeknisi}
                onChange={(e) => setCatatanTeknisi(e.target.value)}
                placeholder="mis. LCD original, garansi 1 minggu"
              />
            </Field>

            <div className="grid-2" style={{ marginTop: 12 }}>
              <Field label="Metode Bayar">
                <Select value={metodeBayarService} onChange={(e) => setMetodeBayarService(e.target.value)}>
                  {METODE_PEMBAYARAN.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </Select>
              </Field>
            </div>

            <div
              style={{
                background: 'var(--info-soft)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 12px',
                fontSize: '.8rem',
                color: 'var(--accent)',
                marginTop: 8,
              }}
            >
              Submit langsung buat 1 record service_hp + 1 transaksi.
            </div>

            <div
              className="flex justify-between items-center"
              style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)', marginTop: 'var(--space-3)' }}
            >
              <div>
                <span className="text-sm text-secondary">Total</span>
                <div className="num" style={{ fontSize: '1.3rem', fontWeight: 800 }}>{formatRupiah(biayaServiceNum)}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" type="button" onClick={handleReset}>Batal</Button>
                <Button type="submit" loading={busy}>Simpan Transaksi</Button>
              </div>
            </div>
          </div>
        )}

        {submitError && (
          <div className="field-error" role="alert" style={{ textAlign: 'center', padding: '8px' }}>
            {submitError}
          </div>
        )}
      </div>
    </form>
  );
}
