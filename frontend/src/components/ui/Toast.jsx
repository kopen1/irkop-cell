import { Icon } from './Icon';

const toneIcon = { success: 'check', error: 'alert', warning: 'alert', info: 'bell' };

export function ToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <Icon name={toneIcon[t.type] || 'info'} size={16} style={{ marginTop: 1 }} />
          <span style={{ flex: 1 }}>{t.message}</span>
          <button type="button" className="toast-close" onClick={() => onDismiss(t.id)} aria-label="Tutup notifikasi">
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}