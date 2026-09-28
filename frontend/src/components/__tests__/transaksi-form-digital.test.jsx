import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import TransaksiForm from '../transaksi/TransaksiForm.jsx';

const getMock = vi.fn();

vi.mock('../../lib/api', () => ({
  api: { get: (...a) => getMock(...a) },
  newIdempotencyKey: () => 'test-key',
}));

const produk = {
  items: [
    { id: 1, kode: 'D10', nama: 'Dana 10.000', harga: 12000, harga_modal: 10000, kategori_id: 2, deleted_at: null },
    { id: 2, kode: 'S10', nama: 'Telkomsel 10.000', harga: 11000, harga_modal: 10500, kategori_id: 2, deleted_at: null },
    { id: 3, kode: 'B10', nama: 'Tf 10k', harga: 10000, harga_modal: 10000, kategori_id: 2, deleted_at: null },
  ],
};
const kategori = { items: [{ id: 2, nama: 'Saldo', lacak_stok: 0 }] };
const akun = {
  items: [
    { nama_akun: 'Tunai Laci', tipe: 'tunai' },
    { nama_akun: 'SeaBank', tipe: 'bank' },
    { nama_akun: 'DANA', tipe: 'e_wallet' },
    { nama_akun: 'OrderKuota', tipe: 'digital' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  getMock.mockImplementation(async (path) => {
    if (path === '/produk') return produk;
    if (path === '/kategori') return kategori;
    if (path === '/akun') return akun;
    if (path === '/pelanggan') return { items: [] };
    if (path === '/kasir/current') return { status: 'buka', saldo: [] };
    return { items: [] };
  });
});
afterEach(cleanup);

function setJenisDigital() {
  fireEvent.change(screen.getByLabelText(/jenis transaksi/i), { target: { value: 'produkdigital' } });
}
function search(q) {
  fireEvent.change(screen.getByPlaceholderText('Ketik kode/nama...'), { target: { value: q } });
}
function pilihProdukDigital(nama) {
  search(nama);
  return waitFor(() => {
    const btn = screen.getAllByRole('button').find((b) => b.textContent.includes(nama));
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
  });
}
// formatRupiah memakai non-breaking space (U+00A0) -> normalkan sebelum dibandingkan.
function nomorLaba() {
  return Array.from(document.querySelectorAll('.num')).map((e) => e.textContent.replace(/\u00a0/g, ' ').trim());
}

describe('TransaksiForm — akun sumber otomatis mengikuti produk digital', () => {
  it('pilih "Dana 10.000" → sub jenis dana + akun DANA', async () => {
    render(<TransaksiForm onSaved={() => {}} onCancel={() => {}} />);
    setJenisDigital();
    await pilihProdukDigital('Dana 10.000');

    await waitFor(() => {
      const sub = screen.getByLabelText(/sub jenis/i);
      expect(sub.value).toBe('dana');
    });
    const select = screen.getByLabelText(/akun bank toko \(sumber modal\)/i);
    expect(select.value).toBe('DANA');
  });

  it('pilih pulsa "Telkomsel 10.000" → akun OrderKuota', async () => {
    render(<TransaksiForm onSaved={() => {}} onCancel={() => {}} />);
    setJenisDigital();
    await pilihProdukDigital('Telkomsel 10.000');
    await waitFor(() => {
      expect(screen.getByLabelText(/sub jenis/i).value).toBe('pulsa');
    });
    expect(screen.getByLabelText(/akun bank toko \(sumber modal\)/i).value).toBe('OrderKuota');
  });

  it('pilih transfer "Tf 10k" → akun SeaBank', async () => {
    render(<TransaksiForm onSaved={() => {}} onCancel={() => {}} />);
    setJenisDigital();
    await pilihProdukDigital('Tf 10k');
    await waitFor(() => {
      expect(screen.getByLabelText(/sub jenis/i).value).toBe('transfer');
    });
    expect(screen.getByLabelText(/akun bank toko \(sumber modal\)/i).value).toBe('SeaBank');
  });

  it('produk yang dipilih ulang menimpa akun sebelumnya (tidak nyangkut)', async () => {
    render(<TransaksiForm onSaved={() => {}} onCancel={() => {}} />);
    setJenisDigital();
    await pilihProdukDigital('Dana 10.000');
    await waitFor(() => expect(screen.getByLabelText(/akun bank toko \(sumber modal\)/i).value).toBe('DANA'));

    await pilihProdukDigital('Telkomsel 10.000');
    await waitFor(() => expect(screen.getByLabelText(/akun bank toko \(sumber modal\)/i).value).toBe('OrderKuota'));
  });
});

describe('TransaksiForm — laba produk digital ikut qty', () => {
  it('qty 1 → laba per-unit; qty 2 → laba total (2x) + ringkasan "2x"', async () => {
    render(<TransaksiForm onSaved={() => {}} onCancel={() => {}} />);
    setJenisDigital();
    await pilihProdukDigital('Dana 10.000');

    // Modal 10.000, jual 12.000 → laba/unit 2.000
    await waitFor(() => expect(nomorLaba()).toContain('Rp 2.000'));
    expect(screen.queryByText('Total 2x: Rp 24.000')).toBeNull();
    expect(screen.queryByText(/2x\s/)).toBeNull();

    // Tambah qty jadi 2
    const plus = screen.getAllByRole('button').find((b) => b.textContent.trim() === '+');
    fireEvent.click(plus);

    await waitFor(() => {
      // Total naik ke 24.000
      expect(screen.getByText('Total 2x: Rp 24.000')).toBeTruthy();
    });
    // Laba jadi TOTAL (2 x 2.000 = 4.000), bukan lagi 2.000
    await waitFor(() => expect(nomorLaba()).toContain('Rp 4.000'));
    expect(nomorLaba()).not.toContain('Rp 2.000');
    // Ada keterangan per-unit
    expect(screen.getByText(/2x\s*Rp 2\.000/)).toBeTruthy();
  });

  it('tidak ada ringkasan qty saat qty masih 1', async () => {
    render(<TransaksiForm onSaved={() => {}} onCancel={() => {}} />);
    setJenisDigital();
    await pilihProdukDigital('Telkomsel 10.000');
    // modal 10.500 jual 11.000 → laba/unit 500
    await waitFor(() => expect(nomorLaba()).toContain('Rp 500'));
    expect(screen.queryByText(/2x\s*Rp/)).toBeNull();
  });
});
