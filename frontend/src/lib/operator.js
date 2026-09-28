// Tentukan operator/brand produk untuk grouping.
// Prioritas: kode voucher (V + operator) — mis. Vi=Voucher Indosat, Vs=Telkomsel,
// Vt=Three, Vx=XL, Vsm=Smartfren, VA=Axis. Fallback: baca dari nama dengan
// pencocokan KATA (word-boundary) supaya "perdana" tidak dianggap "dana".
const NAME_BRANDS = [
  { re: /\bindosat\b|\bisat\b/, name: 'Indosat' },
  { re: /\btelkomsel\b|\btsel\b/, name: 'Telkomsel' },
  { re: /\blyca\b/, name: 'Lyca' },
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
    if (k.startsWith('LA')) return 'Lyca';
  }
  return brandDariNama(nama);
}

// Prefix kode voucher untuk label grup (mis. "vi", "va", "la", "vsm").
export function kodePrefixOf(kode, kategoriNama = '') {
  const k = String(kode || '').toUpperCase();
  if (!/voucher/i.test(String(kategoriNama))) return '';
  if (k.startsWith('VSM')) return 'vsm';
  return k.slice(0, 2).toLowerCase();
}

// Prefix kode lokal per operator. Voucher memakai "v" + prefix (Vi, Vs, Vt,
// Vx, Vsm, Va); pulsa memakai kode apa adanya (A, I, X, T, SM, S).
const VOUCHER_PREFIX = {
  indosat: 'i',
  telkomsel: 's',
  tri: 't',
  three: 't',
  xl: 'x',
  axis: 'a',
  smartfren: 'sm',
  lyca: 'l',
};

export function operatorPrefix(nama) {
  return VOUCHER_PREFIX[String(nama || '').toLowerCase().trim()] || '';
}

// Ambil GB + masa aktif dari nama produk OrderKuota, mis.
// "Indosat Freedom Mini 3GB 1 Hari" -> { gb: 3, hari: 1 }.
// Tanpa "hari" dianggap 28 hari (produk bulanan).
export function parseGbHari(nama) {
  const s = String(nama || '');
  const g = s.match(/(\d+(?:[.,]\d+)?)\s*gb/i);
  const gb = g ? Math.floor(parseFloat(g[1].replace(',', '.'))) : 0;
  const h = s.match(/(\d+)\s*hari/i);
  const hari = h ? parseInt(h[1], 10) : (/harian/i.test(s) ? 1 : 28);
  return { gb, hari };
}

// Ubah kode server (Vindosat00301, Vxl34, ...) menjadi kode gaya lokal.
// Aturan: v + prefix + kuota 2 digit; masa aktif ikut ditulis (2 digit) kecuali
// masa aktif 1 hari atau 28/30 hari.
//   3GB 1Hari  -> vi03     15GB 28Hari -> vi15
//   5GB 7Hari  -> vi0507   12GB 14Hari -> vi1214
//   10GB 5Hari -> vi1005
// Pulsa tidak diubah: kode OrderKuota sudah sama dengan kode produk lokal.
export function kodeLokalDariServer({ kategori, operator, nama_produk, kode_produk }) {
  const serverKode = String(kode_produk || '').trim();
  if (String(kategori || '') !== 'cetak_voucher') return serverKode;
  const p = operatorPrefix(operator);
  const { gb, hari } = parseGbHari(nama_produk);
  if (!p || !gb) return serverKode;
  const kuota = String(gb).padStart(2, '0');
  if (hari === 1) return `v${p}${kuota}`;
  if (hari === 28 || hari === 30) return `v${p}${gb}`;
  return `v${p}${kuota}${String(hari).padStart(2, '0')}`;
}
