// Warna stabil per kategori (hash nama -> palet). Kategori baru otomatis dapat
// warna berbeda tanpa perlu didaftarkan manual.
const PALETTE = [
  { bg: 'rgba(59,130,246,0.16)', fg: '#3b82f6' },  // biru
  { bg: 'rgba(16,185,129,0.16)', fg: '#10b981' },  // hijau
  { bg: 'rgba(245,158,11,0.18)', fg: '#d97706' },  // amber
  { bg: 'rgba(239,68,68,0.16)', fg: '#dc2626' },   // merah
  { bg: 'rgba(139,92,246,0.16)', fg: '#8b5cf6' },  // violet
  { bg: 'rgba(236,72,153,0.16)', fg: '#db2777' },  // pink
  { bg: 'rgba(20,184,166,0.16)', fg: '#0d9488' },  // teal
  { bg: 'rgba(249,115,22,0.16)', fg: '#ea580c' },  // oranye
  { bg: 'rgba(99,102,241,0.16)', fg: '#6366f1' },  // indigo
  { bg: 'rgba(132,204,22,0.20)', fg: '#65a30d' },  // lime
];

export function kategoriColor(nama) {
  const s = String(nama || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
