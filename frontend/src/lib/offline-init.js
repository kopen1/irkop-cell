// =====================================================================
// Offline System Initializer
// Panggil initOfflineSystem() saat app pertama kali load.
// =====================================================================

import { initLocalDB, isMobile } from './offline-db.js';
import { startNetworkListener, startPeriodicSync, initialSync } from './sync-manager.js';

let initialized = false;

export async function initOfflineSystem() {
  if (initialized) return;
  if (!isMobile()) {
    console.log('[Offline] Not mobile, skipping offline system init');
    return;
  }

  console.log('[Offline] Initializing offline system...');

  try {
    // 1. Init local database
    await initLocalDB();
    console.log('[Offline] Local database ready');

    // 2. Start network listener
    startNetworkListener();
    console.log('[Offline] Network listener started');

    // 3. Start periodic sync
    startPeriodicSync();
    console.log('[Offline] Periodic sync started');

    // 4. Initial sync (download semua data)
    if (navigator.onLine) {
      await initialSync();
      console.log('[Offline] Initial sync complete');
    }

    initialized = true;
    console.log('[Offline] Offline system initialized');
  } catch (err) {
    console.error('[Offline] Init failed:', err);
  }
}
