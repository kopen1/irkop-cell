import worker from '../src/index.js';
import { createMemoryDb } from './d1adapter.js';
import { hashPassword } from '../src/lib/password.js';

export function setupEnv() {
  const { sqliteDb, d1 } = createMemoryDb();
  const env = {
    DB: d1,
    JWT_SECRET: 'irkop-test-secret-2026',
    TOKEN_TTL: '2592000',
    APP_TIMEZONE: 'Asia/Jakarta',
  };
  return { sqliteDb, env };
}

export async function call(env, path, { method = 'GET', token = null, body = undefined, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (token) init.headers.Authorization = `Bearer ${token}`;
  const req = new Request(`https://irkop.local${path}`, init);
  const res = await worker.fetch(req, env);
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

export async function createUserRaw(env, { nama, username, password, role }) {
  const hash = await hashPassword(password);
  const res = await env.DB.prepare(
    'INSERT INTO users (nama, username, password_hash, role, aktif, created_at) VALUES (?, ?, ?, ?, 1, ?)'
  ).bind(nama, username, hash, role, new Date().toISOString()).run();
  return res.meta.last_row_id;
}

export async function setPermission(env, userId, halaman) {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO user_permissions (user_id, halaman, created_at) VALUES (?, ?, ?)'
  ).bind(userId, halaman, new Date().toISOString()).run();
}

export async function login(env, username, password) {
  const { status, data } = await call(env, '/api/auth/login', { method: 'POST', body: { username, password } });
  if (status !== 200) throw new Error(`login gagal: ${status} ${JSON.stringify(data)}`);
  return data.token;
}

export async function createKategoriRaw(env, nama, lacakStok = 1) {
  const res = await env.DB.prepare(
    'INSERT INTO kategori_produk (nama, lacak_stok, created_at) VALUES (?, ?, ?)'
  ).bind(nama, lacakStok, new Date().toISOString()).run();
  return res.meta.last_row_id;
}

export async function createProdukRaw(env, { kode, nama, kategori_id, harga, harga_modal = null, stok = 0 }) {
  const res = await env.DB.prepare(
    'INSERT INTO produk (kode, nama, kategori_id, harga, harga_modal, stok, stok_minimum, satuan, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)'
  ).bind(kode, nama, kategori_id, harga, harga_modal, stok, 'pcs', new Date().toISOString()).run();
  return res.meta.last_row_id;
}