import { useEffect, useRef, useState } from "react";

export interface Sample<T> {
  time: number;
  value: T;
  /** Ожидаемый интервал между точками источника этой точки: шаг
   * прореживания для истории, период опроса для живых точек. По нему
   * отличается обычный интервал от пропуска данных (lib/chartGaps.ts). */
  stepMs?: number;
}

const WINDOW_MS = 60 * 60 * 1000; // 1h window (spec: "скользящее окно 1 час")

/** Polls `fetchFn` and keeps every sample from the last hour — this is how
 * the dashboard's two aggregate charts get their 1h history without any
 * server-side time-series storage (design.md: no background watcher, pull
 * only; the chart's history only covers however long this tab has been
 * open, which is an accepted MVP trade-off). */
export function useRollingWindow<T>(
  fetchFn: () => Promise<T>,
  intervalMs: number,
  enabled: boolean = true
): Sample<T>[] {
  const [samples, setSamples] = useState<Sample<T>[]>([]);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const value = await fetchRef.current();
        if (cancelled) return;
        const now = Date.now();
        setSamples((prev) => [...prev, { time: now, value }].filter((s) => now - s.time <= WINDOW_MS));
      } catch {
        // A failed poll just skips this tick — the chart keeps showing
        // what it already has, same as the rest of the app's polling.
      }
    };

    tick();
    const id = setInterval(tick, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs, enabled]);

  return samples;
}
