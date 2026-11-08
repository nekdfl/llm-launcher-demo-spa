import { Link } from "react-router-dom";
import type { ComposedStatus } from "../api/types";
import { formatBytes } from "../lib/formatBytes";
import { accentClassFor, hasLikelyTraffic, presentStatus } from "../lib/status";
import { DiscrepancyIcon } from "./DiscrepancyIcon";
import { MiniSparkline } from "./MiniSparkline";

export interface InferenceTileData {
  id: string;
  name: string;
  status: ComposedStatus;
  providerName: string;
  engineName: string;
  modelRef: string;
  profileName: string;
  hasDiscrepancy: boolean;
  peakVramBytes: number | null;
  peakRamBytes: number | null;
  throughputInValues: number[];
  throughputOutValues: number[];
  caption: string | null;
  /** Причина негодности модели этого inference; пусто у годной. */
  modelUnusableReason: string | null;
  modelId: number;
}

const DOT_CLASS: Record<ComposedStatus["status"], string> = {
  running: "bg-primary",
  warming: "bg-warn animate-pulse",
  unresponsive: "bg-danger",
  failed: "bg-danger",
  stopped: "bg-neutral-600",
};

/** Неснятый пик — «нет данных», а не ноль: ноль VRAM у работающей модели был
 * бы заведомо неверным утверждением. Пик не снимается, когда NVML недоступен
 * или `MemoryPeak` не отдаётся (старое ядро, cgroup v1). */
function formatPeak(bytes: number | null): string {
  return bytes === null ? "н/д" : formatBytes(bytes);
}

/** Matches reference/dashboard/code.html's inference tile verbatim. */
export function InferenceTile({ data }: { data: InferenceTileData }) {
  const presentation = presentStatus(data.status.status);
  const showSparkline = hasLikelyTraffic(data.status.status);
  const stopped = data.status.status === "stopped";

  return (
    <Link
      to={`/inferences/${data.id}`}
      className={`bg-surface-container-low ${accentClassFor(data.status.status)} p-5 flex flex-col gap-3 hover:bg-surface-container transition-colors ${stopped ? "opacity-70" : ""}`}
    >
      <div className="flex justify-between items-start">
        <span className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${DOT_CLASS[data.status.status]}`} />
          <span className={`font-['Space_Grotesk'] font-bold uppercase text-sm ${stopped ? "text-neutral-400" : ""}`}>
            {presentation.label}
          </span>
        </span>
      </div>

      <div>
        <div className={`font-['Space_Grotesk'] text-lg font-bold ${stopped ? "text-neutral-300" : ""}`}>
          {data.name} {data.hasDiscrepancy && <DiscrepancyIcon />}
        </div>
        {/* Негодность модели видна и здесь, а чинится в карточке самой
            модели — туда и ведёт ссылка. */}
        {data.modelUnusableReason && (
          <div className="text-[10px] font-mono text-danger mt-1" data-testid="inference-model-unusable">
            модель негодна: {data.modelUnusableReason} —{" "}
            <Link
              to={`/models/${data.modelId}`}
              onClick={(event) => event.stopPropagation()}
              className="underline"
            >
              открыть модель
            </Link>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-[10px] font-mono border-t border-neutral-900 pt-2">
        <div>
          <span className="text-neutral-600 uppercase">провайдер</span>
          <br />
          <span className={stopped ? "text-neutral-400" : "text-neutral-300"}>{data.providerName}</span>
        </div>
        <div>
          <span className="text-neutral-600 uppercase">движок</span>
          <br />
          <span className={stopped ? "text-neutral-400" : "text-neutral-300"}>{data.engineName}</span>
        </div>
        <div>
          <span className="text-neutral-600 uppercase">tok/s</span>
          <br />
          {showSparkline ? (
            <MiniSparkline inValues={data.throughputInValues} outValues={data.throughputOutValues} />
          ) : (
            <span className="text-neutral-600" data-testid="tokens-no-traffic">
              —
            </span>
          )}
        </div>
        <div className="col-span-3 truncate">
          <span className="text-neutral-600 uppercase">модель</span>
          <br />
          <span className={stopped ? "text-neutral-400" : "text-neutral-300"}>{data.modelRef}</span>
        </div>
        <div className="col-span-3">
          <span className="text-neutral-600 uppercase">профиль</span>
          <br />
          <span className={stopped ? "text-neutral-400" : "text-primary"}>{data.profileName}</span>
        </div>
      </div>

      <div className={`grid grid-cols-2 gap-2 text-[11px] font-mono ${stopped ? "text-neutral-500" : "text-neutral-400"}`}>
        <div>
          VRAM peak{" "}
          <span className="text-on-surface" data-testid="tile-peak-vram">
            {formatPeak(data.peakVramBytes)}
          </span>
        </div>
        <div>
          RAM peak{" "}
          <span className="text-on-surface" data-testid="tile-peak-ram">
            {formatPeak(data.peakRamBytes)}
          </span>
        </div>
      </div>

      {data.caption && (
        <div
          className={`text-[10px] font-mono uppercase ${data.status.status === "unresponsive" ? "text-danger text-[9px] normal-case" : "text-neutral-600"}`}
        >
          {data.caption}
        </div>
      )}
    </Link>
  );
}
