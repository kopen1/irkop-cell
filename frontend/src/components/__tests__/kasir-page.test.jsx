// @vitest-environment jsdom
// Smoke KasirPage: reminder sesi lampau + tombol Edit → koreksi saldo_real
// & catatan → POST /kasir/closing dengan kasir_sesi_id (tanpa mutasi baru).
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
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

const currentToday = {
  tanggal: '2026-08-17', kasir_sesi_id: 2, status: 'buka',
  dibuka_oleh: 1, dibuka_at: '2026-08-17T00:00:00Z', ditutup_oleh: null, ditutup_at: null,
  catatan_closing: null,
  saldo: [{ nama_akun: 'Tunai Laci', saldo_opening: 500000, mutasi: 0, saldo_sistem: 500000 }],
  closing: [],
};
const currentPast = {
  tanggal: '2026-08-16', kasir_sesi_id: 1, status: 'buka',
  dibuka_oleh: 1, dibuka_at: '2026-08-16T00:00:00Z', ditutup_oleh: null, ditutup_at: null,
  catatan_closing: null,
  saldo: [{ nama_akun: 'Tunai Laci', saldo_opening: 400000, mutasi: 100000, saldo_sistem: 500000 }],
  closing: [],
};
const reminder = {
  tanggal: '2026-08-17', perlu_diingatkan: true,
  sesi_buka_lampau: [{ kasir_sesi_id: 1, tanggal: '2026-08-16', dibuka_at: '2026-08-16T00:00:00Z', dibuka_oleh: 'Admin' }],
};
const akun = { items: [] };

describe('Halaman Kasir — Edit sesi lampau (smoke)', () => {
  beforeEach(() => {
    localStorage.setItem('irkop_cell_token', 'test-token');
    localStorage.setItem('irkop_cell_user', JSON.stringify(user));
  });
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('reminder menampilkan sesi lampau dengan tombol Edit', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      const s = String(url);
      if (s.includes('/auth/me')) return Promise.resolve(jsonResponse({ user }));
      if (s.includes('/kasir/current')) return Promise.resolve(jsonResponse(currentToday));
      if (s.includes('/akun')) return Promise.resolve(jsonResponse(akun));
      if (s.includes('/kasir/reminder-closing')) return Promise.resolve(jsonResponse(reminder));
      return Promise.resolve(jsonResponse({ error: { code: 'not_found', message: 'unknown' } }, 404));
    });

    renderApp('/kasir');
    await waitFor(() => {
      expect(screen.getByText('Perlu Closing — Ada Sesi Lampau')).toBeTruthy();
    }, { timeout: 8000 });
    expect(screen.getByText('2026-08-16')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /edit/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('klik Edit membuka modal; simpan mengirim POST /kasir/closing dengan kasir_sesi_id', async () => {
    const posts = [];
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      const s = String(url);
      const method = opts?.method || 'GET';
      if (method === 'POST' && s.includes('/kasir/closing')) {
        posts.push(JSON.parse(opts.body));
      }
      if (s.includes('/auth/me')) return Promise.resolve(jsonResponse({ user }));
      if (s.includes('/kasir/current')) {
        if (s.includes('kasir_sesi_id=1')) return Promise.resolve(jsonResponse(currentPast));
        return Promise.resolve(jsonResponse(currentToday));
      }
      if (s.includes('/akun')) return Promise.resolve(jsonResponse(akun));
      if (s.includes('/kasir/reminder-closing')) return Promise.resolve(jsonResponse(reminder));
      if (s.includes('/kasir/closing')) return Promise.resolve(jsonResponse({ ok: true }));
      return Promise.resolve(jsonResponse({ error: { code: 'not_found', message: 'unknown' } }, 404));
    });

    renderApp('/kasir');
    const editBtn = await screen.findAllByRole('button', { name: /edit/i }, { timeout: 8000 });
    fireEvent.click(editBtn[0]);

    const modal = await waitFor(() => document.querySelector('.modal'), { timeout: 8000 });
    expect(modal).toBeTruthy();

    await waitFor(() => {
      expect(within(modal).getByLabelText('Saldo real (Rp)')).toBeTruthy();
    }, { timeout: 8000 });

    const saldoInput = within(modal).getByLabelText('Saldo real (Rp)');
    expect(saldoInput.value).toBe('500000');

    const saveBtn = within(modal).getByRole('button', { name: /simpan & closing/i });
    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(posts.length).toBe(1);
    }, { timeout: 3000 });
    expect(posts[0].kasir_sesi_id).toBe(1);
    expect(posts[0].saldo_real).toEqual([{ nama_akun: 'Tunai Laci', saldo_real: 500000 }]);
  });
});
