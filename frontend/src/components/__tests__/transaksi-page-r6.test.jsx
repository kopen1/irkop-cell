import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn(async (path) => {
      const p = String(path);
      if (p.includes('/tarif')) return { admin: 5000 };
      if (p.startsWith('/transaksi')) return { items: [], total_items: 0, total_nilai: 0 };
      if (p === '/kasir/current') return { status: 'buka' };
      return {};
    }),
    post: vi.fn(async () => ({})),
    del: vi.fn(async () => ({})),
  },
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/transaksi']}>
      <TransaksiPage />
    </MemoryRouter>
  );
}

function openChooser() {
  fireEvent.click(screen.getByText('Transaksi Baru'));
}

describe('TransaksiPage R6 unified entry', () => {
  it('Transaksi Baru membuka chooser dengan 4 jenis', async () => {
    renderPage();
    openChooser();
    expect(await screen.findByText(/Pilih jenis transaksi/i)).toBeTruthy();
    expect(screen.getByText('Produk / Jasa')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Transfer' })).toBeTruthy();
    expect(screen.getByText('Top Up')).toBeTruthy();
    expect(screen.getByText('Tarik Tunai')).toBeTruthy();
  });

  it('pilih Top Up membuka R6AdminForm dengan preview', async () => {
    renderPage();
    openChooser();
    fireEvent.click(await screen.findByText('Top Up'));
    const nominal = await screen.findByPlaceholderText(/100\.000/);
    fireEvent.change(nominal, { target: { value: '100.000' } });
    await waitFor(() => expect(screen.getByText(/Preview Top Up/i)).toBeTruthy());
    expect(screen.getByText(/Simpan Top Up/i)).toBeTruthy();
  });

  it('pilih Tarik Tunai membuka R6AdminForm (admin luar default)', async () => {
    renderPage();
    openChooser();
    fireEvent.click(await screen.findByText('Tarik Tunai'));
    const nominal = await screen.findByPlaceholderText(/100\.000/);
    fireEvent.change(nominal, { target: { value: '100.000' } });
    await waitFor(() => expect(screen.getByText(/Preview Tarik Tunai/i)).toBeTruthy());
    expect(screen.getByText(/Simpan Tarik Tunai/i)).toBeTruthy();
  });

  it('pilih Transfer membuka TransaksiForm (tanpa preview R6)', async () => {
    renderPage();
    openChooser();
    fireEvent.click(await screen.findByRole('button', { name: 'Transfer' }));
    expect((await screen.findAllByText('Metode bayar')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Preview Top Up/i)).toBeNull();
    expect(screen.queryByText(/Preview Tarik Tunai/i)).toBeNull();
  });

  it('pilih Produk / Jasa membuka TransaksiForm', async () => {
    renderPage();
    openChooser();
    fireEvent.click(await screen.findByText('Produk / Jasa'));
    expect(await screen.findByText(/Cari produk/i)).toBeTruthy();
  });

  it('Batal dari form R6 kembali ke chooser', async () => {
    renderPage();
    openChooser();
    fireEvent.click(await screen.findByText('Top Up'));
    const nominal = await screen.findByPlaceholderText(/100\.000/);
    fireEvent.change(nominal, { target: { value: '100.000' } });
    await screen.findByText(/Preview Top Up/i);
    fireEvent.click(screen.getByText('Batal'));
    expect(await screen.findByText(/Pilih jenis transaksi/i)).toBeTruthy();
  });

  it('menutup modal membersihkan state createKind', async () => {
    renderPage();
    openChooser();
    fireEvent.click(await screen.findByText('Top Up'));
    await screen.findByPlaceholderText(/100\.000/);
    // close via X (onClose -> closeModal)
    fireEvent.click(screen.getByLabelText('Tutup'));
    // chooser tidak boleh langsung tampil lagi (modal tertutup)
    expect(screen.queryByText(/Pilih jenis transaksi/i)).toBeNull();
  });
});
