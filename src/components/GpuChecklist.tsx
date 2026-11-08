import { formatBytes } from "../lib/formatBytes";

/** One selectable card. `name`/byte counts are null when NVML is down: the
 * choice stays available, only the metrics are missing (spec: недоступность
 * NVML — деградация). */
export interface GpuChecklistItem {
  gpu_id: number;
  name: string | null;
  used_bytes: number | null;
  total_bytes: number | null;
  /** Assigned to this inference but no longer in the GPU pool — shown so
   * saving the form can't silently drop an existing assignment. */
  outOfPool?: boolean;
}

/** The GPU checkbox list of /settings/cpu-gpu, shared with the inference
 * page so both screens pick cards the same way. */
export function GpuChecklist({
  items,
  selected,
  onToggle,
  nvmlError,
}: {
  items: GpuChecklistItem[];
  selected: Set<number>;
  onToggle: (gpuId: number) => void;
  nvmlError?: string | null;
}) {
  return (
    <div data-testid="gpu-checklist">
      <div className="text-[11px] font-['Space_Grotesk'] uppercase text-neutral-500 mb-2">
        Видеокарты ({selected.size} из {items.length} выбрано)
      </div>
      {nvmlError && (
        <div className="text-[10px] text-warn font-mono mb-2" data-testid="gpu-checklist-nvml-error">
          ⚠ метрики видеокарт недоступны: {nvmlError}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {items.map((gpu) => (
          <label key={gpu.gpu_id} className="flex items-center gap-2 text-xs text-neutral-300">
            <input
              type="checkbox"
              className="accent-primary"
              checked={selected.has(gpu.gpu_id)}
              onChange={() => onToggle(gpu.gpu_id)}
              data-testid={`gpu-checkbox-${gpu.gpu_id}`}
            />
            GPU {gpu.gpu_id}
            {gpu.name && ` — ${gpu.name}`}
            {gpu.used_bytes !== null && gpu.total_bytes !== null && (
              <span className="text-neutral-600 font-mono text-[10px]">
                ({formatBytes(gpu.total_bytes - gpu.used_bytes)} свободно)
              </span>
            )}
            {gpu.outOfPool && (
              <span className="text-warn font-mono text-[10px] uppercase" data-testid={`gpu-out-of-pool-${gpu.gpu_id}`}>
                вне пула
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}
