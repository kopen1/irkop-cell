// @vitest-environment jsdom
// Smoke test: pastikan provider + router + tema merender tanpa crash,
// dan halaman login tampil saat belum ada token.
import { describe, expect, it } from 'vitest';
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

describe('App mount (smoke)', () => {
  it('merender halaman login tanpa crash ketika belum login', async () => {
    renderApp('/login');
    await screen.findByRole('button', { name: 'Masuk' });
    expect(screen.getAllByRole('heading', { name: 'Iirkop Cell' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText(/username/i)).toBeTruthy();
    expect(screen.getByLabelText(/password/i)).toBeTruthy();
  });

  it('tema default classic terpasang di <html>', async () => {
    renderApp('/login');
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('classic');
    });
  });

  it('mengarahkan ke halaman login saat akses rute tanpa autentikasi', async () => {
    renderApp('/transaksi');
    const buttons = await screen.findAllByRole('button', { name: 'Masuk' });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    // Pastikan tetap mengarah ke halaman login (bukan konten transaksi)
    expect(screen.queryAllByText('Transaksi Baru').length).toBe(0);
  });
});