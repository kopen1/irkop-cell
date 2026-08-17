import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const mocks = vi.hoisted(() => ({
  get: vi.fn(async (path) => {
    const p = String(path);
    if (p === '/produk') {
      return {
        items: [
          { id: 11, kode: 'TF-1', nama: 'Transfer Bank (Semua Bank)', kategori_id: 5, harga: 5000, stok: 0, deleted_at: null },
          { id: 12, kode: 'TT-1', nama: 'Tarik Tunai', kategori_id: 5, harga: 5000, stok: 0, deleted_at: null },
          { id: 13, kode: 'SV-1', nama: 'Service HP', kategori_id: 5, harga: 150000, stok: 0, deleted_at: null },
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
          { id: 4, nama_akun: 'OrderKuota', tipe: 'digital' },
        ],
      };
    }
    if (p === '/pelanggan') return { items: [] };
    if (p.startsWith('/transaksi')) return { items: [], total_items: 0, total_nilai: 0 };
    if (p === '/kasir/current') return { status: 'buka' };
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

function formDialog() {
  return screen.getByRole('dialog', { name: 'Transaksi Baru' });
}

function formMetodeBayar() {
  return within(formDialog()).getByLabelText(/^Metode bayar/);
}

function pickProduk(nama) {
  fireEvent.change(screen.getByLabelText('Cari produk (kode / nama)'), { target: { value: nama.toLowerCase() } });
}

function pickAkunSumber(value) {
  const selects = screen.getAllByRole('combobox');
  const s = selects.find((el) => [...el.options].some((o) => o.textContent === 'Pilih akun…'));
  fireEvent.change(s, { target: { value } });
}

describe('TransaksiPage satu jalur Produk/Jasa (R6 unified entry, tanpa Top Up)', () => {
  it('Transaksi Baru membuka SATU form gabungan (TransaksiForm) tanpa Top Up', async () => {
    renderPage();
    openForm();
    expect(await screen.findByLabelText('Filter Kategori')).toBeTruthy();
    expect(screen.queryByText(/Top Up/i)).toBeNull();
    expect(screen.getByText(/Cari produk/i)).toBeTruthy();
    expect(formMetodeBayar()).toBeTruthy();
    expect(within(formDialog()).getByLabelText(/^Pelanggan \(opsional\)/)).toBeTruthy();
  });

  it('produk jasa Kirim Uang: pilih produk Transfer, isi nominal + akun sumber, simpan', async () => {
    renderPage();
    openForm();
    await screen.findByLabelText('Filter Kategori');
    pickProduk('Transfer');
    const hasil = await screen.findByText(/Transfer Bank \(Semua Bank\)/);
    fireEvent.click(hasil);
    fireEvent.click(screen.getByLabelText('Produk jasa Kirim Uang (isi nominal yang ditransfer)'));
    fireEvent.change(screen.getByPlaceholderText(/500\.000/), { target: { value: '500.000' } });
    pickAkunSumber('SeaBank');
    fireEvent.click(screen.getByText('Simpan Transaksi'));
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    const body = mocks.post.mock.calls[0][1];
    expect(body.items[0]).toMatchObject({ nominal_referensi: 500000, akun_sumber: 'SeaBank' });
  });

  it('Metode bayar Transfer menampilkan akun penerima dari akun_master', async () => {
    renderPage();
    openForm();
    await screen.findByLabelText('Filter Kategori');
    fireEvent.change(formMetodeBayar(), { target: { value: 'transfer' } });
    expect(await within(formDialog()).findByLabelText(/^Akun penerima/)).toBeTruthy();
    expect(screen.getAllByRole('option', { name: 'SeaBank' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('option', { name: 'DANA' }).length).toBeGreaterThan(0);
  });

  it('Filter Kategori menyaring produk pada pencarian', async () => {
    renderPage();
    openForm();
    await screen.findByLabelText('Filter Kategori');
    fireEvent.change(screen.getByLabelText('Filter Kategori'), { target: { value: '6' } });
    pickProduk('pulsa');
    const hasil = await screen.findByText(/Pulsa 50k/);
    fireEvent.click(hasil);
    expect(screen.getAllByText(/Pulsa 50k/).length).toBeGreaterThan(0);
  });

  it('pilih Filter Kategori langsung menampilkan produk kategori itu (tanpa mengetik)', async () => {
    renderPage();
    openForm();
    await screen.findByLabelText('Filter Kategori');
    fireEvent.change(screen.getByLabelText('Filter Kategori'), { target: { value: '5' } });
    expect(await screen.findByText(/Transfer Bank \(Semua Bank\)/)).toBeTruthy();
    expect(screen.getByText(/Tarik Tunai/)).toBeTruthy();
    expect(screen.getByText(/Service HP/)).toBeTruthy();
    expect(screen.queryByText(/Pulsa 50k/)).toBeNull();
  });

  it('Batal menutup modal', async () => {
    renderPage();
    openForm();
    await screen.findByLabelText('Filter Kategori');
    fireEvent.click(screen.getByText('Batal'));
    expect(screen.queryByLabelText('Filter Kategori')).toBeNull();
  });

  it('menutup modal membersihkan state form (modal tidak langsung terbuka lagi)', async () => {
    renderPage();
    openForm();
    await screen.findByLabelText('Filter Kategori');
    fireEvent.click(screen.getByLabelText('Tutup'));
    expect(screen.queryByLabelText('Filter Kategori')).toBeNull();
  });
});