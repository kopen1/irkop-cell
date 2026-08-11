import { Button } from './Button';
import { Icon } from './Icon';

export function Loader({ label = 'Memuat data...' }) {
  return (
    <div className="state-block" role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ title = 'Belum ada data', description, icon = 'database', action }) {
  return (
    <div className="state-block">
      <span className="state-icon" aria-hidden="true">
        <Icon name={icon} size={26} />
      </span>
      <div>
        <div className="state-title">{title}</div>
        {description && <div className="state-desc">{description}</div>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  const message = error?.message || 'Terjadi kesalahan yang tidak diketahui.';
  return (
    <div className="state-block" role="alert">
      <span className="state-icon" aria-hidden="true">
        <Icon name="alert" size={26} />
      </span>
      <div>
        <div className="state-title">Gagal memuat data</div>
        <div className="state-desc">{message}</div>
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Coba lagi
        </Button>
      )}
    </div>
  );
}