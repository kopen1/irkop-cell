// =====================================================================
// SyncStatus - Indikator online/offline + pending sync
// Tampilkan di corner atau navbar
// =====================================================================

import { useSync } from '../hooks/useSync.js';
import { isMobile } from '../lib/offline-db.js';

export function SyncStatus() {
  const { isOnline, isMobile: isMobileApp, pendingCount, manualSync } = useSync();

  // Hanya tampilkan di mobile
  if (!isMobileApp) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'var(--space-3)',
        right: 'var(--space-3)',
        zIndex: 1000,
        padding: 'var(--space-2) var(--space-3)',
        borderRadius: 'var(--radius-sm)',
        background: isOnline ? 'var(--success-soft)' : 'var(--warning-soft)',
        border: `1px solid ${isOnline ? 'var(--success)' : 'var(--warning)'}`,
        fontSize: '0.75rem',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        cursor: pendingCount > 0 ? 'pointer' : 'default',
      }}
      onClick={pendingCount > 0 ? manualSync : undefined}
      title={pendingCount > 0 ? 'Klik untuk sync manual' : ''}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: isOnline ? 'var(--success)' : 'var(--warning)',
        }}
      />
      <span style={{ fontWeight: 600 }}>
        {isOnline ? 'Online' : 'Offline'}
      </span>
      {pendingCount > 0 && (
        <span
          style={{
            background: 'var(--warning)',
            color: 'white',
            padding: '1px 6px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.65rem',
          }}
        >
          {pendingCount} pending
        </span>
      )}
    </div>
  );
}
