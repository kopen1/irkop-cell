// Form Catat Service HP (reusable). Dipakai di halaman Laporan Service HP dan
// dari kategori "Service HP" pada form Transaksi Baru (item 8). Satu alur saja:
// POST /service-hp, lalu onSaved(). Harga Modal opsional (item 7): dipakai untuk
// perhitungan laba; kosong -> NULL (bukan 0).
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { formatRupiahInput, parseRupiah } from '../../lib/format';
import { Button } from '../ui/Button';
import { Field, Input, Select, Textarea } from '../ui/Field';

export default function ServiceHpForm({ onCancel, onSaved }) {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({
    pelanggan_id: '',
    nama_device: '',
    deskripsi_kerusakan: '',
    estimasi_biaya: '',
    harga_modal: '',
    teknisi_id: '',
    catatan: '',
    tanggal_masuk: '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isAdmin) api.get('/users', { limit: 200 }).then((r) => setUsers(r.items || [])).catch(() => {});
  }, [isAdmin]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setNominal = (k) => (e) => setForm((f) => ({ ...f, [k]: formatRupiahInput(e.target.value) }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.nama_device.trim()) return setError('Nama device wajib diisi.');
    if (!form.deskripsi_kerusakan.trim()) return setError('Deskripsi kerusakan wajib diisi.');
    setBusy(true);
    try {
      await api.post('/service-hp', {
        nama_device: form.nama_device.trim(),
        deskripsi_kerusakan: form.deskripsi_kerusakan.trim(),
        pelanggan_id: form.pelanggan_id ? Number(form.pelanggan_id) : null,
        estimasi_biaya: form.estimasi_biaya ? parseRupiah(form.estimasi_biaya) : null,
        harga_modal: form.harga_modal ? parseRupiah(form.harga_modal) : null,
        teknisi_id: form.teknisi_id ? Number(form.teknisi_id) : null,
        catatan: form.catatan.trim() || undefined,
        tanggal_masuk: form.tanggal_masuk || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid-2">
        <Field label="Nama device / tipe" required>
          <Input type="text" value={form.nama_device} placeholder="mis. iPhone 11" onChange={set('nama_device')} />
        </Field>
        <Field label="Pelanggan (opsional)">
          <PelangganSelect value={form.pelanggan_id} onChange={set('pelanggan_id')} />
        </Field>
      </div>
      <Field label="Deskripsi kerusakan" required>
        <Textarea value={form.deskripsi_kerusakan} placeholder="mis. LCD pecah, ganti panel" onChange={set('deskripsi_kerusakan')} />
      </Field>
      <div className="grid-2">
        <Field label="Estimasi biaya (Rp, opsional)">
          <Input type="text" inputMode="numeric" value={form.estimasi_biaya} onChange={setNominal('estimasi_biaya')} />
        </Field>
        <Field label="Harga modal (Rp, opsional)" hint="Dipakai hitung laba service.">
          <Input type="text" inputMode="numeric" value={form.harga_modal} onChange={setNominal('harga_modal')} placeholder="mis. 150.000" />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Tanggal masuk">
          <Input type="date" value={form.tanggal_masuk} onChange={set('tanggal_masuk')} />
        </Field>
        {isAdmin && (
          <Field label="Teknisi">
            <Select value={form.teknisi_id} onChange={set('teknisi_id')}>
              <option value="">Tanpa teknisi</option>
              {users.filter((u) => u.role === 'karyawan' || u.role === 'admin').map((u) => (
                <option key={u.id} value={u.id}>{u.nama}</option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <Field label="Catatan (opsional)">
        <Textarea value={form.catatan} onChange={set('catatan')} />
      </Field>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" type="button" onClick={onCancel}>Batal</Button>
        <Button type="submit" loading={busy}>Simpan</Button>
      </div>
    </form>
  );
}

function PelangganSelect({ value, onChange }) {
  const [list, setList] = useState([]);
  useEffect(() => {
    api.get('/pelanggan', { limit: 200 }).then((r) => setList(r.items || [])).catch(() => {});
  }, []);
  return (
    <Select value={value} onChange={onChange}>
      <option value="">Tanpa pelanggan</option>
      {list.map((p) => (
        <option key={p.id} value={p.id}>{p.nama}</option>
      ))}
    </Select>
  );
}