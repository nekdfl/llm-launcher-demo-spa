import { useMemo, useRef, useState } from "react";
import { splitSeriesSegments } from "../lib/chartGaps";
import { readAtTime, segmentsFrom } from "../lib/chartReadout";

export interface SeriesConfig {
  key: string;
  label: string;
  color: string;
  dash?: string;
  /** Ось значений серии: правая — для второй величины на том же полотне
   * (мощность рядом с tok/s). По умолчанию левая. */
  axis?: "left" | "right";
}

export interface TimeSeriesSample {
  time: number;
  values: Record<string, number>;
  /** Ожидаемый шаг источника точки — порог разрыва (lib/chartGaps.ts). */
  stepMs?: number;
}

interface TimeSeriesChartProps {
  samples: TimeSeriesSample[];
  series: SeriesConfig[];
  yMax: number;
  yMaxLabel: string;
  formatValue?: (value: number) => string;
  /** Правая ось значений: верх шкалы, подпись и формат серий с `axis: "right"`.
   * Без `yMaxRight` правая ось не рисуется. */
  yMaxRight?: number;
  yMaxRightLabel?: string;
  formatValueRight?: (value: number) => string;
  /** Ширина окна графика. По умолчанию час — исходное поведение. */
  windowMs?: number;
  /** Формат метки времени читаемой точки (абсолютное время). */
  formatTime?: (time: number) => string;
  /** Единица величины — для легенды в подсказке. */
  unitLabel?: string;
  /**
   * Одна строка-перечисление под курсором вместо панели в углу. Группы
   * собираются по смыслу величины (hdd — пара «чтение/запись», net — пара
   * «приём/отдача»), поэтому фрагмент описывает группу, а не отдельную серию.
   * `values === undefined` — в этой точке отсчётов нет (разрыв).
   */
  readoutGroups?: (
    readout: { time: number; values: Record<string, number> } | null
  ) => Array<{ key: string; text: string; color: string }>;
}

const PLOT_LEFT = 40;
const PLOT_RIGHT = 590;
/** С правой осью справа нужно место под её подписи. */
const PLOT_RIGHT_WITH_AXIS = 556;
const PLOT_TOP = 10;
const PLOT_BOTTOM = 156;
/** Насколько последний отсчёт серии может отставать от последнего отсчёта
 * полотна, чтобы считаться «текущим»: живые опросы величин не синхронны. */
const LAST_MARKER_SLACK_MS = 15_000;
const TICK_COUNT = 13; // 13 отметок на окно: 5-минутные шаги на часовом (spec)
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Отметки времени соответствуют выбранному диапазону: на часовом окне —
 * минуты, на суточном — часы, на недельном и «всё время» — дни. */
function formatTickLabel(msAgo: number, windowMs: number): string {
  if (msAgo <= 0) return "сейчас";
  if (windowMs <= HOUR_MS) return `-${Math.round(msAgo / 60000)}м`;
  if (windowMs <= DAY_MS) return `-${Math.round(msAgo / HOUR_MS)}ч`;
  const days = msAgo / DAY_MS;
  return days < 1 ? `-${Math.round(msAgo / HOUR_MS)}ч` : `-${days.toFixed(days < 10 ? 1 : 0)}д`;
}

/** Абсолютное время читаемой точки: разрешение по выбранному окну. */
export function formatReadoutTime(time: number, windowMs: number): string {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (windowMs <= HOUR_MS) return `${clock}:${pad(date.getSeconds())}`;
  const day = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
  if (windowMs <= 7 * DAY_MS) return `${day} ${clock}`;
  return `${day}.${date.getFullYear()} ${clock}`;
}

/** Непрерывные отрезки ряда — те же, что потом рисуются линиями, поэтому
 * прочитанное значение совпадает с нарисованным. */
function sampleSegments(samples: TimeSeriesSample[], windowStart: number): TimeSeriesSample[][] {
  const visible = samples.filter((sample) => sample.time >= windowStart);
  return splitSeriesSegments(
    visible.map((sample) => ({ time: sample.time, value: sample, stepMs: sample.stepMs }))
  ).map(
    (segment) => segment.map((item) => item.value)
  );
}

/** Геометрия графика и подписи осей совпадают с reference/dashboard.
 *
 * Наведение читает значение в позиции курсора, а не на ближайшей отметке оси:
 * отметки остаются только разметкой, а точка чтения определяется указателем.
 * Значение берётся по отрисованной линии (lib/chartReadout.ts) — внутри
 * непрерывного отрезка интерполяцией, в разрыве данных значения нет. */
export function TimeSeriesChart({
  samples,
  series,
  yMax,
  yMaxLabel,
  formatValue = (v) => String(Math.round(v)),
  yMaxRight,
  yMaxRightLabel,
  formatValueRight,
  windowMs = HOUR_MS,
  formatTime,
  unitLabel,
  readoutGroups,
}: TimeSeriesChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const hasRightAxis = yMaxRight !== undefined && series.some((s) => s.axis === "right");
  const plotRight = hasRightAxis ? PLOT_RIGHT_WITH_AXIS : PLOT_RIGHT;
  const [pointer, setPointer] = useState<{ x: number; readout: ReturnType<typeof readAtTime> } | null>(null);

  const now = samples.length > 0 ? samples[samples.length - 1].time : Date.now();
  const windowStart = now - windowMs;
  const visibleSamples = samples.filter((s) => s.time >= windowStart);

  const ticks = useMemo(
    () =>
      Array.from({ length: TICK_COUNT }, (_, i) => {
        const fraction = i / (TICK_COUNT - 1);
        const time = windowStart + fraction * windowMs;
        const x = PLOT_LEFT + fraction * (plotRight - PLOT_LEFT);
        return { time, x, label: formatTickLabel(now - time, windowMs) };
      }),
    [windowStart, now, windowMs, plotRight]
  );

  const segmentsBySeries = useMemo(
    () =>
      series.map((s) =>
        segmentsFrom(
          sampleSegments(visibleSamples.filter((sample) => sample.values[s.key] !== undefined), windowStart)
        )
      ),
    [samples, windowStart, series]
  );

  if (visibleSamples.length === 0) {
    return (
      <div className="text-xs text-neutral-600 font-mono py-8 text-center" data-testid="chart-empty">
        Недостаточно данных — график заполнится по мере опроса
      </div>
    );
  }

  const xFor = (time: number) => PLOT_LEFT + ((time - windowStart) / windowMs) * (plotRight - PLOT_LEFT);
  // Значение выше верха шкалы упирается в край области; панель чтения берёт
  // фактическое значение из ряда, а не из нарисованной высоты.
  const yFor = (value: number, axis: SeriesConfig["axis"] = "left") => {
    const max = axis === "right" && yMaxRight !== undefined ? yMaxRight : yMax;
    return PLOT_BOTTOM - (Math.min(Math.max(value, 0), max) / max) * (PLOT_BOTTOM - PLOT_TOP);
  };
  const timeFor = (x: number) => windowStart + ((x - PLOT_LEFT) / (plotRight - PLOT_LEFT)) * windowMs;

  /** Каждая серия читается по своим отрезкам: у рядов, слитых из разных
   * источников (tok/s и мощность), отсчёты не совпадают по времени, и общий
   * ряд давал бы «нет данных» между отсчётами одной из величин. */
  const readAt = (time: number): ReturnType<typeof readAtTime> => {
    const values: Record<string, number> = {};
    series.forEach((s, index) => {
      const value = readAtTime(segmentsBySeries[index], time)?.values[s.key];
      if (value !== undefined) values[s.key] = value;
    });
    return Object.keys(values).length > 0 ? { time, values } : null;
  };

  /** Экранные пиксели → координаты viewBox. Позиция квантуется пикселем
   * графика: меньшего разрешения экран не различает, а искусственный шаг
   * вернул бы прежнюю «липкость» курсора к отметкам. */
  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * 600;
    if (x < PLOT_LEFT || x > plotRight) {
      setPointer(null);
      return;
    }
    setPointer({ x, readout: readAt(timeFor(x)) });
  };

  const last = visibleSamples[visibleSamples.length - 1];
  const readoutTime = pointer?.readout ? pointer.readout.time : null;
  const tipHeight = 22 + series.length * 11;
  const tipLines = series.map((s) => {
    const value = pointer?.readout?.values[s.key];
    return {
      key: s.key,
      color: s.color,
      text: `${s.label}: ${
        value === undefined
          ? "нет данных"
          : (s.axis === "right" && formatValueRight ? formatValueRight : formatValue)(value)
      }`,
    };
  });

  // Перечисление под курсором: группы по смыслу величины, фрагменты цветом
  // своих линий. Ширина оценивается по числу символов, чтобы строка не
  // выезжала за область при курсоре у края.
  const readoutLine = readoutGroups ? readoutGroups(pointer?.readout ?? null) : null;
  const readoutJoined = readoutLine ? readoutLine.map((group) => group.text).join(", ") : "";
  const readoutHalfWidth = (readoutJoined.length * 5.2) / 2;
  const readoutX = pointer
    ? Math.min(Math.max(pointer.x, PLOT_LEFT + readoutHalfWidth), plotRight - readoutHalfWidth)
    : 0;
  const readoutStamp = readoutTime === null
    ? "нет данных"
    : (formatTime ?? ((t: number) => formatReadoutTime(t, windowMs)))(readoutTime);

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 600 205"
      className="w-full aspect-[600/205]"
      role="img"
      aria-label="график"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setPointer(null)}
      data-testid="time-series-chart"
    >
      <line x1={PLOT_LEFT} y1={PLOT_TOP} x2={PLOT_LEFT} y2={PLOT_BOTTOM} stroke="#2a2a2a" strokeWidth={1} />
      <line x1={PLOT_LEFT} y1={PLOT_BOTTOM} x2={plotRight} y2={PLOT_BOTTOM} stroke="#2a2a2a" strokeWidth={1} />
      {hasRightAxis ? (
        <g data-testid="chart-right-axis">
          <line x1={plotRight} y1={PLOT_TOP} x2={plotRight} y2={PLOT_BOTTOM} stroke="#2a2a2a" strokeWidth={1} />
          <text x={plotRight + 4} y={16} fontSize={9} fill="#8b9cb3" fontFamily="monospace">
            {yMaxRightLabel ?? String(yMaxRight)}
          </text>
          <text x={plotRight + 4} y={160} fontSize={9} fill="#8b9cb3" fontFamily="monospace">
            0
          </text>
        </g>
      ) : null}
      <text x={12} y={16} fontSize={9} fill="#8b9cb3" fontFamily="monospace">
        {yMaxLabel}
      </text>
      <text x={18} y={160} fontSize={9} fill="#8b9cb3" fontFamily="monospace">
        0
      </text>
      {unitLabel && !readoutGroups ? (
        <text x={12} y={196} fontSize={8} fill="#6b7a90" fontFamily="monospace">
          {unitLabel}
        </text>
      ) : null}

      {ticks.map((tick, i) => (
        <g key={`axis-${i}`}>
          <line x1={tick.x} y1={PLOT_BOTTOM} x2={tick.x} y2={PLOT_BOTTOM + 4} stroke="#3c3c3c" strokeWidth={1} />
          <text
            x={tick.x}
            y={PLOT_BOTTOM + 6}
            fontSize={8}
            fill="#8b9cb3"
            fontFamily="monospace"
            textAnchor="end"
            transform={`rotate(-90 ${tick.x} ${PLOT_BOTTOM + 6})`}
          >
            {tick.label}
          </text>
        </g>
      ))}

      {series.map((s, seriesIndex) => (
        <g key={s.key}>
          {/* Каждый непрерывный отрезок — своя polyline: период без данных
              остаётся разрывом, а не прямой через весь провал. Отрезки
              считаются по наличию ключа серии: точка без значения серии —
              разрыв её линии, а не ноль. */}
          {segmentsBySeries[seriesIndex].map((segment, index) => (
            <polyline
              key={`${s.key}-${index}`}
              data-testid="chart-line-segment"
              points={segment.samples
                .map((sample) => `${xFor(sample.time)},${yFor(sample.values[s.key] ?? 0, s.axis)}`)
                .join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth={0.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={s.dash}
            />
          ))}
          {/* Маркер — на последнем отсчёте именно этой серии и только если
              он же последний отсчёт полотна: в слитом ряду последней может
              оказаться точка другой величины, а не разрыв. */}
          {(() => {
            const segments = segmentsBySeries[seriesIndex];
            const lastSegment = segments[segments.length - 1]?.samples ?? [];
            const tail = lastSegment[lastSegment.length - 1];
            if (!tail || last.time - tail.time > LAST_MARKER_SLACK_MS) return null;
            return <circle cx={xFor(tail.time)} cy={yFor(tail.values[s.key], s.axis)} r={3} fill={s.color} />;
          })()}
        </g>
      ))}

      {pointer ? (
        <g data-testid="chart-hover">
          <line
            data-testid="chart-cursor"
            x1={pointer.x}
            y1={PLOT_TOP}
            x2={pointer.x}
            y2={PLOT_BOTTOM}
            stroke="#8b9cb3"
            strokeWidth={1}
            strokeDasharray="2,2"
          />
          {readoutLine ? (
            <text
              data-testid="chart-readout"
              x={readoutX}
              y={196}
              fontSize={9}
              fill="#8b9cb3"
              fontFamily="monospace"
              textAnchor="middle"
            >
              <tspan fill="#8b9cb3">{readoutStamp}</tspan>
              {readoutLine.map((group) => (
                <tspan key={group.key} fill={group.color}>
                  {", "}
                  {group.text}
                </tspan>
              ))}
            </text>
          ) : (
            <g>
              <rect x={plotRight - 130} y={12} width={130} height={tipHeight} fill="#2a2a2a" stroke="#3ce36a" strokeWidth={1} />
              <text x={plotRight - 120} y={22} fontSize={9} fill="#e5e2e1" fontFamily="monospace">
                {readoutStamp}
              </text>
              {tipLines.map((line, index) => (
                <text key={line.key} x={plotRight - 120} y={33 + index * 11} fontSize={9} fill={line.color} fontFamily="monospace">
                  {line.text}
                </text>
              ))}
            </g>
          )}
        </g>
      ) : null}
    </svg>
  );
}
