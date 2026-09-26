// Warna stabil per operator/brand untuk header sub-grup (mis. "Indosat · vi*").
// Nama operator hasil dari operatorOf() jadi tetap sama antara Daftar Barang
// dan Harga Server. Warna mid-tone supaya terbaca di tema gelap & terang.
const NAMED = {
  indosat: { bg: 'rgba(245,158,11,0.18)', fg: '#f59e0b' },
  telkomsel: { bg: 'rgba(59,130,246,0.18)', fg: '#3b82f6' },
  three: { bg: 'rgba(168,85,247,0.18)', fg: '#a855f7' },
  xl: { bg: 'rgba(16,185,129,0.18)', fg: '#10b981' },
  axis: { bg: 'rgba(249,115,22,0.18)', fg: '#f97316' },
  smartfren: { bg: 'rgba(20,184,166,0.18)', fg: '#14b8a6' },
  lyca: { bg: 'rgba(132,204,22,0.20)', fg: '#84cc16' },
  'by.u': { bg: 'rgba(56,189,248,0.18)', fg: '#38bdf8' },
  dana: { bg: 'rgba(6,182,212,0.18)', fg: '#06b6d4' },
  ovo: { bg: 'rgba(139,92,246,0.18)', fg: '#8b5cf6' },
  gopay: { bg: 'rgba(34,197,94,0.18)', fg: '#22c55e' },
  pln: { bg: 'rgba(234,179,8,0.18)', fg: '#eab308' },
};

const FALLBACK = { bg: 'var(--bg-hover)', fg: 'var(--text-secondary)' };

export function operatorColor(nama) {
  const key = String(nama || '').toLowerCase().trim();
  return NAMED[key] || FALLBACK;
}
