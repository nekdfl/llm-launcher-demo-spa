import { useEffect, useRef, useState } from "react";
import type { Sample } from "./useRollingWindow";

export type MetricsRangeKey = "1h" | "24h" | "7d" | "all";

export interface MetricsRange {
  key: MetricsRangeKey;
  label: string;
  /** Ширина окна графика; у «всё время» её задаёт сама история. */
  windowMs: number | null;
}

const HOUR_MS = 60 * 60 * 1000;

export const METRICS_RANGES: MetricsRange[] = [
  { key: "1h", label: "час", windowMs: HOUR_MS },
  { key: "24h", label: "сутки", windowMs: 24 * HOUR_MS },
  { key: "7d", label: "неделя", windowMs: 7 * 24 * HOUR_MS },
  { key: "all", label: "всё время", windowMs: null },
];

export const DEFAULT_METRICS_RANGE: MetricsRangeKey = "all";

export function rangeByKey(key: MetricsRangeKey): MetricsRange {
  return METRICS_RANGES.find((range) => range.key === key) ?? METRICS_RANGES[METRICS_RANGES.length - 1];
}

export interface MetricsSeries<T> {
  samples: Sample<T>[];
  /** Окно, которое должен показать график: у «всё время» — от самой старой
   * точки до сейчас, но не меньше часа, иначе свежая история рисовалась бы
   * в бесконечно узком окне. */
  windowMs: number;
  loading: boolean;
  error: string | null;
}

/** Шаг прореживания из ответа истории — в миллисекундах для `Sample.stepMs`. */
export function historyStepMs(stepSeconds: number | undefined): number | undefined {
  return stepSeconds && stepSeconds > 0 ? stepSeconds * 1000 : undefined;
}

/** Пропуск опроса дольше этого — повод заново загрузить историю. */
const MIN_MISSED_POLL_MS = 15_000;
const MISSED_POLL_FACTOR = 3;

/** История живёт на сервере, а не во вкладке: при открытии ряд приходит
 * целиком за выбранный диапазон, а живой опрос только дописывает свежие
 * точки. Так свежесть графика (те же 5 секунд, что и раньше) не зависит от
 * повторного запроса всей истории.
 *
 * Если живой опрос пропускал такты (вкладка была скрыта, компьютер спал,
 * запросы не проходили), история загружается заново: сервер всё это время
 * копил отсчёты, и пропуск заполняется ими, а не остаётся дырой
 * (chart-gaps-by-source-step). Живые точки несут `stepMs = intervalMs`,
 * история — шаг прореживания, который проставляет `loadHistory`. */
export function useMetricsSeries<T>({
  loadHistory,
  pollLive,
  rangeKey,
  intervalMs,
  enabled = true,
}: {
  loadHistory: (rangeKey: MetricsRangeKey) => Promise<Sample<T>[]>;
  /** `null` — в этом такте точек нет (источник не ответил) и точка не
   * добавляется: разрыв в ряду честнее выдуманного нуля. */
  pollLive: () => Promise<T | null>;
  rangeKey: MetricsRangeKey;
  intervalMs: number;
  enabled?: boolean;
}): MetricsSeries<T> {
  const [samples, setSamples] = useState<Sample<T>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistoryRef = useRef(loadHistory);
  loadHistoryRef.current = loadHistory;
  const pollLiveRef = useRef(pollLive);
  pollLiveRef.current = pollLive;
  /** Перезагрузка истории текущего диапазона; задаёт эффект истории. */
  const reloadRef = useRef<(() => void) | null>(null);
  /** Момент последнего ответа живого опроса (или загрузки истории). */
  const lastPollRef = useRef<number>(Date.now());

  const windowMsOfRange = rangeByKey(rangeKey).windowMs;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let loadingNow = false;

    const load = async (initial: boolean) => {
      // Параллельные загрузки не нужны: ответ любой из них уже покрывает
      // период пропуска.
      if (loadingNow) return;
      loadingNow = true;
      if (initial) setLoading(true);
      try {
        const history = await loadHistoryRef.current(rangeKey);
        if (cancelled) return;
        lastPollRef.current = Date.now();
        setSamples((previous) => {
          if (initial) return history;
          // Живые точки, пришедшие, пока шла загрузка, новее истории — их
          // не теряем.
          const lastHistoryTime = history.length > 0 ? history[history.length - 1].time : -Infinity;
          return [...history, ...previous.filter((sample) => sample.time > lastHistoryTime)];
        });
        setError(null);
      } catch (err) {
        if (!cancelled && initial) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить историю метрик");
        }
      } finally {
        loadingNow = false;
        if (!cancelled && initial) setLoading(false);
      }
    };

    reloadRef.current = () => void load(false);
    void load(true);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void load(false);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      reloadRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [rangeKey, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const missedPollMs = Math.max(MIN_MISSED_POLL_MS, intervalMs * MISSED_POLL_FACTOR);

    const tick = async () => {
      // Таймер скрытой вкладки замедлен, во сне не идёт вовсе: такой пропуск
      // виден как давний последний ответ — живыми точками его не заполнить.
      if (Date.now() - lastPollRef.current > missedPollMs) reloadRef.current?.();
      try {
        const value = await pollLiveRef.current();
        if (cancelled) return;
        lastPollRef.current = Date.now();
        if (value === null) return;
        const now = Date.now();
        setSamples((previous) => {
          const appended = [...previous, { time: now, value, stepMs: intervalMs }];
          return windowMsOfRange === null ? appended : appended.filter((s) => now - s.time <= windowMsOfRange);
        });
      } catch {
        // Пропущенный такт — одна недостающая точка; график продолжает
        // показывать то, что уже загружено. Долгая серия сбоев перезагрузит
        // историю на первом успешном такте после неё (см. выше).
      }
    };

    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs, enabled, windowMsOfRange]);

  const oldest = samples.length > 0 ? samples[0].time : Date.now();
  const windowMs = windowMsOfRange ?? Math.max(HOUR_MS, Date.now() - oldest);

  return { samples, windowMs, loading, error };
}

const RANGE_STORAGE_KEY = "llm-launcher.metrics-range";

/** Выбор диапазона переживает переходы между разделами, но остаётся делом
 * вкладки: localStorage может быть недоступен (приватное окно), и тогда
 * работает значение по умолчанию. */
export function readStoredMetricsRange(): MetricsRangeKey {
  try {
    const stored = window.localStorage.getItem(RANGE_STORAGE_KEY);
    if (stored && METRICS_RANGES.some((range) => range.key === stored)) {
      return stored as MetricsRangeKey;
    }
  } catch {
    // недоступный localStorage — не причина ломать график
  }
  return DEFAULT_METRICS_RANGE;
}

export function storeMetricsRange(key: MetricsRangeKey): void {
  try {
    window.localStorage.setItem(RANGE_STORAGE_KEY, key);
  } catch {
    // см. readStoredMetricsRange
  }
}
