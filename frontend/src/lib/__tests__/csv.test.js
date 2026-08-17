import { describe, expect, it } from 'vitest';
import { buildCsv, parseCsv, rowsToObjects, CSV_HEADERS } from '../csv';

describe('buildCsv', () => {
  it('menulis header + baris dengan delimiter koma', () => {
    const csv = buildCsv([{ kode: 'A-1', nama: 'Toner', harga: 15000, harga_modal: '', kategori: '', satuan: 'pcs', stok: 5, stok_minimum: 1 }]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(CSV_HEADERS.join(','));
    expect(lines[1]).toBe('A-1,Toner,,,15000,pcs,5,1');
  });

  it('membungkus nilai yang mengandung koma / tanda kutip / baris baru', () => {
    const csv = buildCsv([{ kode: 'A', nama: 'Barang, "Special"\ndiskon', kategori: 'Fisik', harga_modal: '', harga: 10, satuan: 'pcs', stok: '', stok_minimum: '' }]);
    const line = csv.split('\r\n')[1];
    expect(line).toBe('A,"Barang, ""Special""\ndiskon",Fisik,,10,pcs,,');
  });

  it('nilai kosong/null ditulis sebagai field kosong', () => {
    const csv = buildCsv([{ kode: '', nama: '', kategori: '', harga_modal: null, harga: null, satuan: '', stok: null, stok_minimum: '' }]);
    expect(csv.split('\r\n')[1]).toBe(',,,,,,,');
  });
});

describe('parseCsv', () => {
  it('mengurai baris sederhana', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('mengurai tanda kutip berisi koma dan tanda kutip ganda', () => {
    const rows = parseCsv('kode,nama\nA,"Barang, ""Special"""\n');
    expect(rows).toEqual([['kode', 'nama'], ['A', 'Barang, "Special"']]);
  });

  it('mengurai nilai dengan baris baru di dalam tanda kutip', () => {
    const rows = parseCsv('nama\n"baris1\nbaris2"\n');
    expect(rows).toEqual([['nama'], ['baris1\nbaris2']]);
  });

  it('menangani CRLF dan baris akhir tanpa newline', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('tidak menghasilkan baris kosong dari trailing newline', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('rowsToObjects', () => {
  it('mengubah baris menjadi object dengan header dinormalisasi', () => {
    const objs = rowsToObjects([['Kode', 'Nama'], ['A-1', 'Toner']]);
    expect(objs).toEqual([{ kode: 'A-1', nama: 'Toner' }]);
  });

  it('membuang baris kosong seluruhnya', () => {
    const objs = rowsToObjects([['kode', 'nama'], ['', '  '], ['A-1', 'Toner']]);
    expect(objs).toEqual([{ kode: 'A-1', nama: 'Toner' }]);
  });

  it('kolom yang kurang diisi menjadi string kosong', () => {
    const objs = rowsToObjects([['kode', 'nama', 'harga'], ['A-1', 'Toner']]);
    expect(objs).toEqual([{ kode: 'A-1', nama: 'Toner', harga: '' }]);
  });
});
