// Registri navigasi & permission. Key halaman harus 1:1 dengan
// user_permissions.halaman pada schema (PRD 3.2 / schema 6.2).
// HARD RULE: 'gaji_karyawan' hanya untuk Admin; tidak pernah muncul di
// navigasi Karyawan (PRD 3.2).

export const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', path: '/', main: true },
  { key: 'transaksi', label: 'Transaksi', icon: 'transaksi', path: '/transaksi', main: true },
  { key: 'kasir', label: 'Kasir', icon: 'kasir', path: '/kasir', main: true },
  { key: 'laporan', label: 'Laporan', icon: 'laporan', path: '/laporan', main: true },
  { key: 'daftar_barang', label: 'Daftar Barang', icon: 'barang', path: '/daftar-barang', main: false, section: 'Operasional' },
  { key: 'laporan_service_hp', label: 'Service HP', icon: 'service', path: '/service-hp', main: false, section: 'Operasional' },
  { key: 'kasbon', label: 'Kasbon', icon: 'kasbon', path: '/kasbon', main: false, section: 'Operasional' },
  { key: 'pelanggan', label: 'Pelanggan', icon: 'pelanggan', path: '/pelanggan', main: false, section: 'Operasional' },
  { key: 'pengeluaran', label: 'Pengeluaran', icon: 'pengeluaran', path: '/pengeluaran', main: false, section: 'Operasional' },
];

export const NAV_SYSTEM = [
  { key: 'gaji_karyawan', label: 'Gaji Karyawan', icon: 'gaji', path: '/gaji', main: false, section: 'Sistem', adminOnly: true },
  { key: 'pengaturan', label: 'Pengaturan', icon: 'settings', path: '/pengaturan', main: false, section: 'Sistem', adminOnly: true },
];

// Menu utama untuk bottom navigation mobile.
export const MAIN_NAV_MOBILE = NAV.filter((n) => n.main).map((n) => ({ key: n.key, label: n.label, icon: n.icon, path: n.path }));

// Cek apakah path bisa diakses oleh permission user.
// - Admin: semua.
// - Karyawan: hanya halaman di dalam daftar permission-nya.
export function canAccess(permissions, key) {
  if (!permissions) return false;
  if (permissions.role === 'admin') return key !== 'gaji_karyawan'; // hard rule tetap dijaga
  if (key === 'gaji_karyawan' || key === 'pengaturan') return false;
  return Array.isArray(permissions.halaman) ? permissions.halaman.includes(key) : false;
}

export function resolveByPath(path) {
  return [...NAV, ...NAV_SYSTEM].find((n) => n.path === path);
}