// Ikon SVG ringan (stroke style) untuk navigasi & kontrol. Tanpa dependensi eksternal.
const paths = {
  dashboard: ['M3.5 3.5h6v6h-6z', 'M3.5 14.5h6v6h-6z', 'M14.5 3.5h6v9h-6z', 'M14.5 16.5h6v4h-6z'],
  transaksi: ['M21 6H9', 'M21 12H9', 'M21 18H9', 'M5 6v12'],
  kasir: ['M3 4h18v6a6 6 0 0 1-12 0V4', 'M3 4h18'],
  laporan: ['M6 2h9l5 5v15H6z', 'M15 2v5h5', 'M9 12h7', 'M9 16h7'],
  barang: ['M20 7.5 12 12 4 7.5M4 7.5V16.5L12 21l8-4.5V7.5'],
  service: ['M14.7 6.3a4.5 4.5 0 0 1 4.5 4.5c0 1.2-.5 2.3-1.3 3.1L6.3 5.3A4.5 4.5 0 0 1 14.7 6.3z', 'M6.3 14.7L3.5 17.5 6 20l2.8-2.8', 'M6 20l-2-2'],
  kasbon: ['M8 12h8', 'M12 8v8', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'],
  pelanggan: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  pengeluaran: ['M12 1v22', 'M17 5H9.5a3.5 3.5 0 0 0 0 7H15a3.5 3.5 0 0 1 0 7H6'],
  gaji: ['M2 9h20', 'M3 6h18v12H3z', 'M6 15h4'],
  settings: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M2 14h4', 'M10 8h4', 'M18 16h4'],
  menu: ['M4 6h16M4 12h16M4 18h16'],
  close: ['M6 6l12 12M18 6L6 18'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.35-4.35'],
  plus: ['M12 5v14M5 12h14'],
  edit: ['M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z'],
  trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M10 11v6M14 11v6'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  printer: ['M6 9V2h12v7', 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M6 14h12v8H6z'],
  check: ['M20 6L9 17l-5-5'],
  alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0z'],
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  money: ['M12 1v22', 'M17 5H9.5a3.5 3.5 0 0 0 0 7H15a3.5 3.5 0 0 1 0 7H6'],
  eye: ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  refresh: ['M21 12a9 9 0 1 1-3-6.7', 'M21 3v6h-6'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 3'],
  wallet: ['M21 12V7H5a2 2 0 0 1 0-4h14v4', 'M3 5v14a2 2 0 0 0 2 2h16v-5', 'M18 12a2 2 0 0 0 0 4h4v-4z'],
  key: ['M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78m0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'],
  database: ['M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3z', 'M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
  home: ['M3 9.5 12 3l9 6.5', 'M5 10v10h14V10'],
  transfer: ['M7 4v13', 'M7 4l-3 3M7 4l3 3', 'M17 20V7', 'M17 20l-3-3M17 20l3-3'],
};

export function Icon({ name, size = 18, className = '', strokeWidth = 1.8, ...rest }) {
  const d = paths[name] || paths.dashboard;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {d.map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}