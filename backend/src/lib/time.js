const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');

export function nowIso() {
  return new Date().toISOString();
}

export function utcToWibDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const wib = new Date(d.getTime() + WIB_OFFSET_MS);
  return `${wib.getUTCFullYear()}-${pad(wib.getUTCMonth() + 1)}-${pad(wib.getUTCDate())}`;
}

export function wibDateToday() {
  return utcToWibDate(new Date().toISOString());
}

export function isoToWib(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return new Date(d.getTime() + WIB_OFFSET_MS).toISOString().replace('Z', '+07:00');
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidCalendarDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function wibDateToUtcRange(date) {
  if (!isValidCalendarDate(date)) throw new Error('INVALID_DATE');
  const start = new Date(`${date}T00:00:00Z`).getTime() - WIB_OFFSET_MS;
  const end = start + 24 * 60 * 60 * 1000;
  return { startUtc: new Date(start).toISOString(), endUtc: new Date(end).toISOString() };
}