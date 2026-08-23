// =====================================================================
// Sync Queue Management
// Mengelola antrean operasi yang belum ter-sync ke cloud.
// =====================================================================

import { getDB, isMobile } from './offline-db.js';

// Tambah operasi ke sync queue
export async function addToQueue(tableName, recordId, action, payload) {
  if (!isMobile()) return null;
  const db = getDB();
  if (!db) return null;

  try {
    const sql = `
      INSERT INTO sync_queue (table_name, record_id, action, payload, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', datetime('now'))
    `;
    await db.run(sql, [tableName, recordId, action, JSON.stringify(payload)]);
    console.log(`[SyncQueue] Added: ${action} ${tableName}#${recordId}`);
    return true;
  } catch (err) {
    console.error('[SyncQueue] Add failed:', err);
    return false;
  }
}

// Ambil semua operasi pending
export async function getPendingOps() {
  if (!isMobile()) return [];
  const db = getDB();
  if (!db) return [];

  try {
    const result = await db.query(
      "SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY created_at ASC"
    );
    return result.values || [];
  } catch (err) {
    console.error('[SyncQueue] Get pending failed:', err);
    return [];
  }
}

// Tandai operasi sedang disync
export async function markSyncing(id) {
  if (!isMobile()) return;
  const db = getDB();
  if (!db) return;

  try {
    await db.run(
      "UPDATE sync_queue SET status = 'syncing' WHERE id = ?",
      [id]
    );
  } catch (err) {
    console.error('[SyncQueue] Mark syncing failed:', err);
  }
}

// Tandai operasi berhasil disync
export async function markSynced(id) {
  if (!isMobile()) return;
  const db = getDB();
  if (!db) return;

  try {
    await db.run(
      "UPDATE sync_queue SET status = 'synced', synced_at = datetime('now') WHERE id = ?",
      [id]
    );
  } catch (err) {
    console.error('[SyncQueue] Mark synced failed:', err);
  }
}

// Tandai operasi gagal
export async function markFailed(id, errorMessage) {
  if (!isMobile()) return;
  const db = getDB();
  if (!db) return;

  try {
    await db.run(
      "UPDATE sync_queue SET status = 'failed', error_message = ? WHERE id = ?",
      [errorMessage, id]
    );
  } catch (err) {
    console.error('[SyncQueue] Mark failed failed:', err);
  }
}

// Hitung jumlah operasi pending
export async function getPendingCount() {
  if (!isMobile()) return 0;
  const db = getDB();
  if (!db) return 0;

  try {
    const result = await db.query(
      "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'pending'"
    );
    return result.values?.[0]?.count || 0;
  } catch (err) {
    return 0;
  }
}

// Bersihkan operasi yang sudah lama (lebih dari 7 hari)
export async function cleanupOldOps() {
  if (!isMobile()) return;
  const db = getDB();
  if (!db) return;

  try {
    await db.run(
      "DELETE FROM sync_queue WHERE status = 'synced' AND synced_at < datetime('now', '-7 days')"
    );
  } catch (err) {
    console.error('[SyncQueue] Cleanup failed:', err);
  }
}
