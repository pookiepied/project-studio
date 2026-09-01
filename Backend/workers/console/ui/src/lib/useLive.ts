import { useCallback, useEffect, useRef, useState } from "react";

export interface Live<T> {
  data: T | null;
  error: string | null;
  /** True only for the first load, so a refresh never blanks the page. */
  loading: boolean;
  refreshedAt: number | null;
  refresh: () => void;
}

/**
 * Polls a fetcher and keeps the previous value while the next one is in flight.
 *
 * The "keep the old data" part is the whole point: a dashboard that empties
 * itself every few seconds to show a spinner is unreadable, and the numbers it
 * was showing were never that fresh to begin with.
 */
export function useLive<T>(
  fetcher: () => Promise<T>,
  intervalMs: number | null,
  deps: unknown[],
): Live<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const generation = useRef(0);

  const run = useCallback(() => {
    const mine = ++generation.current;
    fetcher()
      .then((value) => {
        if (mine !== generation.current) return;
        setData(value);
        setError(null);
        setRefreshedAt(Date.now());
      })
      .catch((err: unknown) => {
        if (mine !== generation.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (mine === generation.current) setLoading(false);
      });
  }, deps);

  useEffect(() => {
    setLoading(true);
    run();
  }, [run]);

  useEffect(() => {
    if (intervalMs === null) return;
    // Polling a hidden tab spends quota to update pixels nobody is looking at.
    const tick = () => {
      if (!document.hidden) run();
    };
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, run]);

  return { data, error, loading, refreshedAt, refresh: run };
}
