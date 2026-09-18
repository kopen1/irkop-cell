import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const mocks = vi.hoisted(() => ({
  get: vi.fn(async (path) => {
    const p = String(path);
    if (p === '/produk') {
      return {
        items: [
          { id: 11, kode: 'TF-1', nama: 'Transfer Bank (Semua Bank)', kategori_id: 5, harga: 5000, stok: 0, deleted_at: null },
          { id: 14, kode: 'PL-1', nama: 'Pulsa 50k', kategori_id: 6, harga: 50000, stok: 10, deleted_at: null },
        ],
      };
    }
    if (p === '/kategori') {
      return {
        items: [
          { id: 5, nama: 'Jasa', lacak_stok: 0, deleted_at: null },
          { id: 6, nama: 'Pulsa', lacak_stok: 1, deleted_at: null },
        ],
      };
    }
    if (p === '/akun') {
      return {
        items: [
          { id: 1, nama_akun: 'Tunai Laci', tipe: 'tunai' },
          { id: 2, nama_akun: 'SeaBank', tipe: 'bank' },
          { id: 3, nama_akun: 'DANA', tipe: 'e_wallet' },
        ],
      };
    }
    if (p === '/pelanggan') return { items: [] };
    if (p.startsWith('/transaksi')) return { items: [], total_items: 0, total_nilai: 0 };
    if (p === '/kasir/current') return { status: 'buka', saldo: [] };
    return {};
  }),
  post: vi.fn(async () => ({ id: 'TX-1' })),
  put: vi.fn(async () => ({})),
  del: vi.fn(async () => ({})),
}));

vi.mock('../../lib/api', () => ({
  api: { get: mocks.get, post: mocks.post, put: mocks.put, del: mocks.del },
  newIdempotencyKey: () => 'k',
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
  AuthProvider: ({ children }) => children,
}));
vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ toast: { success() {}, error() {} } }),
  ToastProvider: ({ children }) => children,
}));

import TransaksiPage from '../../pages/TransaksiPage';

afterEach(cleanup);
beforeEach(() => {
  mocks.get.mockClear();
  mocks.post.mockClear();
  mocks.put.mockClear();
  mocks.del.mockClear();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/transaksi']}>
      <TransaksiPage />
    </MemoryRouter>
  );
}

function openForm() {
  fireEvent.click(screen.getByText('Transaksi Baru'));
}

function pilihPenjualan() {
  fireEvent.change(screen.getByLabelText(/jenis transaksi/i), { target: { value: 'penjualan' } });
}

function cariProduk(q) {
  fireEvent.change(screen.getByPlaceholderText(/ketik kode atau nama/i), { target: { value: q } });
}

describe('TransaksiPage — form full-page', () => {
  it('klik Transaksi Baru membuka form (bukan modal) dengan field inti', async () => {
    renderPage();
    openForm();
    expect(await screen.findByLabelText(/jenis transaksi/i)).toBeTruthy();
    expect(screen.getByText('Pelanggan')).toBeTruthy();
    expect(screen.getByText('Umum / Tanpa Pelanggan')).toBeTruthy();
    // bukan dialog modal
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Kembali menutup form', async () => {
    renderPage();
    openForm();
    pilihPenjualan();
    await screen.findByLabelText('Filter Kategori');
    fireEvent.click(screen.getByText('Kembali'));
    expect(screen.queryByLabelText('Filter Kategori')).toBeNull();
  });

  it('Metode bayar Transfer menampilkan Akun Penerima Transfer dari akun_master', async () => {
    renderPage();
    openForm();
    pilihPenjualan();
    await screen.findByLabelText('Filter Kategori');
    fireEvent.change(screen.getByLabelText(/metode bayar/i), { target: { value: 'transfer' } });
    expect(await screen.findByLabelText(/akun penerima transfer/i)).toBeTruthy();
    expect(screen.getAllByRole('option', { name: 'SeaBank' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('option', { name: 'DANA' }).length).toBeGreaterThan(0);
  });

  it('Filter Kategori menyaring produk pada pencarian', async () => {
    renderPage();
    openForm();
    pilihPenjualan();
    const filter = await screen.findByLabelText('Filter Kategori');
    fireEvent.change(filter, { target: { value: '6' } });
    cariProduk('pulsa');
    const hasil = await screen.findByText(/Pulsa 50k/);
    fireEvent.click(hasil);
    expect(await screen.findByText('Keranjang (1 item)')).toBeTruthy();
    expect(screen.queryByText(/Transfer Bank/)).toBeNull();
  });

  it('pilih produk & simpan memanggil POST /transaksi', async () => {
    renderPage();
    openForm();
    pilihPenjualan();
    await screen.findByLabelText('Filter Kategori');
    cariProduk('pulsa');
    fireEvent.click(await screen.findByText(/Pulsa 50k/));
    fireEvent.click(screen.getByText('Simpan Transaksi'));
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    const [path, body] = mocks.post.mock.calls[0];
    expect(path).toBe('/transaksi');
    expect(body.items[0]).toMatchObject({ produk_id: 14, qty: 1 });
  });
});
