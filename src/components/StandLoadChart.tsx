import type { Sample } from "../hooks/useRollingWindow";
import type { StandLoadValues } from "../lib/standLoad";
import { colors } from "../theme";
import { formatBitRate, formatByteRate, formatMemory } from "../lib/units";
import { TimeSeriesChart, type TimeSeriesSample } from "./TimeSeriesChart";

// Один canvas «4 в 1»: общая ось времени и один курсор, чтобы события,
// случившиеся в один момент, были сопоставимы без перекладывания взгляда между
// картинками. Величины имеют разные единицы (проценты, объём, байты/с, биты/с),
// поэтому каждая рисуется долей от собственной шкалы: CPU — 0–100%, память —
// весь объём RAM, диск и сеть — ступени по пику окна. Шкала, а не пик окна:
// иначе CPU в 5% и в 100% одинаково доходили бы до верха. Фактические значения
// читаются в панели под курсором.
//
// Направления обмена остаются раздельными линиями: сумма скрывала бы, идёт
// запись на диск или чтение с него (то же для сети). Пара различается стилем
// линии — цветовое разделение для четырёх величин недостаточно при цветовой
// слепоте (docs/design/UI-BEHAVIOR.md §8).

const SERIES = [
  { key: "cpu", label: "cpu", color: colors.chartBlue },
  { key: "mem", label: "mem", color: colors.chartOrange, dash: "4,2" },
  { key: "diskRead", label: "hdd r/w", color: colors.chartGreen },
  { key: "diskWrite", label: "hdd r/w", color: colors.chartGreen, dash: "1,2" },
  { key: "netRecv", label: "net", color: colors.chartPurple },
  { key: "netSent", label: "net", color: colors.chartPurple, dash: "6,2,1,2" },
];

const MIB = 1024 * 1024;
const HOUR_MS = 60 * 60 * 1000;
/** Ступени шкалы сети, Мбит/с (десятичные — как у сетевых интерфейсов). */
const NET_STEPS_MBIT = [1, 10, 50, 100, 500, 1000];
/** Ступени шкалы диска, МБ/с — в тех же единицах, что и подпись скорости
 * диска в панели (formatByteRate). */
const DISK_STEPS_MB = [300, 600, 1000];

/** Первая ступень, вмещающая пик; выше верхней — верхняя: линия упирается в
 * край области, фактическое значение остаётся в панели. */
function stepFor(peak: number, steps: number[]): number {
  return steps.find((step) => peak <= step) ?? steps[steps.length - 1];
}

export interface StandLoadScales {
  /** Верх шкалы CPU, %. */
  cpuPercent: number;
  /** Верх шкалы памяти в байтах; null — объём неизвестен, шкала 0–100%. */
  memBytes: number | null;
  /** Верх шкалы диска (чтение и запись), байт/с. */
  diskBytesPerSec: number;
  /** Верх шкалы сети (приём и отдача), байт/с. */
  netBytesPerSec: number;
}

/** Шкалы по отсчётам видимого окна — того же, что отрисует график. */
export function standLoadScales(
  samples: Sample<StandLoadValues>[],
  ramTotalBytes: number | null,
  windowMs: number = HOUR_MS
): StandLoadScales {
  const lastTime = samples.length > 0 ? samples[samples.length - 1].time : 0;
  const visible = samples.filter((sample) => sample.time >= lastTime - windowMs);
  const peak = (read: (value: StandLoadValues) => number) =>
    Math.max(0, ...visible.map((sample) => read(sample.value)));
  const diskPeakMb = peak((v) => Math.max(v.diskRead, v.diskWrite)) / MIB;
  const netPeakMbit = (peak((v) => Math.max(v.netRecv, v.netSent)) * 8) / 1_000_000;
  return {
    cpuPercent: 100,
    memBytes: ramTotalBytes && ramTotalBytes > 0 ? ramTotalBytes : null,
    diskBytesPerSec: stepFor(diskPeakMb, DISK_STEPS_MB) * MIB,
    netBytesPerSec: (stepFor(netPeakMbit, NET_STEPS_MBIT) * 1_000_000) / 8,
  };
}

export interface StandLoadChartsProps {
  samples: Sample<StandLoadValues>[];
  /** Общий объём RAM стенда — верх шкалы памяти; null — шкала 0–100%. */
  ramTotalBytes?: number | null;
  windowMs?: number;
}

/** Загрузка стенда одним графиком: CPU, память, диск (чтение/запись) и сеть
 * (приём/отдача). Линии — доли от шкал величин; реальные значения — в панели
 * под курсором. */
export function StandLoadChart({ samples, ramTotalBytes = null, windowMs }: StandLoadChartsProps) {
  const scales = standLoadScales(samples, ramTotalBytes, windowMs);

  // Память рисуется долей от всего объёма — это и есть процент загрузки RAM,
  // поэтому шкала «весь объём» и шкала «0–100%» дают одну и ту же линию.
  const chartSamples: TimeSeriesSample[] = samples.map((sample) => ({
    time: sample.time,
    stepMs: sample.stepMs,
    values: {
      cpu: sample.value.cpu / scales.cpuPercent,
      mem: sample.value.ramPercent / 100,
      diskRead: sample.value.diskRead / scales.diskBytesPerSec,
      diskWrite: sample.value.diskWrite / scales.diskBytesPerSec,
      netRecv: sample.value.netRecv / scales.netBytesPerSec,
      netSent: sample.value.netSent / scales.netBytesPerSec,
    },
  }));

  // Доли не обрезаются в данных — край области обрезает только отрисовка,
  // поэтому умножение на шкалу восстанавливает фактическое значение и для
  // точки выше шкалы, и для точки между отсчётами.
  const formatMemoryValue = (fraction: number) =>
    scales.memBytes === null ? `${Math.round(fraction * 100)} %` : formatMemory(fraction * scales.memBytes);

  return (
    <TimeSeriesChart
      samples={chartSamples}
      series={SERIES}
      yMax={1}
      yMaxLabel=""
      windowMs={windowMs}
      readoutGroups={(readout) => {
        if (!readout) {
          return [
            { key: "cpu", color: colors.chartBlue, text: "cpu: нет данных" },
            { key: "mem", color: colors.chartOrange, text: "mem: нет данных" },
            { key: "hdd", color: colors.chartGreen, text: "hdd: нет данных" },
            { key: "net", color: colors.chartPurple, text: "net: нет данных" },
          ];
        }
        const actual = (key: string, scale: number) => readout.values[key] * scale;

        return [
          { key: "cpu", color: colors.chartBlue, text: `cpu: ${Math.round(actual("cpu", scales.cpuPercent))} %` },
          { key: "mem", color: colors.chartOrange, text: `mem: ${formatMemoryValue(readout.values.mem)}` },
          {
            key: "hdd",
            color: colors.chartGreen,
            text: `hdd: ${formatByteRate(actual("diskRead", scales.diskBytesPerSec))} / ${formatByteRate(actual("diskWrite", scales.diskBytesPerSec))}`,
          },
          {
            key: "net",
            color: colors.chartPurple,
            text: `net: ${formatBitRate(actual("netRecv", scales.netBytesPerSec))} / ${formatBitRate(actual("netSent", scales.netBytesPerSec))}`,
          },
        ];
      }}
    />
  );
}
