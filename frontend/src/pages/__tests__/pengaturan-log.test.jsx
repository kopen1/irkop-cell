// @vitest-environment jsdom
// PengaturanPage — tab Log / Audit: aksi "lihat raw" membuka modal JSON
// (data_before / data_after) memakai Modal & Button yang ada.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PengaturanPage from '../PengaturanPage';
import { ThemeProvider } from '../../context/ThemeContext';
import { ToastProvider } from '../../context/ToastContext';

vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn(async (path) => {
      const p = String(path);
      if (p.includes('/logs')) {
        return {
          items: [
            {
              id: 1,
              created_at: '2026-08-01T10:00:00Z',
              user_nama: 'Admin',
              aksi: 'update',
              tabel_terkait: 'settings',
              record_id: 'settings',
              data_before: { nama_website: 'A' },
              data_after: { nama_website: 'B' },
            },
            {
              id: 2,
              created_at: '2026-08-01T11:00:00Z',
              aksi: 'create',
              tabel_terkait: 'produk',
              record_id: 7,
              data_before: null,
              data_after: { kode: 'P1', nama: 'Pulsa 50k' },
            },
            { id: 3, created_at: '2026-08-01T12:00:00Z', aksi: 'delete', tabel_terkait: 'produk', record_id: 8 },
          ],
          total: 3,
        };
      }
      if (p.includes('/settings')) return { nama_website: 'Toko X', default_theme: 'classic', notifhook: {} };
      if (p.includes('/users')) return { items: [] };
      if (p.includes('/akun')) return { items: [] };
      return { items: [] };
    }),
    put: vi.fn(async () => ({})),
    post: vi.fn(async () => ({})),
  },
}));

function renderPage() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <MemoryRouter>
          <PengaturanPage />
        </MemoryRouter>
      </ToastProvider>
    </ThemeProvider>
  );
}

async function openLogTab() {
  renderPage();
  fireEvent.click(screen.getAllByRole('button', { name: /Log \/ Audit/ })[0]);
  await screen.findAllByText('settings');
}

describe('PengaturanPage — Lihat Raw (Log / Audit)', () => {
  afterEach(cleanup);

  it('record dengan data raw menampilkan tombol "lihat raw"; tanpa data raw tampil "—"', async () => {
    await openLogTab();
    const buttons = screen.getAllByRole('button', { name: 'lihat raw' });
    expect(buttons.length).toBe(2);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('klik "lihat raw" membuka modal berisi JSON data_before & data_after', async () => {
    await openLogTab();
    fireEvent.click(screen.getAllByRole('button', { name: 'lihat raw' })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(screen.getAllByText('data_before').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('data_after').length).toBeGreaterThanOrEqual(1);
    // JSON asli benar-benar dirender (nilai data)
    expect(screen.getAllByText(/nama_website/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/"A"/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/"B"/).length).toBeGreaterThanOrEqual(1);
  });

  it('modal menutup lewat tombol Tutup', async () => {
    await openLogTab();
    fireEvent.click(screen.getAllByRole('button', { name: 'lihat raw' })[1]);
    await screen.findByRole('dialog');
    fireEvent.click(screen.getAllByRole('button', { name: 'Tutup' }).pop());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});