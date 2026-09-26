// Cache daftar produk + kategori untuk halaman Daftar Barang & form produk.
// - Satu GET /produk + satu GET /kategori per muat; pindah halaman bolak-balik
//   tidak memicu request ulang (cache TTL + invalidasi saat ada mutasi).
// - invalidateProdukCache() dipakai setelah create/update/delete/import/scan.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const TTL_MS = 30000;

let cache = null;
let inflight = null;
let dirty = false;
const listeners = new Set();

export function invalidateProdukCache() {
  dirty = true;
}

export async function loadProdukCache(force = false) {
  if (cache && !dirty && !force && Date.now() - cache.fetchedAt < TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [p, k] = await Promise.all([api.get('/produk'), api.get('/kategori')]);
      cache = { items: p.items || [], kategori: k.items || [], fetchedAt: Date.now() };
      dirty = false;
    } catch (err) {
      if (!cache) throw err;
    } finally {
      inflight = null;
      for (const fn of listeners) fn(cache);
    }
    return cache;
  })();
  return inflight;
}

export function useProdukCache() {
  const [data, setData] = useState(cache);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const onChange = () => { if (alive) setData(cache ? { ...cache } : null); };
    listeners.add(onChange);
    onChange();
    loadProdukCache().then(
      () => { if (alive) { onChange(); setError(null); } },
      (err) => { if (alive) setError(err); },
    );
    return () => { alive = false; listeners.delete(onChange); };
  }, []);

  const loading = !data;
  const reload = async () => {
    const next = await loadProdukCache(true);
    setData(next ? { ...next } : null);
    return next;
  };

  return { cache: data, loading, error, reload };
}
