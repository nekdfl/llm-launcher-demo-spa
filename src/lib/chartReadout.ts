import type { TimeSeriesSample } from "../components/TimeSeriesChart";

/** Чтение ряда в произвольной точке времени.
 *
 * Значение читается по той же линии, что нарисована: ряд разбит на непрерывные
 * отрезки (`lib/chartGaps.ts`), и интерполяция возможна только внутри отрезка.
 * Между отрезками данных нет — вернуть ноль значило бы нарисовать выдуманное
 * значение в провале (spec: «точка внутри разрыва читается как отсутствие
 * значения»).
 */
export interface ChartReadout {
  time: number;
  /** Значение по ключу серии; отсутствует, если в этой точке данных нет. */
  values: Record<string, number>;
}

export interface Segment {
  times: number[];
  samples: TimeSeriesSample[];
}

/** Разбиение на непрерывные отрезки по уже известным сегментам компонента. */
export function segmentsFrom(segments: TimeSeriesSample[][]): Segment[] {
  return segments.map((samples) => ({ times: samples.map((s) => s.time), samples }));
}

function interpolateAt(segment: Segment, time: number): Record<string, number> | null {
  const { times, samples } = segment;
  if (samples.length === 0) return null;
  if (time < times[0] || time > times[times.length - 1]) return null;

  // Бинарный поиск правого соседа: на длинном ряде (неделя, «всё время»)
  // линейный проход на каждое движение курсора заметен.
  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (times[middle] < time) low = middle + 1;
    else high = middle;
  }

  const right = low;
  if (times[right] === time || right === 0) return samples[right].values;

  const left = right - 1;
  const span = times[right] - times[left];
  const fraction = span > 0 ? (time - times[left]) / span : 0;

  const values: Record<string, number> = {};
  for (const [key, leftValue] of Object.entries(samples[left].values)) {
    const rightValue = samples[right].values[key];
    values[key] = rightValue === undefined
      ? leftValue
      : leftValue + (rightValue - leftValue) * fraction;
  }
  return values;
}

/** Значения ряда во время `time` или null, если в этой точке отсчётов нет. */
export function readAtTime(segments: Segment[], time: number): ChartReadout | null {
  for (const segment of segments) {
    const values = interpolateAt(segment, time);
    if (values) return { time, values };
  }
  return null;
}
