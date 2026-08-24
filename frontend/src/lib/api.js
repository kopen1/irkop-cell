// =====================================================================
// IRKOP CELL — API Client (memakai API Contract Team 1 v1.0)
// docs/API_CONTRACT.md — jangan menebak endpoint/field/response.
//
// Konvensi:
//  - Base URL: VITE_API_BASE (default: origin server /api)
//  - Authorization: Bearer <token> (kecuali login & webhook)
//  - Error shape: { "error": { "code", "message" } }
//  - Idempotency: kirim header "Idempotency-Key" untuk operasi finansial
//    retry-safe (POST transaksi, POST pengeluaran, dll).
// =====================================================================

const _envBase = import.meta.env.VITE_API_BASE || '';
const isCapacitor = typeof window !== 'undefined' && window.Capacitor;
const BACKEND_ORIGIN = 'https://konter.irkop.workers.dev';
const BASE = isCapacitor && _envBase.startsWith('/') ? BACKEND_ORIGIN + _envBase : _envBase;
const TOKEN_KEY = 'irkop_cell_token';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(method, path, { body, idempotencyKey, params } = {}) {
  const url = new URL(BASE + path, window.location.origin);

  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    });
  }

  const headers = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.');
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : null;

  if (response.status === 401) {
    if (onUnauthorized) onUnauthorized();
  }

  if (!response.ok) {
    const err = payload?.error || {};
    throw new ApiError(response.status, err.code || `http_${response.status}`, err.message || 'Terjadi kesalahan pada server.');
  }

  return payload;
}

export const api = {
  get: (path, params) => request('GET', path, { params }),
  post: (path, body, idempotencyKey) => request('POST', path, { body, idempotencyKey }),
  put: (path, body) => request('PUT', path, { body }),
  del: (path, body) => request('DELETE', path, { body }),
};

// Helper: key idempotency untuk operasi finansial (retry-safe).
export function newIdempotencyKey() {
  return `ir-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Unduh CSV dari endpoint (auth via Authorization). Membuat file unduhan di browser.
export async function downloadFile(path, params = {}, filename) {
  const url = new URL(BASE + path, window.location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  const token = getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let res;
  try {
    res = await fetch(url.toString(), { headers });
  } catch {
    throw new ApiError(0, 'network_error', 'Tidak dapat terhubung ke server.');
  }
  if (!res.ok) {
    const p = await res.json().catch(() => null);
    const err = p?.error || {};
    throw new ApiError(res.status, err.code || `http_${res.status}`, err.message || 'Gagal mengunduh.');
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || `irkop-cell-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  return true;
}