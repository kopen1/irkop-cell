import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { ToastStack } from '../components/ui/Toast';

const ToastContext = createContext(null);

let seq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((type, message, opts = {}) => {
    const id = ++seq;
    setToasts((prev) => [...prev, { id, type, message, duration: opts.duration ?? (opts.sticky ? 0 : 3500) }]);
    if (!opts.sticky) {
      setTimeout(() => dismiss(id), opts.duration ?? 3500);
    }
    return id;
  }, [dismiss]);

  const value = useMemo(
    () => ({
      push,
      success: (m, o) => push('success', m, o),
      error: (m, o) => push('error', m, o),
      warning: (m, o) => push('warning', m, o),
      info: (m, o) => push('info', m, o),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast harus dipakai di dalam <ToastProvider>');
  return ctx;
}