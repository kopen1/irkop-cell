import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import DaftarBarangPage from '../DaftarBarangPage.jsx';

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    get: (...a) => getMock(...a),
    post: (...a) => postMock(...a),
    put: vi.fn(async () => ({})),
    del: vi.fn(async () => ({})),
  },
  newIdempotencyKey: () => 'k',
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
  AuthProvider: ({ children }) => children,
}));
vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    toast: { success() {}, error() {} },
  }),
  ToastProvider: ({ children }) => children,
}));

const katalog = {
  items: [
    { id: 1, kode: 'P-001', nama: 'Toner', kategori_id: 1, kategori_nama: 'Fisik', lacak_stok: 1, harga: 100000, harga_modal: 70000, stok: 50, stok_minimum: 5, satuan: 'pcs', deleted_at: null },
    { id: 2, kode: 'P-002', nama: 'Pulsa', kategori_id: 2, kategori_nama: 'Digital', lacak_stok: 0, harga: 12000, harga_modal: 11000, stok: 0, stok_minimum: 0, satuan: 'pcs', deleted_at: null },
  ],
};
const kategori = {
  items: [
    { id: 1, nama: 'Fisik', lacak_stok: 1 },
    { id: 2, nama: 'Digital', lacak_stok: 0 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  postMock.mockResolvedValue({});
  getMock.mockImplementation(async (path) => {
    if (path === '/kategori') return kategori;
    if (path === '/produk') return katalog;
    return { items: [] };
  });
});
afterEach(() => cleanup());

async function renderPage() {
  const utils = render(<DaftarBarangPage />);
  await screen.findByText('Daftar Barang');
  return utils;
}

async function openImport(container) {
  fireEvent.click(screen.getByText('Import CSV'));
  await screen.findByText('Import Produk dari CSV');
  return container.querySelector('input[type="file"]');
}

function selectCsv(container, csvText, name = 'produk.csv') {
  const input = container.querySelector('input[type="file"]');
  const file = new File([csvText], name, { type: 'text/csv' });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('DaftarBarangPage Export CSV (ITEM 6)', () => {
  it('tombol Export CSV mengunduh katalog lengkap sebagai CSV', async () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await renderPage();

    fireEvent.click(screen.getByText('Export CSV'));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());

    expect(getMock).toHaveBeenCalledWith('/produk');
    const csvArgs = createSpy.mock.calls[0][0];
    const text = await csvArgs.text();
    const lines = text.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe('kode,nama,kategori,harga_modal,harga,satuan,stok,stok_minimum');
    expect(lines[1]).toBe('P-001,Toner,Fisik,70000,100000,pcs,50,5');
    expect(lines[2]).toBe('P-002,Pulsa,Digital,11000,12000,pcs,,');

    createSpy.mockRestore();
    revokeSpy.mockRestore();
    clickSpy.mockRestore();
  });
});

describe('DaftarBarangPage Import CSV (ITEM 6)', () => {
  it('import valid: membuat produk via POST /produk + menampilkan hasil', async () => {
    const { container } = await renderPage();
    await openImport(container);
    const csv = [
      'kode,nama,kategori,harga_modal,harga,satuan,stok,stok_minimum',
      'IMP-1,Produk Baru,Fisik,5000,10000,pcs,10,2',
      'IMP-2,Produk Kedua,Digital,4000,9000,pcs,5,1',
    ].join('\r\n');
    selectCsv(container, csv);

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    expect(postMock).toHaveBeenCalledWith('/produk', expect.objectContaining({ kode: 'IMP-1', nama: 'Produk Baru', kategori_id: 1, harga: 10000, harga_modal: 5000, stok: 10, stok_minimum: 2 }));
    expect(postMock).toHaveBeenCalledWith('/produk', expect.objectContaining({ kode: 'IMP-2', kategori_id: 2, satuan: 'pcs' }));
    expect(await screen.findByText('2 produk dibuat.')).toBeTruthy();
    expect(screen.getByText('Semua baris valid.')).toBeTruthy();
  });

  it('import menolak kategori tidak dikenal + kode duplikat (dilewati) + angka invalid, tanpa membuat produk', async () => {
    const { container } = await renderPage();
    await openImport(container);
    const csv = [
      'kode,nama,kategori,harga_modal,harga,satuan,stok,stok_minimum',
      'NEW-1,Bagus,Fisik,5000,10000,pcs,10,2',
      'NEW-2,Buruk,Misterius,5000,10000,pcs,10,2',
      'P-001,Duplikat Sudah Ada,Fisik,5000,10000,pcs,10,2',
      'NEW-3,Harga Jelek,Fisik,5000,abc,pcs,10,2',
    ].join('\r\n');
    selectCsv(container, csv);

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledWith('/produk', expect.objectContaining({ kode: 'NEW-1' }));

    expect(await screen.findByText('1 produk dibuat.')).toBeTruthy();
    expect(screen.getByText(/kategori "Misterius" tidak dikenal/)).toBeTruthy();
    expect(screen.getByText('kode sudah ada — dilewati')).toBeTruthy();
    expect(screen.getByText('harga harus berupa angka (contoh: 15000)')).toBeTruthy();
  });

  it('import tanpa kolom wajib ditolak, POST tidak dipanggil', async () => {
    const { container } = await renderPage();
    await openImport(container);
    const csv = 'nama,harga\nToner,10000';
    selectCsv(container, csv);

    expect(await screen.findByText(/Kolom wajib tidak ditemukan: kode/)).toBeTruthy();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('file kosong menghasilkan error per-baris, POST tidak dipanggil', async () => {
    const { container } = await renderPage();
    await openImport(container);
    selectCsv(container, 'kode,nama,harga\n');
    expect(await screen.findByText('File kosong atau tidak ada baris data.')).toBeTruthy();
    expect(postMock).not.toHaveBeenCalled();
  });
});