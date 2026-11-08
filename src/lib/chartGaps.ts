import type { Sample } from "../hooks/useRollingWindow";

/** Минимальный разрыв, который считается разрывом: меньше — обычное
 * дрожание интервала опроса. */
const MIN_GAP_MS = 15_000;
const GAP_FACTOR = 3;

function medianDelta(times: number[]): number {
  if (times.length < 2) return 0;
  const deltas = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

/** Делит ряд на непрерывные отрезки по разрывам во времени.
 *
 * Отсутствие данных (оркестратор был остановлен, модель не работала) должно
 * рисоваться разрывом линии, а не нулями и не прямой через весь провал —
 * поэтому каждый отрезок рисуется своей polyline.
 *
 * Порог разрыва — по ожидаемому шагу источника соседних точек (`stepMs`),
 * а не по медиане всего ряда (chart-gaps-by-source-step): в ряду смешаны
 * история с шагом прореживания в минуты и живые точки раз в 2 с, и когда
 * живых становилось больше, медиана падала до 2 с, а вся история
 * рассыпалась на одиночные точки. На стыке источников берётся больший шаг.
 * Без шага у обеих точек — прежний порог по медиане. */
export function splitSeriesSegments<T>(samples: Sample<T>[]): Sample<T>[][] {
  if (samples.length === 0) return [];

  const medianThreshold = Math.max(MIN_GAP_MS, medianDelta(samples.map((sample) => sample.time)) * GAP_FACTOR);
  const thresholdFor = (previous: Sample<T>, current: Sample<T>) => {
    const step = Math.max(previous.stepMs ?? 0, current.stepMs ?? 0);
    return step > 0 ? Math.max(MIN_GAP_MS, step * GAP_FACTOR) : medianThreshold;
  };
  const segments: Sample<T>[][] = [[samples[0]]];

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (current.time - previous.time > thresholdFor(previous, current)) {
      segments.push([current]);
    } else {
      segments[segments.length - 1].push(current);
    }
  }

  return segments;
}
