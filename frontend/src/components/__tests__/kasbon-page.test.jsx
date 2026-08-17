import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import KasbonPage from '../../pages/KasbonPage.jsx';

const getMock = vi.fn();
const postMock = vi.fn();
const putMock = vi.fn();

vi.mock('../../lib/api', () => ({
  api: { get: (...a) => getMock(...a), post: (...a) => postMock(...a), put: (...a) => putMock(...a) },
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

const kasbonItems = [
  { id: 1, pelanggan_id: 10, pelanggan_nama: 'Budi', nominal: 100000, terbayar: 40000, status: 'belum_lunas', tanggal: '2026-08-10', jatuh_tempo: null },
  { id: 2, pelanggan_id: 10, pelanggan_nama: 'Budi', nominal: 50000, terbayar: 0, status: 'belum_lunas', tanggal: '2026-08-11', jatuh_tempo: null },
  { id: 3, pelanggan_id: 11, pelanggan_nama: 'Siti', nominal: 75000, terbayar: 75000, status: 'lunas', tanggal: '2026-08-09', jatuh_tempo: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  getMock.mockImplementation(async (path) => {
    const p = String(path);
    if (p === '/kasbon') return { items: kasbonItems };
    if (p === '/akun') return { items: [{ id: 1, nama_akun: 'Tunai Laci', tipe: 'tunai' }] };
    return {};
  });
  postMock.mockResolvedValue({});
  putMock.mockResolvedValue({});
});

afterEach(() => cleanup());

describe('KasbonPage grouping & pembayaran (item 9 & 10)', () => {
  it('mengelompokkan bon per pelanggan; bons tertutup sampai nama pelanggan diklik', async () => {
    render(<KasbonPage />);
    expect(await screen.findByText('Budi')).toBeTruthy();
    expect(screen.getByText('Siti')).toBeTruthy();
    expect(screen.queryByText('Total bon')).toBeNull();

    fireEvent.click(screen.getByText('Budi'));
    expect(screen.getByText('Total bon')).toBeTruthy();
    expect(screen.getByLabelText('Bayar kasbon 1')).toBeTruthy();
    expect(screen.getByLabelText('Bayar kasbon 2')).toBeTruthy();
    expect(screen.getByText('Siti')).toBeTruthy();

    fireEvent.click(screen.getByText('Budi'));
    expect(screen.queryByText('Total bon')).toBeNull();
  });

  it('menampilkan Total bon / Bayar / Sisa per bon dan klik nama lain membuka grup sendiri', async () => {
    render(<KasbonPage />);
    fireEvent.click(await screen.findByText('Budi'));
    expect(screen.getByText('Total bon')).toBeTruthy();
    expect(screen.getAllByText('Bayar').length).toBeGreaterThan(0);
    expect(screen.getByText('Sisa')).toBeTruthy();

    fireEvent.click(screen.getByText('Siti'));
    expect(screen.getAllByText('Total bon').length).toBe(2);
  });

  it('pembayaran sebagian: input Bayar + POST /kasbon/:id/payment', async () => {
    render(<KasbonPage />);
    fireEvent.click(await screen.findByText('Budi'));

    const input = screen.getByLabelText('Bayar kasbon 1');
    fireEvent.change(input, { target: { value: '10.000' } });
    const row = input.closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: 'Bayar' }));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    const [path, body] = postMock.mock.calls[0];
    expect(path).toBe('/kasbon/1/payment');
    expect(body).toMatchObject({ nominal: 10000, metode: 'tunai', akun_id: 'Tunai Laci' });
  });

  it('validasi: bayar melebihi sisa membuat tombol Bayar disabled', async () => {
    render(<KasbonPage />);
    fireEvent.click(await screen.findByText('Budi'));

    const input = screen.getByLabelText('Bayar kasbon 1'); // sisa 60.000
    fireEvent.change(input, { target: { value: '61.000' } });
    const row = input.closest('tr');
    const bayarBtn = within(row).getByRole('button', { name: 'Bayar' });
    expect(bayarBtn.disabled).toBe(true);
  });

  it('validasi: input kosong = tombol Bayar disabled (tidak ada pembayaran tercatat)', async () => {
    render(<KasbonPage />);
    fireEvent.click(await screen.findByText('Budi'));
    const input = screen.getByLabelText('Bayar kasbon 1');
    const row = input.closest('tr');
    const bayarBtn = within(row).getByRole('button', { name: 'Bayar' });
    expect(bayarBtn.disabled).toBe(true);
  });

  it('bon lunas tidak menawarkan pembayaran (tanpa tombol Bayar)', async () => {
    render(<KasbonPage />);
    fireEvent.click(await screen.findByText('Siti'));
    expect(screen.getByText('Total bon')).toBeTruthy();
    expect(screen.queryByLabelText('Bayar kasbon 3')).toBeNull();
  });
});