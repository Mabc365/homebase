import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  let n = Number(bytes);
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatUptime(sec) {
  if (sec == null) return '—';
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  return formatUptime(Math.floor(ms / 1000));
}

// Periodic polling hook. Returns { data, loading, error, refresh, lastUpdated }.
export function useAutoFetch(fetcher, { intervalMs = 30000, enabled = true, deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const fetcherRef = useRef(fetcher);
  const requestSeq = useRef(0);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setLoading(true);
    try {
      const res = await fetcherRef.current();
      if (requestSeq.current !== seq) return;
      setData(res);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      if (requestSeq.current !== seq) return;
      setError(err);
    } finally {
      if (requestSeq.current === seq) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      requestSeq.current += 1;
      setLoading(false);
      return undefined;
    }
    refresh();
    if (!intervalMs) return () => { requestSeq.current += 1; };
    const id = setInterval(refresh, intervalMs);
    return () => {
      requestSeq.current += 1;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, ...deps]);

  return { data, loading, error, refresh, lastUpdated };
}

export function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || String(error || 'Unknown error');
}

// Wrap a promise-returning action with toast feedback.
export async function withToast(promise, { loading, success, error }) {
  return toast.promise(
    promise.then((v) => v).catch((err) => {
      const msg = err?.response?.data?.error || err?.message || String(err);
      throw new Error(msg);
    }),
    { loading, success, error: (err) => `${error}: ${err.message}` },
    {
      style: { background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155' },
      success: { iconTheme: { primary: '#10b981', secondary: '#1e293b' } },
      error: { iconTheme: { primary: '#ef4444', secondary: '#1e293b' } },
    }
  );
}
