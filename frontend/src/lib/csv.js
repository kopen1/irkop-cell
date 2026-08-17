// Helper CSV untuk Import/Export katalog produk (PRD 5.5).
// Format: delimiter koma, nilai dibungkus tanda kutip ganda bila mengandung
// koma / tanda kutip / baris baru. Membaca & menulis format yang sama.
export const CSV_HEADERS = ['kode', 'nama', 'kategori', 'harga_modal', 'harga', 'satuan', 'stok', 'stok_minimum'];

function esc(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Baris object { kode, nama, ... } → teks CSV dengan header.
export function buildCsv(rows) {
  const head = CSV_HEADERS.map(esc).join(',');
  const body = rows.map((r) => CSV_HEADERS.map((h) => esc(r[h])).join(','));
  return [head, ...body].join('\r\n');
}

// Teks CSV → array baris (array of array). Mendukung tanda kutip dan baris baru di dalam field.
export function parseCsv(text) {
  const out = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    out.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushRow();
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) pushRow();
  return out;
}

// Baris CSV → array of object, baris kosong dibuang, header dinormalisasi (lowercase + trim).
export function rowsToObjects(rows) {
  const [head, ...body] = rows;
  const headers = (head || []).map((h) => String(h).trim().toLowerCase());
  return body
    .filter((r) => r.some((cell) => String(cell).trim() !== ''))
    .map((r) => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = (r[i] ?? '').trim();
      });
      return obj;
    });
}