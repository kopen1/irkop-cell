// Tentukan operator/brand produk untuk grouping.
// Prioritas: kode voucher (V + operator) — mis. Vi=Voucher Indosat, Vs=Telkomsel,
// Vt=Three, Vx=XL, Vsm=Smartfren, VA=Axis. Fallback: baca dari nama.
const NAME_BRANDS = [
  'Indosat', 'Telkomsel', 'Tsel', 'Smartfren', 'Smart', 'Three', 'Tri',
  'XL', 'Axis', 'by.U', 'Dana', 'GoPay', 'Gopay', 'OVO', 'ShopeePay', 'PLN',
];

export function operatorOf(kode, nama, kategoriNama = '') {
  const k = String(kode || '').toUpperCase();
  const n = String(nama || '').toLowerCase();
  if (/voucher/i.test(String(kategoriNama))) {
    if (k.startsWith('VSM')) return 'Smartfren';
    if (k.startsWith('VT')) return 'Three';
    if (k.startsWith('VS')) return 'Telkomsel';
    if (k.startsWith('VX')) return 'XL';
    if (k.startsWith('VI')) return 'Indosat';
    if (k.startsWith('VA')) return 'Axis';
  }
  return NAME_BRANDS.find((b) => n.includes(b.toLowerCase())) || '';
}
