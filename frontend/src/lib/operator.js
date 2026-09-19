// Tentukan operator/brand produk untuk grouping.
// Prioritas: kode voucher (V + operator) — mis. Vi=Voucher Indosat, Vs=Telkomsel,
// Vt=Three, Vx=XL, Vsm=Smartfren, VA=Axis. Fallback: baca dari nama dengan
// pencocokan KATA (word-boundary) supaya "perdana" tidak dianggap "dana".
const NAME_BRANDS = [
  { re: /\bindosat\b|\bisat\b/, name: 'Indosat' },
  { re: /\btelkomsel\b|\btsel\b/, name: 'Telkomsel' },
  { re: /\bsmartfren\b|\bsmart\b|\bsm\b/, name: 'Smartfren' },
  { re: /\bthree\b|\btri\b/, name: 'Three' },
  { re: /\bxl\b/, name: 'XL' },
  { re: /\baxis\b/, name: 'Axis' },
  { re: /\bbyu\b|\bby\.u\b/, name: 'by.U' },
  { re: /\bgopay\b|\bgo ?pay\b/, name: 'GoPay' },
  { re: /\bovo\b/, name: 'OVO' },
  { re: /\bdana\b/, name: 'Dana' },
  { re: /\bpln\b|\btoken\b/, name: 'PLN' },
];

function brandDariNama(nama) {
  const n = String(nama || '').toLowerCase();
  for (const b of NAME_BRANDS) if (b.re.test(n)) return b.name;
  return '';
}

export function operatorOf(kode, nama, kategoriNama = '') {
  const k = String(kode || '').toUpperCase();
  if (/voucher/i.test(String(kategoriNama))) {
    if (k.startsWith('VSM')) return 'Smartfren';
    if (k.startsWith('VT')) return 'Three';
    if (k.startsWith('VS')) return 'Telkomsel';
    if (k.startsWith('VX')) return 'XL';
    if (k.startsWith('VI')) return 'Indosat';
    if (k.startsWith('VA')) return 'Axis';
  }
  return brandDariNama(nama);
}
