// =====================================================================
// IRKOP CELL — Offline-Aware API Client
// Wrap api.js dengan offline support (Capacitor SQLite).
// Online → cloud API
// Offline → local SQLite + sync queue
// =====================================================================

import { isMobile, getDB } from './offline-db.js';
import { addToQueue } from './sync-queue.js';
import { api, getToken, ApiError, newIdempotencyKey, downloadFile } from './api.js';

// Cek apakah online
function checkOnline() {
  return navigator.onLine;
}

// GET: online → cloud, offline → local DB
async function get(path, params = {}) {
  // Online: pakai cloud API
  if (checkOnline() || !isMobile()) {
    return api.get(path, params);
  }

  // Offline: baca dari local SQLite
  const db = getDB();
  if (!db) throw new ApiError(0, 'offline', 'Database lokal tidak tersedia.');

  try {
    const tableName = extractTableName(path);
    const result = await db.query(`SELECT * FROM ${tableName}`);
    return { items: result.values || [] };
  } catch (err) {
    throw new ApiError(0, 'offline_error', `Gagal membaca data lokal: ${err.message}`);
  }
}

// POST: online → cloud, offline → local + queue
async function post(path, body, idempotencyKey) {
  // Online: pakai cloud API
  if (checkOnline() || !isMobile()) {
    return api.post(path, body, idempotencyKey);
  }

  // Offline: simpan ke local + queue
  const db = getDB();
  if (!db) throw new ApiError(0, 'offline', 'Database lokal tidak tersedia.');

  try {
    const tableName = extractTableName(path);

    // Insert ke local DB
    const cols = Object.keys(body).filter(k => body[k] !== undefined);
    const placeholders = cols.map(() => '?').join(', ');
    const values = cols.map(k => body[k]);

    await db.run(
      `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`,
      values
    );

    // Dapatkan ID yang baru diinsert
    const idResult = await db.query('SELECT last_insert_rowid() as id');
    const newId = idResult.values?.[0]?.id;

    // Tambah ke sync queue
    await addToQueue(tableName, newId, 'CREATE', body);

    console.log(`[OfflineAPI] Saved ${tableName}#${newId} locally (pending sync)`);

    return {
      id: newId,
      status: 'offline_saved',
      message: 'Data disimpan secara offline. Akan disinkronkan saat online.',
    };
  } catch (err) {
    throw new ApiError(0, 'offline_error', `Gagal menyimpan data lokal: ${err.message}`);
  }
}

// PUT: online → cloud, offline → local + queue
async function put(path, body) {
  // Online: pakai cloud API
  if (checkOnline() || !isMobile()) {
    return api.put(path, body);
  }

  // Offline: update local + queue
  const db = getDB();
  if (!db) throw new ApiError(0, 'offline', 'Database lokal tidak tersedia.');

  try {
    const tableName = extractTableName(path);
    const recordId = extractRecordId(path);

    // Update local DB
    const sets = [];
    const values = [];
    for (const [key, value] of Object.entries(body)) {
      if (key === 'id') continue;
      sets.push(`${key} = ?`);
      values.push(value);
    }
    values.push(recordId);

    await db.run(
      `UPDATE ${tableName} SET ${sets.join(', ')} WHERE id = ?`,
      values
    );

    // Tambah ke sync queue
    await addToQueue(tableName, recordId, 'UPDATE', body);

    console.log(`[OfflineAPI] Updated ${tableName}#${recordId} locally (pending sync)`);

    return {
      status: 'offline_saved',
      message: 'Data diperbarui secara offline. Akan disinkronkan saat online.',
    };
  } catch (err) {
    throw new ApiError(0, 'offline_error', `Gagal memperbarui data lokal: ${err.message}`);
  }
}

// DELETE: online → cloud, offline → soft delete + queue
async function del(path, body) {
  // Online: pakai cloud API
  if (checkOnline() || !isMobile()) {
    return api.del(path, body);
  }

  // Offline: soft delete + queue
  const db = getDB();
  if (!db) throw new ApiError(0, 'offline', 'Database lokal tidak tersedia.');

  try {
    const tableName = extractTableName(path);
    const recordId = extractRecordId(path);

    // Soft delete
    await db.run(
      `UPDATE ${tableName} SET deleted_at = datetime('now') WHERE id = ?`,
      [recordId]
    );

    // Tambah ke sync queue
    await addToQueue(tableName, recordId, 'DELETE', { id: recordId });

    console.log(`[OfflineAPI] Deleted ${tableName}#${recordId} locally (pending sync)`);

    return {
      status: 'offline_saved',
      message: 'Data dihapus secara offline. Akan disinkronkan saat online.',
    };
  } catch (err) {
    throw new ApiError(0, 'offline_error', `Gagal menghapus data lokal: ${err.message}`);
  }
}

// Helper: extract table name from path
function extractTableName(path) {
  // /produk → produk
  // /transaksi/123 → transaksi
  const segments = path.split('/').filter(Boolean);
  return segments[0];
}

// Helper: extract record ID from path
function extractRecordId(path) {
  // /transaksi/123 → 123
  const segments = path.split('/').filter(Boolean);
  return segments[1] || null;
}

// Export offline-aware API
export const offlineApi = {
  get,
  post,
  put,
  del,
};

// Re-export original api for backward compatibility
export { api, getToken, ApiError, newIdempotencyKey, downloadFile };
