import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({
  get: vi.fn(async () => ({ transaksi: {} })),
  put: vi.fn(async () => ({})),
}));

vi.mock('../../lib/api', () => ({
  api: { get: mocks.get, put: mocks.put },
}));
vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ toast: { success() {}, error() {} } }),
  ToastProvider: ({ children }) => children,
}));
vi.mock('../../hooks/useSiteName', () => ({
  useSiteName: () => 'Iirkop Cell',
  useStrukTemplate: () => ({}),
  refreshSettings: async () => ({}),
}));

import { TransaksiDetail } from '../transaksi/TransaksiDetail';

afterEach(cleanup);
beforeEach(() => {
  mocks.get.mockClear();
  mocks.put.mockClear();
});

function baseTransaksi(overrides) {
  return {
    id: 'TX-1',
    metode_bayar: 'transfer',
    konfirmasi_pembayaran: 'menunggu',
    created_at: '2026-08-17T04:00:00.000Z',
    items: [],
    total: 105000,
    mutasi_saldo: [],
    ...overrides,
  };
}

describe('TransaksiDetail — ubah status konfirmasi via dropdown', () => {
  it('transaksi transfer menampilkan dropdown 4 status; menyimpan via PUT /konfirmasi', async () => {
    render(<TransaksiDetail transaksi={baseTransaksi()} />);
    const select = await screen.findByLabelText('Status konfirmasi pembayaran');
    expect(select.value).toBe('menunggu');
    expect([...select.options].map((o) => o.value)).toEqual(['tidak_perlu', 'menunggu', 'otomatis', 'manual']);
    fireEvent.change(select, { target: { value: 'manual' } });
    fireEvent.click(screen.getByText('Simpan'));
    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith('/transaksi/TX-1/konfirmasi', { konfirmasi_pembayaran: 'manual' })
    );
  });

  it('transaksi admin Transfer (jenis transfer, metode cash_tunai) menampilkan dropdown konfirmasi', async () => {
    render(
      <TransaksiDetail
        transaksi={baseTransaksi({
          id: 'TX-4',
          metode_bayar: 'cash_tunai',
          konfirmasi_pembayaran: 'tidak_perlu',
          jenis: 'transfer',
          items: [],
        })}
      />
    );
    const select = await screen.findByLabelText('Status konfirmasi pembayaran');
    fireEvent.change(select, { target: { value: 'menunggu' } });
    fireEvent.click(screen.getByText('Simpan'));
    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith('/transaksi/TX-4/konfirmasi', { konfirmasi_pembayaran: 'menunggu' })
    );
  });

  it('transaksi admin Tarik Tunai (jenis tariktunai) menampilkan dropdown konfirmasi', async () => {
    render(
      <TransaksiDetail
        transaksi={baseTransaksi({
          id: 'TX-5',
          metode_bayar: 'cash_tunai',
          konfirmasi_pembayaran: 'tidak_perlu',
          jenis: 'tariktunai',
          items: [],
        })}
      />
    );
    expect(await screen.findByLabelText('Status konfirmasi pembayaran')).toBeTruthy();
  });

  it('transaksi non-transfer tidak menampilkan dropdown konfirmasi', () => {
    render(<TransaksiDetail transaksi={baseTransaksi({ id: 'TX-2', metode_bayar: 'tunai', konfirmasi_pembayaran: 'tidak_perlu' })} />);
    expect(screen.queryByLabelText('Status konfirmasi pembayaran')).toBeNull();
  });

  it('transaksi kirim uang (item nominal_referensi, metode tunai) menampilkan dropdown konfirmasi', async () => {
    render(
      <TransaksiDetail
        transaksi={baseTransaksi({
          id: 'TX-3',
          metode_bayar: 'tunai',
          konfirmasi_pembayaran: 'tidak_perlu',
          items: [{ id: 1, produk_id: 5, nama_produk_snapshot: 'Transfer Bank', harga_snapshot: 5000, qty: 1, subtotal: 5000, nominal_referensi: 500000, akun_sumber: 'DANA' }],
        })}
      />
    );
    const select = await screen.findByLabelText('Status konfirmasi pembayaran');
    expect(select.value).toBe('tidak_perlu');
    fireEvent.change(select, { target: { value: 'menunggu' } });
    fireEvent.click(screen.getByText('Simpan'));
    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith('/transaksi/TX-3/konfirmasi', { konfirmasi_pembayaran: 'menunggu' })
    );
  });
});