import { METRICS_RANGES, type MetricsRangeKey } from "../hooks/useMetricsSeries";

/** Выбор диапазона на месте прежней подписи «окно: 1ч». Выбор — дело
 * вкладки, не серверная настройка, поэтому хранится в localStorage
 * (useStoredMetricsRange). */
export function MetricsRangePicker({
  value,
  onChange,
  testId,
}: {
  value: MetricsRangeKey;
  onChange: (next: MetricsRangeKey) => void;
  testId?: string;
}) {
  return (
    <span className="flex items-center gap-1" data-testid={testId}>
      <span className="text-[10px] font-mono text-neutral-600 uppercase mr-1">окно:</span>
      {METRICS_RANGES.map((range) => (
        <button
          key={range.key}
          type="button"
          data-testid={`metrics-range-${range.key}`}
          aria-pressed={range.key === value}
          onClick={() => onChange(range.key)}
          className={`text-[10px] font-mono uppercase px-2 py-1 border ${
            range.key === value
              ? "border-primary text-primary"
              : "border-neutral-800 text-neutral-500 hover:text-neutral-300"
          }`}
        >
          {range.label}
        </button>
      ))}
    </span>
  );
}
