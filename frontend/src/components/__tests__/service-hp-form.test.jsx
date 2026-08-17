import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ServiceHpForm from '../service/ServiceHpForm.jsx';

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock('../../lib/api', () => ({
  api: { get: (...a) => getMock(...a), post: (...a) => postMock(...a) },
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ isAdmin: false }),
  AuthProvider: ({ children }) => children,
}));

beforeEach(() => {
  vi.clearAllMocks();
  getMock.mockResolvedValue({ items: [] });
  postMock.mockResolvedValue({ id: 1 });
});

afterEach(() => cleanup());

describe('ServiceHpForm (reusable, item 7)', () => {
  it('menampilkan field Harga Modal opsional', async () => {
    render(<ServiceHpForm onCancel={() => {}} onSaved={() => {}} />);
    expect(await screen.findByLabelText(/Harga modal/)).toBeTruthy();
    expect(screen.getByLabelText(/Nama device/)).toBeTruthy();
  });

  it('submit POST /service-hp dengan harga_modal terisi', async () => {
    const onSaved = vi.fn();
    render(<ServiceHpForm onCancel={() => {}} onSaved={onSaved} />);
    await screen.findByLabelText(/Nama device/);
    fireEvent.change(screen.getByLabelText(/Nama device/), { target: { value: 'iPhone 12' } });
    fireEvent.change(screen.getByLabelText(/Deskripsi kerusakan/), { target: { value: 'Ganti panel' } });
    fireEvent.change(screen.getByLabelText(/Harga modal/), { target: { value: '150.000' } });
    fireEvent.click(screen.getByText('Simpan'));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    expect(postMock.mock.calls[0][0]).toBe('/service-hp');
    expect(postMock.mock.calls[0][1]).toMatchObject({
      nama_device: 'iPhone 12',
      deskripsi_kerusakan: 'Ganti panel',
      harga_modal: 150000,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('harga_modal kosong dikirim null (bukan 0)', async () => {
    const onSaved = vi.fn();
    render(<ServiceHpForm onCancel={() => {}} onSaved={onSaved} />);
    await screen.findByLabelText(/Nama device/);
    fireEvent.change(screen.getByLabelText(/Nama device/), { target: { value: 'Xiaomi' } });
    fireEvent.change(screen.getByLabelText(/Deskripsi kerusakan/), { target: { value: 'Baterai' } });
    fireEvent.click(screen.getByText('Simpan'));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    expect(postMock.mock.calls[0][1].harga_modal).toBeNull();
  });

  it('validasi wajib: nama device & deskripsi harus diisi', async () => {
    render(<ServiceHpForm onCancel={() => {}} onSaved={() => {}} />);
    await screen.findByLabelText(/Nama device/);
    fireEvent.click(screen.getByText('Simpan'));
    expect(screen.getByText('Nama device wajib diisi.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Nama device/), { target: { value: 'iPhone' } });
    fireEvent.click(screen.getByText('Simpan'));
    expect(screen.getByText('Deskripsi kerusakan wajib diisi.')).toBeTruthy();
    expect(postMock).not.toHaveBeenCalled();
  });
});