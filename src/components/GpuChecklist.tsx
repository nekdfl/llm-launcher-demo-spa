import { useEffect, useState } from "react";
import { orchestratorApi } from "../api/orchestrator";
import type { HardwareInfo } from "../api/types";
import { formatBytes } from "../lib/formatBytes";
import { CHECKBOX, FIELD_HINT, FIELD_LABEL, selectTile, selectTileLabel } from "./ui";

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

/** GPU tiles (макет `reference/parametres`): shared by /settings/cpu-gpu,
 * the profile, the inference page and the create wizard so every screen
 * picks cards the same way. */
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
      <div className={`${FIELD_LABEL} mb-2`}>
        Видеокарты ({selected.size} из {items.length} выбрано)
      </div>
      {nvmlError && (
        <div className="text-[10px] text-warn font-mono mb-2" data-testid="gpu-checklist-nvml-error">
          ⚠ метрики видеокарт недоступны: {nvmlError}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
        {items.map((gpu) => {
          const checked = selected.has(gpu.gpu_id);
          return (
            <label
              key={gpu.gpu_id}
              className={`flex items-center justify-between gap-3 px-3 py-2.5 ${selectTile(checked)}`}
              data-testid={`gpu-tile-${gpu.gpu_id}`}
            >
              <span className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={checked}
                  onChange={() => onToggle(gpu.gpu_id)}
                  data-testid={`gpu-checkbox-${gpu.gpu_id}`}
                />
                <span className={`font-mono text-xs ${selectTileLabel(checked)}`}>GPU {gpu.gpu_id}</span>
              </span>
              <span className="flex flex-col items-end text-right">
                {gpu.name && <span className="text-[11px] text-neutral-300">{gpu.name.replace(/^NVIDIA (GeForce )?/, "")}</span>}
                {gpu.used_bytes !== null && gpu.total_bytes !== null && (
                  <span className={FIELD_HINT}>{formatBytes(gpu.total_bytes - gpu.used_bytes)} своб.</span>
                )}
                {gpu.outOfPool && (
                  <span className="text-warn font-mono text-[10px] uppercase" data-testid={`gpu-out-of-pool-${gpu.gpu_id}`}>
                    вне пула
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** Плитки для выбора карт inference/профиля: предлагаются карты пула
 * (/settings/cpu-gpu), имена и метрики — из hardware-info. Уже выбранная
 * карта, выпавшая из пула, остаётся в списке с пометкой — иначе сохранение
 * формы молча стёрло бы её назначение. */
export function useGpuChecklistItems(selected: number[]): { items: GpuChecklistItem[]; nvmlError: string | null } {
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [gpuPool, setGpuPool] = useState<number[] | null>(null);

  useEffect(() => {
    orchestratorApi
      .getHardwareInfo()
      .then(setHardware)
      .catch(() => setHardware(null));
    orchestratorApi
      .getResourceSettings()
      .then((settings) => setGpuPool(settings.gpu_pool))
      .catch(() => setGpuPool(null));
  }, []);

  const detectedGpuById = new Map((hardware?.gpus ?? []).map((gpu) => [gpu.gpu_id, gpu]));
  const poolGpuIds = gpuPool ?? [];
  const items = [...poolGpuIds, ...selected.filter((gpuId) => !poolGpuIds.includes(gpuId))]
    .sort((left, right) => left - right)
    .map((gpuId) => {
      const detected = detectedGpuById.get(gpuId);
      return {
        gpu_id: gpuId,
        name: detected?.name ?? null,
        used_bytes: detected?.used_bytes ?? null,
        total_bytes: detected?.total_bytes ?? null,
        outOfPool: gpuPool !== null && !poolGpuIds.includes(gpuId),
      };
    });
  return { items, nvmlError: hardware?.nvml_error ?? null };
}

/** Переключение карты в отсортированном списке номеров. */
export function toggleGpuId(selected: number[], gpuId: number): number[] {
  return selected.includes(gpuId) ? selected.filter((id) => id !== gpuId) : [...selected, gpuId].sort((left, right) => left - right);
}
