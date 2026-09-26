// Parser vCard (.vcf) untuk impor kontak perangkat tanpa API Kontak.
// Contact Picker API (navigator.contacts) tidak berfungsi di Android WebView
// (APK Capacitor), jadi file .vcf adalah jalur yang bekerja di semua browser
// dan WebView tanpa izin akses kontak.
//
// Mendukung: banyak kartu dalam 1 file (BEGIN:VCARD..END:VCARD), line folding,
// escaped separator (\, \; \n), quoted-printable sederhana, dan_prefiks
// TEL (HP/ponsel) lebih diprioritaskan daripada TEL_HOME/TEL_WORK.

const TEL_TYPES_PREFERRED = ['cell', 'mobile', 'iphone'];

// Buka lipatan baris vCard: baris lanjutan diawali spasi/tab (line folding),
// dan "=" di akhir baris = soft line break pada quoted-printable.
function unfold(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/=\n/g, '')
    .replace(/\n[ \t]/g, '');
}

function unescapeValue(v) {
  return String(v)
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\"/g, '"')
    .trim();
}

function decodeQuotedPrintable(value) {
  //=V encoded: =XX hex. Nilai multibyte (UTF-8) perlu digabung per byte.
  const bytes = [];
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(value.slice(i + 1, i + 3))) {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      for (const ch of value[i]) bytes.push(ch.codePointAt(0));
    }
  }
  try {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  } catch {
    return value;
  }
}

function splitParams(part) {
  // "TEL;TYPE=CELL;ENCODING=QUOTED-PRINTABLE:+62812" -> { value, params }
  const idx = part.indexOf(':');
  if (idx === -1) return null;
  const head = part.slice(0, idx);
  const value = part.slice(idx + 1);
  const segs = head.split(';');
  const prop = segs.shift().toUpperCase();
  const params = {};
  for (const seg of segs) {
    const eq = seg.indexOf('=');
    if (eq === -1) params[seg.toUpperCase()] = true;
    else params[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { prop, params, value };
}

function pickName(props) {
  const fn = props.find((p) => p.prop === 'FN');
  if (fn && fn.value.trim()) return unescapeValue(fn.value);
  const n = props.find((p) => p.prop === 'N');
  if (n) {
    // N:Last;First;Middle;Prefix;Suffix
    const parts = n.value.split(';').map(unescapeValue).filter(Boolean);
    const [last = '', first = '', middle = ''] = parts;
    const gabung = [first, middle, last].filter(Boolean).join(' ').trim();
    if (gabung) return gabung;
  }
  const org = props.find((p) => p.prop === 'ORG');
  return org ? unescapeValue(org.value) : '';
}

function telType(params) {
  const t = params.TYPE;
  const list = Array.isArray(t) ? t : t ? [t] : [];
  return list.map((x) => String(x).toLowerCase());
}

// Tebakan jenis nomor dari label vCard + panjang digitnya. Ini hanya tebakan:
// pengguna bisa mengubahnya di layar pratinjau sebelum disimpan.
export function tebakJenisNomor(nomor, tipeVcard = []) {
  const t = tipeVcard.map((x) => String(x).toLowerCase());
  const digit = String(nomor || '').replace(/\D/g, '');

  if (t.some((x) => TEL_TYPES_PREFERRED.includes(x))) return 'hp';
  // Prefiks 62 atau 08 + 9-13 digit = nomor seluler Indonesia.
  // Hanya "08", bukan semua awalan 0 — nomor tetap (021, 031, ...) bukan HP.
  if (digit.startsWith('62') || digit.startsWith('08')) {
    const lokal = digit.replace(/^(62|0)/, '');
    if (lokal.length >= 8 && lokal.length <= 13) return 'hp';
  }
  // Token listrik PLN 20 digit (beberapa 16); rekening 10-16 digit.
  if (digit.length >= 17) return 'token';
  if (digit.length >= 10) return 'rekening';
  if (t.some((x) => ['work', 'home', 'fax', 'main'].includes(x))) return 'rekening';
  return 'hp';
}

// Label yang tampil di pratinjau.
export const JENIS_NOMOR = [
  { value: 'hp', label: 'HP (telepon)' },
  { value: 'rekening', label: 'Rekening bank' },
  { value: 'token', label: 'Token listrik' },
];

// tipe alias yang dipakai di backend: hanya ada no_hp & no_rekening, jadi
// token listrik disimpan sebagai no_rekening.
export function tipeAliasUntuk(jenis) {
  return jenis === 'hp' ? 'no_hp' : 'no_rekening';
}

export function parseVCard(text) {
  const cards = unfold(String(text || '')).split(/BEGIN:VCARD/i);
  const out = [];
  for (const chunk of cards) {
    if (!/END:VCARD/i.test(chunk)) continue;
    const props = [];
    for (const line of chunk.split('\n')) {
      const parsed = splitParams(line.trim());
      if (!parsed) continue;
      if (String(parsed.params.ENCODING || '').toUpperCase() === 'QUOTED-PRINTABLE') {
        parsed.value = decodeQuotedPrintable(parsed.value);
      }
      props.push(parsed);
    }
    const nama = pickName(props);
    const nomor = props
      .filter((p) => p.prop === 'TEL')
      .map((p) => ({
        nomor: unescapeValue(p.value),
        tipeVcard: telType(p.params),
      }))
      .filter((t) => t.nomor);
    const email = props.find((p) => p.prop === 'EMAIL');
    if (!nama && !nomor.length) continue;
    out.push({
      nama,
      email: email ? unescapeValue(email.value) : '',
      // Semua nomor dipertahankan; jenis ditebak dari label + panjang digit.
      nomor: nomor.map((t) => ({ nomor: t.nomor, jenis: tebakJenisNomor(t.nomor, t.tipeVcard) })),
      //-backward-compatible: nomor pertama = dipakai sebagai telepon utama.
      telepon: nomor.length ? nomor[0].nomor : '',
      jumlahTelepon: nomor.length,
    });
  }
  return out;
}

// Nomor untuk dedupe: samakan format supaya nomor yang sama tidak terimport
// dua kali. Nomor seluler Indonesia (08xx/62xx) dinormalkan ke 62xx; nomor
// tetap (021, 031, 022, ...) sengaja dibiarkan karena awalan 0-nya bukan
// prefiks negara.
export function normalisasiTelepon(nomor) {
  let s = String(nomor || '').replace(/[^\d+]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00')) s = s.slice(2);
  if (/^0[89]\d/.test(s)) s = `62${s.slice(1)}`;
  return s;
}
