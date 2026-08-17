// Nama website (setting 'nama_website' via GET/PUT /settings) sebagai satu
// sumber kebenaran untuk branding (navbar, login, struk, export laporan).
// - Cache modul: semua pemakai memanggil GET /settings maksimal 1x.
// - Fallback aman ke 'Iirkop Cell' bila belum dimuat / gagal.
// - Live update: setSiteNameCache() memicu ulang semua komponen yang memakai useSiteName().
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export const DEFAULT_SITE_NAME = 'Iirkop Cell';

let cache = null;
let inflight = null;
const listeners = new Set();

function normalize(name) {
  return name && String(name).trim() ? String(name).trim() : DEFAULT_SITE_NAME;
}

function notify() {
  const name = cache || DEFAULT_SITE_NAME;
  for (const fn of listeners) fn(name);
}

export async function loadSiteName() {
  if (cache) return cache;
  if (!inflight) {
    inflight = (async () => {
      try {
        const s = await api.get('/settings');
        cache = normalize(s?.nama_website);
      } catch {
        cache = DEFAULT_SITE_NAME;
      } finally {
        inflight = null;
        notify();
      }
      return cache;
    })();
  }
  return inflight;
}

export function setSiteNameCache(name) {
  cache = normalize(name);
  notify();
}

// Dipakai test untuk memulai kondisi bersih.
export function resetSiteNameCache() {
  cache = null;
  inflight = null;
}

export function useSiteName() {
  const [name, setName] = useState(cache || DEFAULT_SITE_NAME);
  useEffect(() => {
    const update = (n) => setName(n || DEFAULT_SITE_NAME);
    listeners.add(update);
    loadSiteName().then(update);
    return () => listeners.delete(update);
  }, []);
  return name;
}
