import { describe, expect, it } from 'vitest';
import {
  formatRupiah,
  formatNumber,
  formatSignedRupiah,
  formatDateTime,
  formatDateInput,
  todayWIB,
  labelMetode,
  labelKonfirmasi,
  METODE_PEMBAYARAN,
} from '../format';

describe('formatRupiah', () => {
  it('memformat nominal rupiah tanpa desimal', () => {
    expect(formatRupiah(300000)).toBe('Rp\u00a0300.000');
  });
  it('menangani nilai nol', () => {
    expect(formatRupiah(0)).toBe('Rp\u00a00');
  });
  it('menangani nilai null/undefined sebagai nol', () => {
    expect(formatRupiah(undefined)).toBe('Rp\u00a00');
  });
});

describe('formatNumber', () => {
  it('memformat angka dengan pemisah ribuan', () => {
    expect(formatNumber(1234567)).toBe('1.234.567');
  });
});

describe('formatSignedRupiah', () => {
  it('menambahkan tanda + untuk positif dan - untuk negatif', () => {
    expect(formatSignedRupiah(50000)).toBe('+Rp\u00a050.000');
    expect(formatSignedRupiah(-15000)).toBe('-Rp\u00a015.000');
  });
});

describe('formatDateTime (Asia/Jakarta)', () => {
  it('menampilkan timestamp ISO di zona waktu bisnis WIB', () => {
    // UTC 2026-08-10 00:30 → WIB (UTC+7) 2026-08-10 07:30
    const out = formatDateTime('2026-08-10T00:30:00.000Z');
    expect(out).toMatch(/10\/08\/2026/);
    expect(out).toContain('07.');
    expect(out).toContain('30');
  });
});

describe('formatDateInput', () => {
  it('mengubah YYYY-MM-DD menjadi DD/MM/YYYY', () => {
    expect(formatDateInput('2026-08-10')).toBe('10/08/2026');
  });
});

describe('todayWIB', () => {
  it('mengembalikan tanggal WIB format YYYY-MM-DD', () => {
    expect(todayWIB()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('label & opsi metode', () => {
  it('memetakan nilai metode ke label', () => {
    expect(labelMetode('tunai')).toBe('Tunai');
    expect(labelMetode('transfer')).toBe('Transfer');
    expect(labelMetode('bon')).toBe('Bon');
    expect(labelMetode('cash_tunai')).toBe('Cash & Tunai');
  });
  it('menyediakan semua metode di daftar opsi', () => {
    expect(METODE_PEMBAYARAN.map((m) => m.value)).toEqual(['tunai', 'transfer', 'bon', 'cash_tunai']);
  });
});

describe('labelKonfirmasi', () => {
  it('memetakan status konfirmasi ke label', () => {
    expect(labelKonfirmasi('menunggu')).toBe('Menunggu');
    expect(labelKonfirmasi('otomatis')).toBe('Otomatis');
    expect(labelKonfirmasi('manual')).toBe('Manual');
    expect(labelKonfirmasi('tidak_perlu')).toBe('Tidak Perlu');
  });
});