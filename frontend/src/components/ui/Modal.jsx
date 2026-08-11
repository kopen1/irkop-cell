import { useEffect } from 'react';
import { Icon } from './Icon';
import { Button } from './Button';

const ESC = 27;

export function Modal({ open, onClose, title, size, children, footer, ariaLabel }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.keyCode === ESC) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        className={`modal ${size === 'lg' ? 'modal-lg' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || title}
      >
        <header className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Tutup">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title = 'Konfirmasi',
  message,
  confirmLabel = 'Ya, lanjutkan',
  cancelLabel = 'Batal',
  danger = true,
  onConfirm,
  onCancel,
  loading = false,
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3 items-center">
        {danger && <span className="confirm-icon" aria-hidden="true">!</span>}
        <p style={{ fontSize: '0.92rem' }}>{message}</p>
      </div>
    </Modal>
  );
}