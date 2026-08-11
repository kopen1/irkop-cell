import { describe, expect, it } from 'vitest';
import { NAV, NAV_SYSTEM, canAccess, resolveByPath, MAIN_NAV_MOBILE } from '../routes';

describe('canAccess (permission-aware navigation)', () => {
  const karyawanPerng = { role: 'karyawan', halaman: ['transaksi', 'kasir'] };

  it('Karyawan hanya melihat halaman di daftar permission-nya', () => {
    expect(canAccess(karyawanPerng, 'transaksi')).toBe(true);
    expect(canAccess(karyawanPerng, 'kasir')).toBe(true);
    expect(canAccess(karyawanPerng, 'laporan')).toBe(false);
  });

  it('HARD RULE: gaji_karyawan & pengaturan tidak pernah diberikan ke Karyawan', () => {
    expect(canAccess(karyawanPerng, 'gaji_karyawan')).toBe(false);
    expect(canAccess(karyawanPerng, 'pengaturan')).toBe(false);
    const karyawanDenganGaji = { role: 'karyawan', halaman: ['gaji_karyawan'] };
    expect(canAccess(karyawanDenganGaji, 'gaji_karyawan')).toBe(false);
  });

  it('Admin dapat semua kecuali gaji (hard rule tetap dijaga di domain)', () => {
    const admin = { role: 'admin', halaman: [] };
    expect(canAccess(admin, 'pengaturan')).toBe(true);
    expect(canAccess(admin, 'laporan')).toBe(true);
    expect(canAccess(admin, 'gaji_karyawan')).toBe(false);
  });
});

describe('resolveByPath', () => {
  it('memetakan path ke item navigasi', () => {
    expect(resolveByPath('/transaksi')?.key).toBe('transaksi');
    expect(resolveByPath('/gaji')?.key).toBe('gaji_karyawan');
    expect(resolveByPath('/tidak-ada')).toBeUndefined();
  });
});

describe('MAIN_NAV_MOBILE', () => {
  it('hanya berisi 4 menu utama (PRD 4)', () => {
    expect(MAIN_NAV_MOBILE.map((n) => n.key)).toEqual(['dashboard', 'transaksi', 'kasir', 'laporan']);
  });
});

describe('NAV keys unik', () => {
  it('semua key halaman unik dan 1:1 dengan user_permissions', () => {
    const keys = [...NAV, ...NAV_SYSTEM].map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        'dashboard',
        'transaksi',
        'kasir',
        'laporan',
        'daftar_barang',
        'laporan_service_hp',
        'kasbon',
        'pelanggan',
        'pengeluaran',
        'gaji_karyawan',
        'pengaturan',
      ])
    );
  });
});