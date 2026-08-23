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

// Template struk (header/alamat/footer) dari setting, dipakai TransaksiDetail.
// Menggunakan cache GET /settings yang sama dengan useSiteName (tidak fetch ulang).
let settingsCache = null;
const settingsListeners = new Set();

function notifySettings() {
  for (const fn of settingsListeners) fn(settingsCache);
}

async function loadSettingsFull() {
  const name = await loadSiteName();
  try {
    const s = await api.get('/settings');
    settingsCache = s || {};
  } catch {
    settingsCache = {};
  }
  notifySettings();
  return settingsCache;
}

export function useStrukTemplate() {
  const [tpl, setTpl] = useState(settingsCache || {});
  useEffect(() => {
    const update = (s) => setTpl(s || {});
    settingsListeners.add(update);
    if (!settingsCache) loadSettingsFull().then(update);
    else update(settingsCache);
    return () => settingsListeners.delete(update);
  }, []);
  return {
    siteName: tpl.nama_website || DEFAULT_SITE_NAME,
    header: tpl.struk_header || '',
    alamat: tpl.struk_alamat || '',
    footer: tpl.struk_footer || '',
  };
}

export async function refreshSettings() {
  settingsCache = null;
  return loadSettingsFull();
}
