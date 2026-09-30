// @vitest-environment jsdom
// Smoke HargaServerPage: halaman harus ter-render tanpa error.
// Menangkap regresi blank page (mis. akses state null saat render).
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../../context/ThemeContext';
import { ToastProvider } from '../../context/ToastContext';
import { AuthProvider } from '../../context/AuthContext';
import App from '../../App';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: () => Promise.resolve(payload),
  };
}

const admin = { id: 1, username: 'admin', role: 'admin', permissions: [] };
const adminPages = { pages: ['harga_server', 'pengaturan', 'daftar_barang', 'transaksi', 'kasir'] };

const perbandingan = {
  items: [
    {
      kode_produk: 'Vindosat00301', nama_produk: 'Act Freedom Mini 3GB 1 Hari', kategori: 'cetak_voucher',
      harga_server: 6900, biaya: 500, harga_server_efektif: 7400,
      kode_lokal: 'vi03', nama_produk_daftar: 'Indosat Freedom Mini 3GB 1Hari',
      modal_daftar: 7400, harga_jual_daftar: 9400, status: 'naik', selisih: 1200,
    },
    {
      kode_produk: 'Vindosat0507', nama_produk: 'Act Freedom Mini 5GB 7 Hari', kategori: 'cetak_voucher',
      harga_server: 15500, biaya: 500, harga_server_efektif: 16000,
      kode_lokal: null, nama_produk_daftar: null,
      modal_daftar: null, harga_jual_daftar: null, status: 'baru', selisih: 16000,
    },
  ],
  summary: { naik: 1, turun: 0, sama: 0, baru: 1 },
};

function mockFetch() {
  global.fetch = vi.fn().mockImplementation((url) => {
    const s = String(url);
    if (s.includes('/auth/me')) return Promise.resolve(jsonResponse({ user: admin }));
    if (s.includes('/auth/halaman')) return Promise.resolve(jsonResponse(adminPages));
    if (s.includes('/harga-server/perbandingan')) return Promise.resolve(jsonResponse(perbandingan));
    if (s.includes('/harga-server/ringkasan')) return Promise.resolve(jsonResponse({ items: [] }));
    if (s.includes('/harga-server/log')) return Promise.resolve(jsonResponse({ items: [] }));
    if (s.includes('/harga-server')) return Promise.resolve(jsonResponse({ items: [], summary: { naik: 1, turun: 0, sama: 0, baru: 1 } }));
    if (s.includes('/kategori')) return Promise.resolve(jsonResponse({ items: [] }));
    return Promise.resolve(jsonResponse({ items: [] }));
  });
}

describe('Halaman Harga Server — smoke render', () => {
  beforeEach(() => {
    localStorage.setItem('irkop_cell_token', 'test-token');
    localStorage.setItem('irkop_cell_user', JSON.stringify(admin));
    mockFetch();
  });
  afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

  it('halaman render tanpa error (tidak blank)', async () => {
    render(
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={['/harga-server']}>
              <App />
            </MemoryRouter>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    );
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Terapkan/i }).length).toBeGreaterThan(0);
    }, { timeout: 8000 });
    expect(screen.getByText(/Vindosat00301/i)).toBeTruthy();
  });

  it('kolom pencarian ada dan bisa disaring', async () => {
    render(
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={['/harga-server']}>
              <App />
            </MemoryRouter>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    );
    const input = await screen.findByPlaceholderText(/Kode\/nama di server atau produk lokal/i, {}, { timeout: 8000 });
    expect(input).toBeTruthy();
    // Baris data muncul setelah request perbandingan selesai.
    await waitFor(() => {
      expect(screen.getByText(/Vindosat00301/i)).toBeTruthy();
    }, { timeout: 8000 });

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(input, { target: { value: 'vi03' } });
    await waitFor(() => {
      expect(screen.getByText(/Indosat Freedom Mini 3GB 1Hari/i)).toBeTruthy();
    }, { timeout: 8000 });
    // Baris yang tidak cocok hilang
    expect(screen.queryByText(/Vindosat0507/i)).toBeNull();
  });
});
