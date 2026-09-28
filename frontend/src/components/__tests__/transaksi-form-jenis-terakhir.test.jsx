import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import TransaksiForm from '../transaksi/TransaksiForm.jsx';

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    get: (...a) => getMock(...a),
    post: (...a) => postMock(...a),
  },
  newIdempotencyKey: () => 'test-key',
}));

const produk = {
  items: [
    { id: 1, kode: 'D10', nama: 'Dana 10.000', harga: 12000, harga_modal: 10000, kategori_id: 2, deleted_at: null },
  ],
};
const kategori = { items: [{ id: 2, nama: 'Saldo', lacak_stok: 0 }] };
const akun = { items: [{ nama_akun: 'DANA', tipe: 'e_wallet' }, { nama_akun: 'Tunai Laci', tipe: 'tunai' }] };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  getMock.mockImplementation(async (path) => {
    if (path === '/produk') return produk;
    if (path === '/kategori') return kategori;
    if (path === '/akun') return akun;
    if (path === '/pelanggan') return { items: [] };
    if (path === '/kasir/current') return { status: 'buka', saldo: [] };
    return { items: [] };
  });
  postMock.mockImplementation(async (path) => {
    if (path === '/transaksi') return { id: 'TX-1', kode: 'TX-1' };
    return {};
  });
});
afterEach(cleanup);

function nilaiJenis() {
  return screen.getByLabelText(/jenis transaksi/i).value;
}

describe('TransaksiForm — initialJenis (jenis terakhir yang disimpan)', () => {
  it('jenis kosong kalau tidak ada initialJenis (transaksi benar-benar baru)', () => {
    render(<TransaksiForm onSaved={() => {}} onCancel={() => {}} />);
    expect(nilaiJenis()).toBe('');
  });

  it('initialJenis = produkdigital langsung terpilih tanpa pilih ulang', () => {
    render(<TransaksiForm initialJenis="produkdigital" onSaved={() => {}} onCancel={() => {}} />);
    expect(nilaiJenis()).toBe('produkdigital');
    expect(screen.getByLabelText(/akun bank toko \(sumber modal\)/i)).toBeTruthy();
  });

  it('initialJenis = service terpilih', () => {
    render(<TransaksiForm initialJenis="service" onSaved={() => {}} onCancel={() => {}} />);
    expect(nilaiJenis()).toBe('service');
  });

  it('initial-transaksi (edit) MENANG atas initialJenis', () => {
    render(
      <TransaksiForm
        initial={{ id: 'TX-9', jenis: 'tariktunai', items: [] }}
        initialJenis="produkdigital"
        onSaved={() => {}}
        onCancel={() => {}}
      />
    );
    expect(nilaiJenis()).toBe('tariktunai');
  });

  it('onSaved menerima jenis yang dipilih, agar halaman bisa mengingatnya', async () => {
    const onSaved = vi.fn();
    render(<TransaksiForm onSaved={onSaved} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/jenis transaksi/i), { target: { value: 'produkdigital' } });

    const input = screen.getByPlaceholderText('Ketik kode/nama...');
    fireEvent.change(input, { target: { value: 'd10' } });
    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) => b.textContent.includes('Dana 10.000'));
      expect(btn).toBeTruthy();
      fireEvent.click(btn);
    });
    await waitFor(() => expect(screen.getByLabelText(/akun bank toko \(sumber modal\)/i).value).toBe('DANA'));

    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('produkdigital'), { timeout: 8000 });
  });
});
