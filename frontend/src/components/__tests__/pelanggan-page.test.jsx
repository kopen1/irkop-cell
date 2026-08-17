import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import PelangganPage from '../../pages/PelangganPage.jsx';

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock('../../lib/api', () => ({
  api: { get: (...a) => getMock(...a), post: (...a) => postMock(...a) },
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
  AuthProvider: ({ children }) => children,
}));

vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
  ToastProvider: ({ children }) => children,
}));

beforeEach(() => {
  vi.clearAllMocks();
  getMock.mockImplementation(async (path) => {
    const p = String(path);
    if (p === '/pelanggan') {
      return {
        items: [
          { id: 1, nama: 'Budi', telepon: '081234567890', total_belanja: 0, frekuensi_transaksi: 0, alias_count: 0 },
        ],
      };
    }
    if (String(p).includes('/pelanggan/')) {
      return { id: 1, nama: 'Budi', telepon: '081234567890', total_belanja: 0, frekuensi_transaksi: 0, alias: [], kasbon: [], riwayat: [] };
    }
    return {};
  });
  postMock.mockResolvedValue({ id: 2 });
});

afterEach(() => cleanup());

describe('PelangganPage Import Kontak (item 11)', () => {
  it('tombol Import Kontak disabled di environment tanpa Contacts API + ada penjelasan', async () => {
    render(<PelangganPage />);
    const btn = await screen.findByRole('button', { name: /Import Kontak/ });
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/tidak mendukung API Kontak/);
  });
});