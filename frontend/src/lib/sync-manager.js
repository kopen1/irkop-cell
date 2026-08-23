// =====================================================================
// Sync Manager
// Auto sync: detect online/offline, push queue, pull updates.
// =====================================================================

import { getDB, isMobile } from './offline-db.js';
import {
  getPendingOps,
  markSyncing,
  markSynced,
  markFailed,
  getPendingCount,
  cleanupOldOps,
} from './sync-queue.js';
import { getToken } from './api.js';

const API_BASE = import.meta.env.VITE_API_BASE || '';
let syncInterval = null;
let isOnline = navigator.onLine;
let listeners = [];

// Lazy load Capacitor Network plugin
async function getNetwork() {
  if (!isMobile()) return null;
  try {
    const { Network } = await import('@capacitor/network');
    return Network;
  } catch {
    return null;
  }
}

// Listen for network changes
export async function startNetworkListener() {
  if (!isMobile()) return;

  const Network = await getNetwork();
  if (!Network) return;

  Network.addListener('networkStatusChange', (status) => {
    const wasOnline = isOnline;
    isOnline = status.connected;
    console.log(`[SyncManager] Network: ${wasOnline ? 'online' : 'offline'} → ${isOnline ? 'online' : 'offline'}`);

    // Jika baru saja online, flush queue
    if (isOnline && !wasOnline) {
      console.log('[SyncManager] Back online, flushing sync queue...');
      flushQueue().then(() => {
        pullUpdates();
      });
    }

    notifyListeners();
  });
}

// Start periodic sync (setiap 5 menit jika online)
export function startPeriodicSync() {
  if (!isMobile()) return;

  // Sync pertama kali
  if (isOnline) {
    pullUpdates();
  }

  // Periodic sync
  syncInterval = setInterval(async () => {
    if (isOnline) {
      await flushQueue();
      await pullUpdates();
      await cleanupOldOps();
    }
  }, 5 * 60 * 1000); // 5 menit
}

// Stop periodic sync
export function stopPeriodicSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

// Flush sync queue ke cloud
export async function flushQueue() {
  if (!isMobile() || !isOnline) return 0;

  const pending = await getPendingOps();
  if (pending.length === 0) return 0;

  console.log(`[SyncManager] Flushing ${pending.length} operations...`);
  let successCount = 0;

  for (const op of pending) {
    try {
      await markSyncing(op.id);

      const token = getToken();
      const headers = {
        'Content-Type': 'application/json',
        'X-Sync-Source': 'mobile',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const payload = JSON.parse(op.payload);
      const method = op.action === 'CREATE' ? 'POST' : op.action === 'UPDATE' ? 'PUT' : 'DELETE';

      let url = `${API_BASE}/${op.table_name.replace('_', '/')}`;
      if (op.action === 'UPDATE' || op.action === 'DELETE') {
        url += `/${op.record_id}`;
      }

      const response = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        await markSynced(op.id);
        successCount++;
        console.log(`[SyncManager] Synced: ${op.action} ${op.table_name}#${op.record_id}`);
      } else {
        const errorText = await response.text();
        await markFailed(op.id, `HTTP ${response.status}: ${errorText}`);
        console.warn(`[SyncManager] Failed: ${op.action} ${op.table_name}#${op.record_id} - ${response.status}`);
      }
    } catch (err) {
      await markFailed(op.id, err.message);
      console.error(`[SyncManager] Error syncing ${op.id}:`, err);
    }
  }

  console.log(`[SyncManager] Flush complete: ${successCount}/${pending.length} synced`);
  notifyListeners();
  return successCount;
}

// Pull updates dari cloud ke local
export async function pullUpdates() {
  if (!isMobile() || !isOnline) return;

  const db = getDB();
  if (!db) return;

  try {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Pull setiap tabel penting
    const tables = ['produk', 'pelanggan', 'akun_master', 'transaksi', 'service_hp'];

    for (const table of tables) {
      try {
        const response = await fetch(`${API_BASE}/${table}`, { headers });
        if (!response.ok) continue;

        const data = await response.json();
        const items = data.items || data.results || data;

        if (!Array.isArray(items)) continue;

        for (const item of items) {
          await upsertRecord(db, table, item);
        }

        console.log(`[SyncManager] Pulled ${items.length} records from ${table}`);
      } catch (err) {
        console.warn(`[SyncManager] Pull ${table} failed:`, err);
      }
    }
  } catch (err) {
    console.error('[SyncManager] Pull updates failed:', err);
  }
}

// Upsert record ke local DB (insert atau update)
async function upsertRecord(db, table, record) {
  if (!record.id && !record.kode_transaksi && !record.kode && !record.nama_akun) return;

  try {
    // Cek apakah record sudah ada
    const existing = await findRecord(db, table, record);
    if (existing) {
      // Update
      const sets = [];
      const values = [];
      for (const [key, value] of Object.entries(record)) {
        if (key === 'id') continue;
        sets.push(`${key} = ?`);
        values.push(value);
      }
      values.push(existing.id);

      await db.run(
        `UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`,
        values
      );
    } else {
      // Insert
      const cols = Object.keys(record).filter(k => record[k] !== undefined);
      const placeholders = cols.map(() => '?').join(', ');
      const values = cols.map(k => record[k]);

      await db.run(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
        values
      );
    }
  } catch (err) {
    // Skip duplikat
    if (!err.message?.includes('UNIQUE')) {
      console.warn(`[SyncManager] Upsert ${table} failed:`, err.message);
    }
  }
}

// Cari record di local DB
async function findRecord(db, table, record) {
  try {
    // Cari berdasarkan unique key
    if (record.kode_transaksi) {
      return await db.query('SELECT * FROM transaksi WHERE kode_transaksi = ?', [record.kode_transaksi]);
    }
    if (record.kode) {
      return await db.query('SELECT * FROM produk WHERE kode = ?', [record.kode]);
    }
    if (record.nama_akun) {
      return await db.query('SELECT * FROM akun_master WHERE nama_akun = ?', [record.nama_akun]);
    }
    if (record.id) {
      return await db.query(`SELECT * FROM ${table} WHERE id = ?`, [record.id]);
    }
  } catch {
    return null;
  }
  return null;
}

// Subscribe ke perubahan sync status
export function onSyncStatusChange(callback) {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter(l => l !== callback);
  };
}

function notifyListeners() {
  const status = {
    isOnline,
    pendingCount: 0,
  };
  getPendingCount().then(count => {
    status.pendingCount = count;
    listeners.forEach(l => l(status));
  });
}

// Get current status
export function getSyncStatus() {
  return {
    isOnline,
    isMobile: isMobile(),
  };
}

// Full initial sync (download semua data)
export async function initialSync() {
  if (!isMobile()) return;

  console.log('[SyncManager] Starting initial sync...');
  await pullUpdates();
  console.log('[SyncManager] Initial sync complete');
}
