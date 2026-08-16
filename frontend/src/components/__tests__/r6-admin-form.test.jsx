import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import R6AdminForm from '../transaksi/R6AdminForm.jsx';

const postMock = vi.fn();
const getMock = vi.fn();

vi.mock('../../lib/api', () => ({
  api: { get: (...a) => getMock(...a), post: (...a) => postMock(...a) },
  newIdempotencyKey: () => 'test-key',
}));

beforeEach(() => {
  vi.clearAllMocks();
  getMock.mockResolvedValue({ admin: 5000 });
});
afterEach(() => cleanup());

describe('R6AdminForm', () => {
  it('Top Up: preview & submit body benar', async () => {
    postMock.mockResolvedValue({});
    render(<R6AdminForm jenis="topup" onSaved={() => {}} onCancel={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/100\.000/), { target: { value: '100.000' } });

    await waitFor(() => expect(screen.getByTestId('pv-laba').textContent).toContain('5.000'));
    expect(screen.getByTestId('pv-saldo').textContent).toContain('100.000');
    expect(screen.getByTestId('pv-saldo').textContent).toContain('-');
    expect(screen.getByTestId('pv-laci').textContent).toContain('105.000');

    fireEvent.click(screen.getByText(/Simpan Top Up/));
    await waitFor(() => expect(postMock).toHaveBeenCalled());
    const body = postMock.mock.calls[0][1];
    expect(body).toMatchObject({ jenis: 'topup', nominal: 100000, mitra: 'DANA' });
    expect(body.admin_type).toBeUndefined();
  });

  it('Tarik Tunai luar: preview berbeda dengan dalam', async () => {
    postMock.mockResolvedValue({});
    render(<R6AdminForm jenis="tariktunai" onSaved={() => {}} onCancel={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/100\.000/), { target: { value: '100.000' } });
    await waitFor(() => expect(screen.getByTestId('pv-laba').textContent).toContain('5.000'));
    expect(screen.getByTestId('pv-saldo').textContent).toContain('100.000');
    expect(screen.getByTestId('pv-laci').textContent).toContain('95.000');

    fireEvent.click(screen.getByText(/Simpan Tarik Tunai/));
    await waitFor(() => expect(postMock).toHaveBeenCalled());
    expect(postMock.mock.calls[0][1]).toMatchObject({ jenis: 'tariktunai', admin_type: 'luar', nominal: 100000 });
  });

  it('menolak submit bila tarif gagal', async () => {
    getMock.mockRejectedValue(new Error('Tidak ada tarif'));
    render(<R6AdminForm jenis="topup" onSaved={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/100\.000/), { target: { value: '5.000' } });
    await waitFor(() => expect(screen.getByText('Tidak ada tarif')).toBeTruthy());
    fireEvent.click(screen.getByText(/Simpan Top Up/));
    await waitFor(() => expect(postMock).not.toHaveBeenCalled());
  });
});
