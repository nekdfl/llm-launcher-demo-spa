import type { Sample } from "../hooks/useRollingWindow";
import { colors } from "../theme";
import { TimeSeriesChart, type TimeSeriesSample } from "./TimeSeriesChart";

export interface ThroughputPoint {
  tokensInPerSec: number;
  tokensOutPerSec: number;
}

const SERIES = [
  { key: "in", label: "вход, tok/s", color: colors.chartBlue },
  { key: "out", label: "выход, tok/s", color: colors.chartOrange },
];

/** Sum across all running inferences, one pair of lines — never a chart
 * per model (spec: "не отдельный график на каждую модель"). */
export function ThroughputChart({ samples, windowMs }: { samples: Sample<ThroughputPoint>[]; windowMs?: number }) {
  const chartSamples: TimeSeriesSample[] = samples.map((s) => ({
    time: s.time,
    values: { in: s.value.tokensInPerSec, out: s.value.tokensOutPerSec },
    stepMs: s.stepMs,
  }));

  const peak = Math.max(10, ...samples.map((s) => Math.max(s.value.tokensInPerSec, s.value.tokensOutPerSec)));
  const yMax = Math.ceil((peak * 1.2) / 10) * 10;

  return (
    <TimeSeriesChart
      samples={chartSamples}
      series={SERIES}
      yMax={yMax}
      yMaxLabel={String(yMax)}
      formatValue={(v) => `${Math.round(v)} tok/s`}
      windowMs={windowMs}
    />
  );
}
