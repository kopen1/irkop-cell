// =====================================================================
// IRKOP CELL — Formatting helpers (rupiah, tanggal WIB)
// Timezone bisnis aplikasi: Asia/Jakarta (PRD 12.1). Frontend menampilkan
// timestamp dalam WIB. Backend mengelola konversi filter ke UTC.
// =====================================================================

export const TIMEZONE = 'Asia/Jakarta';

const rupiahFmt = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const numberFmt = new Intl.NumberFormat('id-ID');

export function formatRupiah(value) {
  const n = Number(value ?? 0);
  return rupiahFmt.format(n);
}

export function formatNumber(value) {
  return numberFmt.format(Number(value ?? 0));
}

// Format tanggal WIB: 10/08/2026 19:45
export function formatDateTime(iso) {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

// Format hanya tanggal WIB: 10/08/2026
export function formatDate(iso) {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

// Format tanggal dari komponen <input type=date> (nilai 'YYYY-MM-DD') → '10/08/2026'
export function formatDateInput(value) {
  if (!value) return '-';
  const [y, m, d] = value.split('-');
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

// Tanggal WIB hari ini dalam bentuk 'YYYY-MM-DD' untuk input date form.
// Dipecah manual agar konsisten WIB walau device user di timezone lain.
export function todayWIB() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Nominal positif/negatif dengan tanda untuk tampilan mutasi
export function formatSignedRupiah(value) {
  const n = Number(value ?? 0);
  const base = formatRupiah(Math.abs(n));
  return n < 0 ? `-${base}` : `+${base}`;
}

const metodeLabel = {
  tunai: 'Tunai',
  transfer: 'Transfer',
  bon: 'Bon',
  cash_tunai: 'Cash & Tunai',
};

export function labelMetode(value) {
  return metodeLabel[value] ?? value ?? '-';
}

const konfirmasiLabel = {
  tidak_perlu: 'Tidak Perlu',
  menunggu: 'Menunggu',
  otomatis: 'Otomatis',
  manual: 'Manual',
};

export function labelKonfirmasi(value) {
  return konfirmasiLabel[value] ?? value ?? '-';
}

export const METODE_PEMBAYARAN = [
  { value: 'tunai', label: 'Tunai' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'bon', label: 'Bon' },
  { value: 'cash_tunai', label: 'Cash & Tunai' },
];

// Halaman yang valid (sinkron dengan user_permissions.halaman pada schema)
export const HALAMAN_PERMISSION = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'transaksi', label: 'Transaksi' },
  { key: 'kasir', label: 'Kasir' },
  { key: 'laporan', label: 'Laporan' },
  { key: 'daftar_barang', label: 'Daftar Barang' },
  { key: 'laporan_service_hp', label: 'Service HP' },
  { key: 'kasbon', label: 'Kasbon' },
  { key: 'pelanggan', label: 'Pelanggan' },
  { key: 'pengeluaran', label: 'Pengeluaran' },
  { key: 'gaji_karyawan', label: 'Gaji Karyawan' },
  { key: 'pengaturan', label: 'Pengaturan' },
].filter((h) => h.key !== 'gaji_karyawan'); // hard rule: karyawan tidak pernah diberi akses gaji

export const HALAMAN_GAJI = { key: 'gaji_karyawan', label: 'Gaji Karyawan' };