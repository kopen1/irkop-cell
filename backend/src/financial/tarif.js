import { err } from '../lib/errors.js';

// Provider yang didukung tarif admin.
const PROVIDERS = ['DANA', 'BANK', 'OVO', 'GOPAY'];

export function normalizeProvider(p) {
  if (!p) return null;
  const u = String(p).toUpperCase().trim();
  return PROVIDERS.includes(u) ? u : null;
}

export function listProviders() {
  return [...PROVIDERS];
}

// Tarif nominal besar di luar tabel:
//   >900k s.d. 1.990k  = 10k
//   >1.990k            = 10k + 5k tiap kelipatan 1 juta
function hitungBesar(nominal) {
  if (nominal >= 900001 && nominal <= 1990000) return 10000;
  if (nominal > 1990000) {
    const extra = Math.ceil((nominal - 1990000) / 1000000);
    return 10000 + extra * 5000;
  }
  return null;
}

export async function hitungAdmin(db, providerRaw, nominalRaw) {
  const provider = normalizeProvider(providerRaw);
  if (!provider) throw err(400, 'invalid_provider', 'Provider tidak valid (DANA/BANK/OVO/GOPAY)');
  const nominal = Number(nominalRaw);
  if (!Number.isInteger(nominal) || nominal < 1) {
    throw err(400, 'invalid_value', 'Nominal harus integer >= 1');
  }

  const row = await db.one(
    `SELECT admin FROM tarif_admin
       WHERE provider = ? AND ? BETWEEN min_nominal AND max_nominal
       ORDER BY min_nominal DESC LIMIT 1`,
    provider,
    nominal
  );
  if (row) return Number(row.admin);

  const besar = hitungBesar(nominal);
  if (besar !== null) return besar;

  throw err(400, 'no_tarif', `Tidak ada tarif admin untuk ${provider} nominal ${nominal}`);
}
