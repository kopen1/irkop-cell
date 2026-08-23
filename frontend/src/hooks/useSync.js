// =====================================================================
// useSync - React hook untuk sync status
// =====================================================================

import { useState, useEffect } from 'react';
import { isMobile } from '../lib/offline-db.js';
import { onSyncStatusChange, getSyncStatus, flushQueue } from '../lib/sync-manager.js';

export function useSync() {
  const [status, setStatus] = useState({
    isOnline: navigator.onLine,
    isMobile: isMobile(),
    pendingCount: 0,
  });

  useEffect(() => {
    // Update initial status
    setStatus(prev => ({
      ...prev,
      ...getSyncStatus(),
    }));

    // Subscribe ke perubahan
    const unsubscribe = onSyncStatusChange((newStatus) => {
      setStatus(prev => ({
        ...prev,
        ...newStatus,
      }));
    });

    // Listen untuk online/offline events
    const handleOnline = () => setStatus(prev => ({ ...prev, isOnline: true }));
    const handleOffline = () => setStatus(prev => ({ ...prev, isOnline: false }));

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const manualSync = async () => {
    if (status.isOnline) {
      await flushQueue();
    }
  };

  return {
    ...status,
    manualSync,
  };
}
