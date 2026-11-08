import type { Sample } from "../hooks/useRollingWindow";
import { colors } from "../theme";
import type { ThroughputPoint } from "./ThroughputChart";
import { TimeSeriesChart, type SeriesConfig, type TimeSeriesSample } from "./TimeSeriesChart";

/** Цвет линии на карту: палитра графиков ограничена, а синий и оранжевый
 * заняты tok/s на том же полотне — карты получают зелёную и фиолетовую,
 * дальше синюю и оранжевую с пунктиром: стиль линии — вторичное кодирование
 * (UI-BEHAVIOR §8). */
export const GPU_LINE_STYLES = [
  { color: colors.chartGreen, dash: undefined },
  { color: colors.chartPurple, dash: undefined },
  { color: colors.chartBlue, dash: "4,2" },
  { color: colors.chartOrange, dash: "4,2" },
] as const;

/** Самая мощная карта стенда: верх шкалы, пока NVML не сообщил пределы. */
export const DEFAULT_POWER_SCALE_WATTS = 390;
const THROUGHPUT_SCALE_STEP = 50;
const HOUR_MS = 60 * 60 * 1000;

/** Верх шкалы tok/s ступенями по 50: 50, пока пик не превышает 50, дальше —
 * наименьшее кратное 50, вмещающее пик. Без запаса сверху — ступени
 * узнаваемы, и одна высота линии не «плавает» от минуты к минуте. */
export function throughputScaleMax(peak: number): number {
  return Math.max(THROUGHPUT_SCALE_STEP, Math.ceil(peak / THROUGHPUT_SCALE_STEP) * THROUGHPUT_SCALE_STEP);
}

/** Верх шкалы мощности — предел самой мощной карты пула, а не текущее
 * потребление: одинаковая высота всегда значит одинаковые ватты. */
export function powerScaleMax(powerLimitsWatts: Array<number | null>): number {
  const known = powerLimitsWatts.filter((limit): limit is number => limit !== null && limit > 0);
  return known.length > 0 ? Math.max(...known) : DEFAULT_POWER_SCALE_WATTS;
}

const gpuKey = (gpuId: number) => `gpu:${gpuId}`;

/** tok/s и мощность карт на одном полотне: tok/s по левой оси, ватты по
 * правой. Ряды приходят из разных источников и по времени не совпадают —
 * сливаются в общую шкалу без подстановки нулей: точка без ключа серии —
 * разрыв её линии. */
export function ThroughputPowerChart({
  throughput,
  power,
  gpuIds,
  powerLimitsWatts,
  windowMs = HOUR_MS,
}: {
  throughput: Sample<ThroughputPoint>[];
  power: Sample<Record<string, number>>[];
  gpuIds: number[];
  powerLimitsWatts: Array<number | null>;
  windowMs?: number;
}) {
  const series: SeriesConfig[] = [
    { key: "in", label: "вход", color: colors.chartBlue },
    { key: "out", label: "выход", color: colors.chartOrange },
    ...gpuIds.map((gpuId, index) => {
      const style = GPU_LINE_STYLES[index % GPU_LINE_STYLES.length];
      return { key: gpuKey(gpuId), label: `gpu ${gpuId}`, color: style.color, dash: style.dash, axis: "right" as const };
    }),
  ];

  const byTime = new Map<number, Record<string, number>>();
  // Шаг слитой точки — больший из шагов её источников: иначе стык истории
  // одного ряда с живыми точками другого ложно считался бы разрывом.
  const stepByTime = new Map<number, number>();
  const at = (time: number, stepMs?: number) => {
    const values = byTime.get(time) ?? {};
    byTime.set(time, values);
    if (stepMs !== undefined) stepByTime.set(time, Math.max(stepByTime.get(time) ?? 0, stepMs));
    return values;
  };
  for (const sample of throughput) {
    const values = at(sample.time, sample.stepMs);
    values.in = sample.value.tokensInPerSec;
    values.out = sample.value.tokensOutPerSec;
  }
  let hasPower = false;
  if (gpuIds.length > 0) {
    for (const sample of power) {
      const values = at(sample.time, sample.stepMs);
      for (const gpuId of gpuIds) {
        const watts = sample.value[String(gpuId)];
        if (watts !== undefined) {
          values[gpuKey(gpuId)] = watts;
          hasPower = true;
        }
      }
    }
  }
  const chartSamples: TimeSeriesSample[] = [...byTime.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, values]) => ({ time, values, stepMs: stepByTime.get(time) }));

  // Шкала tok/s — по видимому окну, тому же, что отрисует график.
  const lastTime = chartSamples.length > 0 ? chartSamples[chartSamples.length - 1].time : 0;
  const peak = Math.max(
    0,
    ...throughput
      .filter((sample) => sample.time >= lastTime - windowMs)
      .map((sample) => Math.max(sample.value.tokensInPerSec, sample.value.tokensOutPerSec))
  );
  const yMax = throughputScaleMax(peak);
  const yMaxRight = powerScaleMax(powerLimitsWatts);

  return (
    <TimeSeriesChart
      samples={chartSamples}
      series={hasPower ? series : series.filter((s) => s.axis !== "right")}
      yMax={yMax}
      yMaxLabel={String(yMax)}
      formatValue={(v) => `${Math.round(v)} tok/s`}
      yMaxRight={hasPower ? yMaxRight : undefined}
      yMaxRightLabel={`${Math.round(yMaxRight)} W`}
      formatValueRight={(v) => `${Math.round(v)} W`}
      windowMs={windowMs}
    />
  );
}
