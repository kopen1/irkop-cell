// @vitest-environment jsdom
// Smoke Laporan: GET /api/laporan/bulan sesuai kontrak (IRKOP-T1-009)
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../../context/ThemeContext';
import { ToastProvider } from '../../context/ToastContext';
import { AuthProvider } from '../../context/AuthContext';
import App from '../../App';

function renderApp(initialPath = '/login') {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[initialPath]}>
            <App />
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: () => Promise.resolve(payload),
  };
}

const user = { id: 1, username: 'admin', role: 'admin', permissions: [] };
const report = {
  periode: 'bulanan', bulan: '2026-08',
  jumlah_transaksi: 10, omzet: 100000, laba: 20000,
  rekap_kategori: [{ kategori_id: 1, nama_kategori: 'PPOB', jumlah_item: 5, qty: 5, omzet: 60000 }],
  kasbon: { baru: 1, nominal_baru: 5000, lunas: 0, belum_lunas: 1, nominal_belum_lunas: 5000 },
  pengeluaran: { jumlah: 1, total: 5000 }, net: 15000,
  perbandingan_bulan_sebelumnya: { bulan: '2026-07', omzet: 80000, laba: 15000, pengeluaran: 3000 },
};

describe('Halaman Laporan (smoke)', () => {
  beforeEach(() => {
    localStorage.setItem('irkop_cell_token', 'test-token');
    localStorage.setItem('irkop_cell_user', JSON.stringify(user));
    global.fetch = vi.fn().mockImplementation((url) => {
      const s = String(url);
      if (s.includes('/auth/me')) return Promise.resolve(jsonResponse({ user }));
      if (s.includes('/api/settings')) return Promise.resolve(jsonResponse({ nama_website: 'Iirkop Cell' }));
      if (s.includes('/laporan/bulan')) return Promise.resolve(jsonResponse(report));
      return Promise.resolve(jsonResponse({ error: { code: 'not_found', message: 'unknown' } }, 404));
    });
  });
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('merender ringkasan laporan bulanan dari backend tanpa crash', async () => {
    renderApp('/laporan');
    await waitFor(() => {
      expect(screen.queryByText('Jumlah Transaksi')).toBeTruthy();
    }, { timeout: 3000 });
    expect(screen.getByText('Jumlah Transaksi')).toBeTruthy();
    expect(screen.getByText('Rp 100.000')).toBeTruthy();
    expect(screen.getAllByText('Rp 20.000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Rekap Kategori')).toBeTruthy();
    expect(screen.getByText('PPOB')).toBeTruthy();
    expect(screen.getByText('Net (Laba − Pengeluaran)')).toBeTruthy();
  });
});
