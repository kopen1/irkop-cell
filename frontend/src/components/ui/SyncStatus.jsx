// =====================================================================
// SyncStatus - Indikator online/offline + antrean sync
// Hanya muncul di aplikasi mobile (APK) dan hanya saat ada yang perlu
// diperhatian: sedang offline atau masih ada antrean pending. Kalau
// online dan tidak ada antrean, disembunyikan supaya tidak memenuhi layar.
// Diletakkan di atas bottom-nav (bukan di atasnya).
// =====================================================================

import { useSync } from '../../hooks/useSync.js';

export function SyncStatus() {
  const { isOnline, isMobile: isMobileApp, pendingCount, manualSync } = useSync();

  if (!isMobileApp) return null;
  if (isOnline && pendingCount === 0) return null;

  const offline = !isOnline;
  const warna = offline ? 'warning' : 'success';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'calc(var(--bottomnav-height) + var(--space-2))',
        right: 'var(--space-3)',
        zIndex: 60,
        padding: 'var(--space-1) var(--space-3)',
        borderRadius: 'var(--radius-sm)',
        background: `var(--${warna}-soft)`,
        border: `1px solid var(--${warna})`,
        color: `var(--${warna})`,
        fontSize: '0.75rem',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        cursor: pendingCount > 0 ? 'pointer' : 'default',
      }}
      onClick={pendingCount > 0 ? manualSync : undefined}
      title={pendingCount > 0 ? 'Klik untuk sinkron sekarang' : ''}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: `var(--${warna})`,
          flexShrink: 0,
        }}
      />
      <span style={{ fontWeight: 600 }}>{offline ? 'Offline' : 'Sinkron tertunda'}</span>
      {pendingCount > 0 && (
        <span
          style={{
            background: `var(--${warna})`,
            color: 'var(--bg-surface)',
            padding: '1px 6px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.65rem',
            fontWeight: 700,
          }}
        >
          {pendingCount}
        </span>
      )}
    </div>
  );
}
