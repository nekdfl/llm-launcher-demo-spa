import { useEffect, useRef, useState } from "react";

interface PollingState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
}

/** Statuses update by polling every 2 seconds — no WebSocket (spec:
 * "Опрос статусов раз в 2 секунды"). */
export const STATUS_POLL_INTERVAL_MS = 2000;

export function usePolling<T>(
  fetchFn: () => Promise<T>,
  intervalMs: number = STATUS_POLL_INTERVAL_MS,
  enabled: boolean = true
): PollingState<T> {
  const [state, setState] = useState<PollingState<T>>({ data: null, error: null, loading: true });
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const data = await fetchRef.current();
        if (!cancelled) setState({ data, error: null, loading: false });
      } catch (error) {
        if (!cancelled) setState((prev) => ({ ...prev, error, loading: false }));
      }
    };

    tick();
    const id = setInterval(tick, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs, enabled]);

  return state;
}
