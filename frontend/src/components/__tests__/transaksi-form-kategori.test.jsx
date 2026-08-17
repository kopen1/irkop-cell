import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import TransaksiForm from '../transaksi/TransaksiForm.jsx';

const getMock = vi.fn();

vi.mock('../../lib/api', () => ({
  api: { get: (...a) => getMock(...a) },
  newIdempotencyKey: () => 'test-key',
}));

const produk = {
  items: [
    { id: 1, kode: 'PLS-001', nama: 'Pulsa', harga: 12000, kategori_id: 2, deleted_at: null },
    { id: 2, kode: 'TNR-001', nama: 'Toner', harga: 50000, kategori_id: 1, deleted_at: null },
    { id: 3, kode: 'TANPA-1', nama: 'Tanpa Kategori', harga: 3000, kategori_id: null, deleted_at: null },
  ],
};
const kategori = {
  items: [
    { id: 1, nama: 'Fisik', lacak_stok: 1 },
    { id: 2, nama: 'Digital', lacak_stok: 0 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  getMock.mockImplementation(async (path) => {
    if (path === '/produk') return produk;
    if (path === '/kategori') return kategori;
    if (path === '/akun') return { items: [] };
    return { items: [] };
  });
});
afterEach(() => cleanup());

function search(q) {
  fireEvent.change(screen.getByPlaceholderText(/kode atau nama produk/i), { target: { value: q } });
}

describe('TransaksiForm Filter Kategori (ITEM 4)', () => {
  it('menampilkan select Filter Kategori berisi opsi kategori dari GET /kategori', async () => {
    render(<TransaksiForm onSaved={() => {}} onCancel={() => {}} />);
    const filter = await screen.findByLabelText('Filter Kategori');
    expect(filter).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Semua kategori' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Tanpa kategori' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Fisik' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Digital (non-stok)' })).toBeTruthy();
    expect(getMock).toHaveBeenCalledWith('/kategori');
  });

  it('Semua kategori (default) menampilkan semua produk yang cocok, termasuk tanpa kategori', async () => {
    render(<TransaksiForm onSaved={() => {}} onCancel={() => {}} />);
    await screen.findByLabelText('Filter Kategori');
    search('1');
    await waitFor(() => expect(screen.getByText(/Toner/)).toBeTruthy());
    expect(screen.getByText(/Pulsa/)).toBeTruthy();
    expect(screen.getByText(/Tanpa Kategori/)).toBeTruthy();
  });

  it('filter kategori menyaring hasil pencarian', async () => {
    render(<TransaksiForm onSaved={() => {}} onCancel={() => {}} />);
    const filter = await screen.findByLabelText('Filter Kategori');
    search('1');

    fireEvent.change(filter, { target: { value: '1' } });
    await waitFor(() => expect(screen.getByText(/Toner/)).toBeTruthy());
    expect(screen.queryByText(/Pulsa/)).toBeNull();
    expect(screen.queryByText(/Tanpa Kategori/)).toBeNull();

    fireEvent.change(filter, { target: { value: '2' } });
    await waitFor(() => expect(screen.getByText(/Pulsa/)).toBeTruthy());
    expect(screen.queryByText(/Toner/)).toBeNull();

    fireEvent.change(filter, { target: { value: 'none' } });
    await waitFor(() => expect(screen.getByText(/Tanpa Kategori/)).toBeTruthy());
    expect(screen.queryByText(/Pulsa/)).toBeNull();
    expect(screen.queryByText(/Toner/)).toBeNull();
  });

  it('produk tanpa kategori tetap bisa dipilih via filter Tanpa kategori', async () => {
    render(<TransaksiForm onSaved={() => {}} onCancel={() => {}} />);
    const filter = await screen.findByLabelText('Filter Kategori');
    fireEvent.change(filter, { target: { value: 'none' } });
    search('Tanpa');
    await waitFor(() => expect(screen.getByText(/Tanpa Kategori/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Tanpa Kategori/));
    await waitFor(() => expect(screen.queryByText(/Belum ada produk di keranjang/)).toBeNull());
    expect(screen.getByText('Tanpa Kategori')).toBeTruthy();
  });

  it('daftar kategori kosong: filter tetap tampil dan pencarian tetap berfungsi', async () => {
    getMock.mockImplementation(async (path) => {
      if (path === '/produk') return { items: [{ id: 1, kode: 'X-1', nama: 'Bebas', harga: 100, kategori_id: null, deleted_at: null }] };
      if (path === '/kategori') return { items: [] };
      if (path === '/akun') return { items: [] };
      return { items: [] };
    });
    render(<TransaksiForm onSaved={() => {}} onCancel={() => {}} />);
    const filter = await screen.findByLabelText('Filter Kategori');
    expect(screen.getByRole('option', { name: 'Semua kategori' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Tanpa kategori' })).toBeTruthy();
    search('Bebas');
    await waitFor(() => expect(screen.getByText(/Bebas/)).toBeTruthy());
    expect(filter.value).toBe('');
  });

  it('edit transaksi: prefill keranjang tetap tampil dan filter tidak mengganggu', async () => {
    const initial = {
      id: 9,
      metode_bayar: 'tunai',
      items: [{ produk_id: 1, kode: 'PLS-001', nama_produk: 'Pulsa', harga: 12000, qty: 2 }],
    };
    render(<TransaksiForm initial={initial} onSaved={() => {}} onCancel={() => {}} />);
    await screen.findByLabelText('Filter Kategori');
    expect(screen.getByText('Pulsa')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText(/Simpan Perubahan/)).toBeTruthy();
  });

  it('showKategoriFilter=false menyembunyikan filter (manual entry LaporanPage tetap aman)', async () => {
    render(<TransaksiForm showKategoriFilter={false} onSaved={() => {}} onCancel={() => {}} />);
    expect(screen.queryByLabelText('Filter Kategori')).toBeNull();
    expect(await screen.findByLabelText('Cari produk (kode / nama)')).toBeTruthy();
  });
});