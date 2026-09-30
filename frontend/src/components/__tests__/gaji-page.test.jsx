// @vitest-environment jsdom
// Smoke GajiPage + RateModal.
//
// Menangkap 2 bug:
//  1) FE mengirim `harian`, backend baca `custom_harian` -> custom per hari
//     selalu gagal disimpan (400)
//  2) rate custom yang sudah tersimpan tidak dimuat ulang ke form -> input kosong
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
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
const adminPages = { pages: ['gaji_karyawan', 'pengaturan', 'kasir', 'transaksi'] };

const users = {
  items: [
    { id: 1, nama: 'Admin', role: 'admin' },
    { id: 2, nama: 'Karyawan 1', role: 'karyawan' },
  ],
};

// Karyawan 1 punya rate custom_harian: selasa/kamis/jumat 40rb, lain 60rb
const rates = {
  items: [
    {
      id: 1,
      user_id: 2,
      nama_karyawan: 'Karyawan 1',
      tipe: 'custom_harian',
      rate_flat: null,
      custom_harian: 'jumat:40000,kamis:40000,minggu:60000,rabu:60000,sabtu:60000,selasa:40000,senin:60000',
    },
  ],
};

const gajiHarian = {
  items: [
    { id: 1, user_id: 2, nama_karyawan: 'Karyawan 1', tanggal: '2026-09-17', nominal: 40000, sumber: 'auto', catatan: '[auto] rate kamis' },
    { id: 2, user_id: 2, nama_karyawan: 'Karyawan 1', tanggal: '2026-09-16', nominal: 60000, sumber: 'auto', catatan: '[auto] rate rabu' },
  ],
};
const unpaid = { items: [{ user_id: 2, nama: 'Karyawan 1', jumlah_hari: 2, total: 100000, dari_tanggal: '2026-09-16', sampai_tanggal: '2026-09-17' }] };

let postCalls = [];

function mockFetch() {
  global.fetch = vi.fn().mockImplementation((url, opts) => {
    const s = String(url);
    const method = opts?.method || 'GET';
    if (method === 'POST') {
      postCalls.push({ path: s, body: JSON.parse(opts.body || '{}') });
    }
    if (s.includes('/auth/me')) return Promise.resolve(jsonResponse({ user: admin }));
    if (s.includes('/auth/halaman')) return Promise.resolve(jsonResponse(adminPages));
    if (s.includes('/gaji/rate')) {
      if (method === 'POST') return Promise.resolve(jsonResponse({ user_id: 2, message: 'Rate gaji disimpan' }));
      return Promise.resolve(jsonResponse(rates));
    }
    if (s.includes('/gaji/unpaid')) return Promise.resolve(jsonResponse(unpaid));
    if (s.includes('/gaji')) return Promise.resolve(jsonResponse(gajiHarian));
    if (s.includes('/users')) return Promise.resolve(jsonResponse(users));
    return Promise.resolve(jsonResponse({ items: [] }));
  });
}

function renderApp() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={['/gaji']}>
            <App />
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

describe('GajiPage — Atur Rate (custom per hari)', () => {
  beforeEach(() => {
    localStorage.setItem('irkop_cell_token', 'test-token');
    localStorage.setItem('irkop_cell_user', JSON.stringify(admin));
    postCalls = [];
    mockFetch();
  });
  afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

  it('halaman gaji memuat daftar gaji harian', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Atur Rate/i })).toBeTruthy();
    }, { timeout: 8000 });
  });

  it('buka Atur Rate -> rate custom yang tersimpan TERMUAT di 7 input hari', async () => {
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /Atur Rate/i }, { timeout: 8000 }));

    const select = await screen.findByLabelText('Karyawan', {}, { timeout: 8000 });
    fireEvent.change(select, { target: { value: '2' } });

    // Tipe harus custom_harian (dari rate tersimpan)
    await waitFor(() => {
      expect(screen.getByLabelText('Tipe rate').value).toBe('custom_harian');
    }, { timeout: 8000 });

    // 7 input hari harus terisi dari custom_harian
    const inputs = screen.getAllByRole('textbox').filter((el) => /^\d+$/.test(el.value.replace(/\D/g, '')));
    await waitFor(() => {
      const vals = screen.getAllByRole('textbox').map((el) => el.value).filter((v) => v.trim() !== '');
      // ada nilai 60000 dan 40000 yang termuat
      expect(vals.some((v) => v.replace(/\D/g, '') === '60000')).toBe(true);
      expect(vals.some((v) => v.replace(/\D/g, '') === '40000')).toBe(true);
    }, { timeout: 8000 });
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('simpan custom per hari mengirim field custom_harian (bukan "harian")', async () => {
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /Atur Rate/i }, { timeout: 8000 }));

    const select = await screen.findByLabelText('Karyawan', {}, { timeout: 8000 });
    fireEvent.change(select, { target: { value: '2' } });
    await waitFor(() => {
      expect(screen.getByLabelText('Tipe rate').value).toBe('custom_harian');
    }, { timeout: 8000 });

    // Tombol di modal Atur Rate namanya "Simpan Rate" (ada "Simpan" lain di kartu Bagi Hasil).
    const dialog = screen.getByRole('dialog');
    const simpan = within(dialog).getByRole('button', { name: /simpan rate/i });
    fireEvent.click(simpan);

    await waitFor(() => {
      const call = postCalls.find((c) => c.path.includes('/gaji/rate'));
      expect(call, 'harus memanggil POST /gaji/rate').toBeTruthy();
      // INI yang dulu salah: field bernama "harian" -> backend 400
      expect(call.body.custom_harian, 'field harus custom_harian').toBeTruthy();
      expect(call.body.harian, 'field "harian" tidak boleh dikirim').toBeUndefined();
      expect(call.body.custom_harian).toHaveLength(7);
    }, { timeout: 8000 });
  });
});
