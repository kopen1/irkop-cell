// @vitest-environment jsdom
// Smoke test: pastikan provider + router + tema merender tanpa crash,
// dan halaman login tampil saat belum ada token.
import { describe, expect, it, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../../context/ThemeContext';
import { ToastProvider } from '../../context/ToastContext';
import { AuthProvider } from '../../context/AuthContext';
import App from '../../App';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: () => Promise.resolve(payload),
  };
}

const SITE_NAME = 'Iirkop Cell';

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

describe('App mount (smoke)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merender halaman login tanpa crash ketika belum login', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      const s = String(url);
      if (s.includes('/api/settings')) return Promise.resolve(jsonResponse({ nama_website: SITE_NAME }));
      return Promise.resolve(jsonResponse({ error: { code: 'not_found', message: 'unknown' } }, 404));
    });
    renderApp('/login');
    await screen.findByRole('button', { name: 'Masuk' });
    expect(screen.getAllByRole('heading', { name: SITE_NAME }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText(/username/i)).toBeTruthy();
    expect(screen.getByLabelText(/password/i)).toBeTruthy();
  });

  it('tema default classic terpasang di <html>', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      const s = String(url);
      if (s.includes('/api/settings')) return Promise.resolve(jsonResponse({ nama_website: SITE_NAME }));
      return Promise.resolve(jsonResponse({ error: { code: 'not_found', message: 'unknown' } }, 404));
    });
    renderApp('/login');
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('classic');
    });
  });

  it('mengarahkan ke halaman login saat akses rute tanpa autentikasi', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      const s = String(url);
      if (s.includes('/api/settings')) return Promise.resolve(jsonResponse({ nama_website: SITE_NAME }));
      return Promise.resolve(jsonResponse({ error: { code: 'not_found', message: 'unknown' } }, 404));
    });
    renderApp('/transaksi');
    const buttons = await screen.findAllByRole('button', { name: 'Masuk' });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    // Pastikan tetap mengarah ke halaman login (bukan konten transaksi)
    expect(screen.queryAllByText('Transaksi Baru').length).toBe(0);
  });
});