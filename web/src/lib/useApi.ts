import { useCallback, useEffect, useRef, useState } from "react";

/** Tiny data-fetching hook: runs `fn` when deps change, optional polling while `pollMs(data)` returns a number. */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[], opts: { enabled?: boolean; poll?: (d: T | undefined) => number | false } = {}) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const enabled = opts.enabled ?? true;

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const d = await fnRef.current();
      setData(d);
      setError(undefined);
      return d;
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    setData(undefined);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);

  const pollRef = useRef(opts.poll);
  pollRef.current = opts.poll;
  const interval = enabled && pollRef.current ? pollRef.current(data) : false;
  useEffect(() => {
    if (!interval) return;
    const t = setInterval(() => reload(true), interval);
    return () => clearInterval(t);
  }, [interval, reload]);

  return { data, setData, error, loading, reload };
}
