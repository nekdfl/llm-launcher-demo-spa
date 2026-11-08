import { useState } from "react";
import { Link } from "react-router-dom";
import type { ComposedStatus, GpuStatusEntry } from "../api/types";
import { formatBytes } from "../lib/formatBytes";
import { presentStatus, statusLineClass } from "../lib/status";

/** An inference occupying this card right now: assigned to it by its launch
 * parameters and not stopped. A stopped one occupies nothing and is left out
 * upstream (DashboardPage.inferencesByGpu). */
export interface GpuCardInference {
  id: string;
  name: string;
  status: ComposedStatus["status"];
}


/** Поле, которого карта не сообщила, читается как «нет данных» — ноль был бы
 * утверждением (0 МБ/с у простаивающей карты законен, 0 % вентилятора у
 * карты без управляемого вентилятора — нет). */
const NO_DATA = "н/д";

function formatRate(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null) return NO_DATA;

  const mib = bytesPerSecond / 1024 ** 2;
  if (mib >= 1) return `${mib.toFixed(0)} MB/s`;

  const kib = bytesPerSecond / 1024;
  if (kib >= 1) return `${kib.toFixed(0)} KB/s`;

  return `${bytesPerSecond.toFixed(0)} B/s`;
}

function formatNumber(value: number | null, unit: string): string {
  return value === null ? NO_DATA : `${value} ${unit}`;
}

function formatWatts(draw: number | null, limit: number | null): string {
  if (draw === null && limit === null) return NO_DATA;
  const left = draw === null ? NO_DATA : draw.toFixed(0);
  const right = limit === null ? NO_DATA : limit.toFixed(0);
  return `${left} / ${right} W`;
}

/** Текущее значение рядом с максимальным: просадка PCIe должна читаться как
 * просадка, а не как абсолютное число. */
function formatLink(current: number | null, max: number | null, prefix: string): string {
  if (current === null && max === null) return NO_DATA;
  const left = current === null ? NO_DATA : `${prefix}${current}`;
  const right = max === null ? NO_DATA : `${prefix}${max}`;
  return `${left} / ${right}`;
}

function TelemetryRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-neutral-500 uppercase">{label}</span>
      <span className="text-neutral-300 truncate" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

/** Matches reference/dashboard/code.html's GPU card, plus the expandable
 * list of inferences bound to the card. */
export function GpuCard({ entry, inferences }: { entry: GpuStatusEntry; inferences: GpuCardInference[] }) {
  const [expanded, setExpanded] = useState(false);
  const used = entry.used_bytes ?? 0;
  const total = entry.total_bytes ?? 0;
  const fillPercent = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const barClass = fillPercent >= 50 ? "bg-primary" : fillPercent > 0 ? "bg-warn" : "bg-neutral-700";

  return (
    <div className="bg-surface-container-low" data-testid={`gpu-card-${entry.gpu_id}`}>
      <button
        type="button"
        className="w-full text-left p-4 hover:bg-surface-container transition-colors"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        data-testid={`gpu-card-toggle-${entry.gpu_id}`}
      >
        <div className="flex justify-between items-center mb-2">
          <span className="font-['Space_Grotesk'] text-sm font-bold">GPU {entry.gpu_id}</span>
          <span className="flex items-center gap-2">
            {entry.discrepancy && (
              <span className="text-[10px] text-warn font-mono uppercase" data-testid="gpu-discrepancy">
                расхождение
              </span>
            )}
            <span className="material-symbols-outlined text-base text-neutral-500">
              {expanded ? "expand_less" : "expand_more"}
            </span>
          </span>
        </div>
        <div className="text-xs text-neutral-400 font-mono mb-1">
          {entry.used_bytes !== null ? `${formatBytes(entry.used_bytes)} / ${formatBytes(entry.total_bytes)}` : "нет данных NVML"}
        </div>
        <div className="h-1.5 bg-neutral-800 mb-3">
          <div className={`h-full ${barClass}`} style={{ width: `${fillPercent}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-neutral-500 font-mono uppercase mb-3">
          <span>util {entry.utilization_percent ?? "—"}%</span>
          <span>{entry.temperature_c ?? "—"}°C</span>
        </div>

        <div
          className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono"
          data-testid={`gpu-card-telemetry-${entry.gpu_id}`}
        >
          <TelemetryRow
            label="карта"
            value={entry.name ?? NO_DATA}
            testId={`gpu-name-${entry.gpu_id}`}
          />
          <TelemetryRow
            label="pcie"
            value={`${formatLink(entry.pcie_gen_current, entry.pcie_gen_max, "gen")} · ${formatLink(
              entry.pcie_width_current,
              entry.pcie_width_max,
              "x"
            )}`}
            testId={`gpu-pcie-${entry.gpu_id}`}
          />
          <TelemetryRow
            label="rx / tx"
            value={`${formatRate(entry.pcie_rx_bytes_per_sec)} / ${formatRate(entry.pcie_tx_bytes_per_sec)}`}
            testId={`gpu-throughput-${entry.gpu_id}`}
          />
          <TelemetryRow
            label="clk gpu / mem"
            value={`${formatNumber(entry.graphics_clock_mhz, "")} / ${formatNumber(entry.memory_clock_mhz, "MHz")}`}
            testId={`gpu-clocks-${entry.gpu_id}`}
          />
          <TelemetryRow
            label="вентилятор"
            value={formatNumber(entry.fan_speed_percent, "%")}
            testId={`gpu-fan-${entry.gpu_id}`}
          />
          <TelemetryRow
            label="мощность"
            value={formatWatts(entry.power_draw_watts, entry.power_limit_watts)}
            testId={`gpu-power-${entry.gpu_id}`}
          />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-neutral-900 px-4 py-3" data-testid={`gpu-card-inferences-${entry.gpu_id}`}>
          <div className="text-[10px] font-['Space_Grotesk'] uppercase text-neutral-500 mb-2">
            Inferences на карте
          </div>
          {inferences.length === 0 ? (
            <div className="text-[11px] font-mono text-neutral-500" data-testid={`gpu-card-no-inferences-${entry.gpu_id}`}>
              {used > 0
                ? "Моделей на карте нет — VRAM занята процессами вне стенда."
                : "Моделей на карте нет."}
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {inferences.map((inference) => (
                <li key={inference.id} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={`w-1 h-4 shrink-0 ${statusLineClass(inference.status)}`} />
                    <Link
                      to={`/inferences/${inference.id}`}
                      className="font-['Space_Grotesk'] text-xs font-bold truncate hover:text-primary"
                    >
                      {inference.name}
                    </Link>
                  </span>
                  <span className="text-[10px] font-mono uppercase text-neutral-500 shrink-0">
                    {presentStatus(inference.status).label}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
