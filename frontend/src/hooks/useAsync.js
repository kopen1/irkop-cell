import { useCallback, useEffect, useRef, useState } from 'react';

// Hook umum untuk data async: menangani loading / error / data + refresh.
// Endpoint dilabeli sesuai API Contract agar WAITING_DEPENDENCY terdokumentasi.
export function useAsync(fn, { deps = [], initial = null } = {}) {
  const [data, setData] = useState(initial);
  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [error, setError] = useState(null);

  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const res = await fnRef.current();
      setData(res);
      setStatus('success');
      return res;
    } catch (err) {
      setError(err);
      setStatus('error');
      throw err;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps]);

  useEffect(() => {
    run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, status, error, run, setData };
}