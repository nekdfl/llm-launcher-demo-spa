import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { orchestratorApi } from "../api/orchestrator";
import type {
  ComposedStatus,
  EngineInstallation,
  GpuStatusEntry,
  Inference,
  InferenceStatusLabel,
  ModelEntity,
  Profile,
  Provider,
  UnitUnloadResult,
} from "../api/types";
import { GpuCard, type GpuCardInference } from "../components/GpuCard";
import { Modal } from "../components/Modal";
import { InferenceTile, type InferenceTileData } from "../components/InferenceTile";
import { MetricsRangePicker } from "../components/MetricsRangePicker";
import { StandLoadChart, standLoadScales } from "../components/StandLoadChart";
import { formatBitRate, formatByteRate, formatMemory } from "../lib/units";
import { GPU_LINE_STYLES, ThroughputPowerChart } from "../components/ThroughputPowerChart";
import {
  historyStepMs,
  readStoredMetricsRange,
  storeMetricsRange,
  useMetricsSeries,
  type MetricsRangeKey,
} from "../hooks/useMetricsSeries";
import { STATUS_POLL_INTERVAL_MS, usePolling } from "../hooks/usePolling";
import { toStandLoadValues, type StandLoadValues } from "../lib/standLoad";

const CHART_POLL_INTERVAL_MS = 5000;

interface Catalog {
  models: ModelEntity[];
  profiles: Profile[];
  providers: Provider[];
  engineInstallations: EngineInstallation[];
  gpuPool: number[];
  /** Общий объём RAM стенда — чтобы показывать занятую память в объёме,
   * а не только процентом (см. lib/standLoad.ts). */
  ramTotalBytes: number | null;
}

function useCatalog(): Catalog | null {
  const [catalog, setCatalog] = useState<Catalog | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [models, profiles, providers, engineInstallations, settings, hardware] = await Promise.all([
        orchestratorApi.listModels(),
        orchestratorApi.listProfiles(),
        orchestratorApi.listProviders(),
        orchestratorApi.listEngineInstallations(),
        orchestratorApi.getResourceSettings(),
        // Сбой телеметрии железа не должен ронять каталог: без объёма RAM
        // график останется в процентах (lib/standLoad.ts).
        orchestratorApi.getHardwareInfo().catch(() => null),
      ]);
      if (!cancelled) {
        setCatalog({
          models,
          profiles,
          providers,
          engineInstallations,
          gpuPool: settings.gpu_pool,
          ramTotalBytes: hardware?.ram?.total_bytes ?? null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return catalog;
}

interface LiveData {
  inferences: Inference[];
  statuses: Record<string, ComposedStatus>;
  gpuStatus: GpuStatusEntry[];
  // true when GPU telemetry failed this cycle (e.g. NVML unavailable) — the
  // dashboard still renders everything else and the GPU block degrades.
  gpuUnavailable: boolean;
}

function useLiveData(gpuPool: number[] | null): LiveData | null {
  const { data } = usePolling<LiveData>(
    async () => {
      const inferences = await orchestratorApi.listInferences();
      const statusPairs = await Promise.all(
        inferences.map(async (inf) => {
          try {
            return [inf.id, await orchestratorApi.getInferenceStatus(inf.id)] as const;
          } catch {
            return [inf.id, { status: "stopped" as InferenceStatusLabel, color: "gray", gpu_considered_free: true }] as const;
          }
        })
      );
      const statuses = Object.fromEntries(statusPairs) as Record<string, ComposedStatus>;

      const activeIds = inferences.filter((inf) => statuses[inf.id]?.status !== "stopped").map((inf) => inf.id);

      // GPU telemetry degrades on its own (same pattern as the per-inference
      // status catch above): a failed gpu-status (NVML driver mismatch,
      // endpoint 503) must not reject the whole poll and blank the dashboard.
      let gpuStatus: GpuStatusEntry[] = [];
      let gpuUnavailable = false;
      if (gpuPool && gpuPool.length > 0) {
        try {
          gpuStatus = await orchestratorApi.getGpuStatus(gpuPool, activeIds);
        } catch {
          gpuUnavailable = true;
        }
      }

      return { inferences, statuses, gpuStatus, gpuUnavailable };
    },
    STATUS_POLL_INTERVAL_MS,
    gpuPool !== null
  );
  return data;
}

/** Сколько точек держит мини-график в плитке: он показывает недавний
 * характер трафика, а не историю — та живёт на сводном графике. */
const TILE_SERIES_LENGTH = 20;

interface TileSeries {
  inValues: number[];
  outValues: number[];
}

function appendTileThroughput(
  previous: Record<string, TileSeries>,
  inferenceIds: string[],
  sample: Record<string, { tokens_in_per_sec: number; tokens_out_per_sec: number }>
): Record<string, TileSeries> {
  const next: Record<string, TileSeries> = {};
  for (const inferenceId of inferenceIds) {
    const current = previous[inferenceId] ?? { inValues: [], outValues: [] };
    const point = sample[inferenceId];
    // Такта без учтённых токенов в ответе нет вовсе — точка не добавляется,
    // иначе ряд набрался бы нулей, неотличимых от простоя.
    if (!point) {
      next[inferenceId] = current;
      continue;
    }
    next[inferenceId] = {
      inValues: [...current.inValues, point.tokens_in_per_sec].slice(-TILE_SERIES_LENGTH),
      outValues: [...current.outValues, point.tokens_out_per_sec].slice(-TILE_SERIES_LENGTH),
    };
  }
  return next;
}

/** Недавно запущенные — первыми. Никогда не запускавшийся идёт после
 * запускавшихся; при равенстве порядок задаёт имя, чтобы он не зависел от
 * порядка ответа сервера. */
export function sortByRecentLaunch<T extends { name: string; last_started_at: string | null }>(
  inferences: T[]
): T[] {
  return [...inferences].sort((left, right) => {
    const leftTime = left.last_started_at === null ? null : Date.parse(`${left.last_started_at}Z`);
    const rightTime = right.last_started_at === null ? null : Date.parse(`${right.last_started_at}Z`);
    if (leftTime === rightTime) return left.name.localeCompare(right.name);
    if (leftTime === null) return 1;
    if (rightTime === null) return -1;
    return rightTime - leftTime;
  });
}

function captionFor(status: InferenceStatusLabel): string | null {
  switch (status) {
    case "warming":
      return "нет трафика — модель ещё не готова";
    case "unresponsive":
      return "трафик прекратился";
    case "failed":
      return "процесс упал";
    case "stopped":
      return "остановлен — трафика нет";
    default:
      return null;
  }
}

const UNLOAD_OUTCOME_LABELS: Record<UnitUnloadResult["outcome"], string> = {
  stopped: "остановлен",
  killed: "завершён принудительно",
  failed: "не удалось остановить",
};

export function DashboardPage() {
  const catalog = useCatalog();
  const live = useLiveData(catalog?.gpuPool ?? null);
  // Mass unload touches the whole stand, so it asks first; the per-unit
  // outcome is shown afterwards next to the button that started it.
  const [tileThroughput, setTileThroughput] = useState<Record<string, TileSeries>>({});
  const [unloadConfirmOpen, setUnloadConfirmOpen] = useState(false);
  const [unloadRunning, setUnloadRunning] = useState(false);
  const [unloadResults, setUnloadResults] = useState<UnitUnloadResult[] | null>(null);
  const [unloadError, setUnloadError] = useState<string | null>(null);

  const handleUnloadAll = async () => {
    setUnloadConfirmOpen(false);
    setUnloadError(null);
    setUnloadResults(null);
    setUnloadRunning(true);
    try {
      const result = await orchestratorApi.stopAllInferences();
      setUnloadResults(result.units);
    } catch (err) {
      setUnloadError(err instanceof Error ? err.message : "Не удалось выгрузить модели");
    } finally {
      setUnloadRunning(false);
    }
  };

  const [metricsRange, setMetricsRange] = useState<MetricsRangeKey>(readStoredMetricsRange);
  const changeMetricsRange = (next: MetricsRangeKey) => {
    setMetricsRange(next);
    storeMetricsRange(next);
  };

  const ramTotalBytes = catalog?.ramTotalBytes ?? null;

  const hostLoad = useMetricsSeries<StandLoadValues>({
    loadHistory: async (range) => {
      const history = await orchestratorApi.getHostLoadHistory(range);
      const stepMs = historyStepMs(history.step_seconds);
      return history.points.map((point) => ({
        time: Date.parse(`${point.at}Z`),
        stepMs,
        value: toStandLoadValues(point, ramTotalBytes),
      }));
    },
    pollLive: async () => toStandLoadValues(await orchestratorApi.getHostLoad(), ramTotalBytes),
    rangeKey: metricsRange,
    intervalMs: CHART_POLL_INTERVAL_MS,
    enabled: catalog !== null,
  });

  const runningIds = useMemo(
    () => (live ? live.inferences.filter((inf) => live.statuses[inf.id]?.status === "running").map((inf) => inf.id) : []),
    [live]
  );

  const throughput = useMetricsSeries<{ tokensInPerSec: number; tokensOutPerSec: number }>({
    loadHistory: async (range) => {
      // Без фильтра эндпоинт отдаёт сумму по стенду — ровно то, что рисует
      // сводный график.
      const history = await orchestratorApi.getThroughputHistory(range);
      const stepMs = historyStepMs(history.step_seconds);
      return history.points.map((point) => ({
        time: Date.parse(`${point.at}Z`),
        stepMs,
        value: { tokensInPerSec: point.tokens_in_per_sec, tokensOutPerSec: point.tokens_out_per_sec },
      }));
    },
    pollLive: async () => {
      const result = await orchestratorApi.getInferenceThroughput(runningIds);
      // Тот же ответ питает мини-графики плиток: он уже разложен по
      // inference, поэтому отдельный запрос на плитку не нужен.
      setTileThroughput((previous) => appendTileThroughput(previous, runningIds, result));
      let tokensIn = 0;
      let tokensOut = 0;
      for (const value of Object.values(result)) {
        tokensIn += value.tokens_in_per_sec;
        tokensOut += value.tokens_out_per_sec;
      }
      return { tokensInPerSec: tokensIn, tokensOutPerSec: tokensOut };
    },
    rangeKey: metricsRange,
    intervalMs: CHART_POLL_INTERVAL_MS,
    enabled: live !== null,
  });

  // Мощность GPU: история — с эндпоинта метрик, живые точки — из уже
  // поллящегося GPU-статуса (отдельный запрос не нужен). Такт без значений
  // (NVML не ответил) точки не добавляет: разрыв, а не ноль.
  const gpuPower = useMetricsSeries<Record<string, number>>({
    loadHistory: async (range) => {
      const history = await orchestratorApi.getGpuPowerHistory(range);
      const valuesByTime = new Map<number, Record<string, number>>();
      for (const point of history.points) {
        const time = Date.parse(`${point.at}Z`);
        const values = valuesByTime.get(time) ?? {};
        values[String(point.gpu_id)] = point.power_watts;
        valuesByTime.set(time, values);
      }
      const stepMs = historyStepMs(history.step_seconds);
      return [...valuesByTime.entries()].map(([time, value]) => ({ time, value, stepMs }));
    },
    pollLive: async () => {
      const values: Record<string, number> = {};
      for (const entry of live?.gpuStatus ?? []) {
        if (entry.power_draw_watts !== null) values[String(entry.gpu_id)] = entry.power_draw_watts;
      }
      return Object.keys(values).length > 0 ? values : null;
    },
    rangeKey: metricsRange,
    intervalMs: CHART_POLL_INTERVAL_MS,
    enabled: catalog !== null && catalog.gpuPool.length > 0,
  });

  if (!catalog || !live) {
    return (
      <div className="py-8 text-sm text-neutral-500 font-mono">Загрузка…</div>
    );
  }

  const modelById = new Map(catalog.models.map((m) => [m.id, m]));
  // Легенда показывает те же шкалы, что и график: они зависят от окна.
  const standScales = standLoadScales(hostLoad.samples, ramTotalBytes, hostLoad.windowMs);
  const profileById = new Map(catalog.profiles.map((p) => [p.id, p]));
  const providerById = new Map(catalog.providers.map((p) => [p.id, p]));
  const installationById = new Map(catalog.engineInstallations.map((e) => [e.id, e]));

  const tiles: InferenceTileData[] = sortByRecentLaunch(live.inferences).map((inference) => {
    const model = modelById.get(inference.model_id);
    const profile = profileById.get(inference.profile_id);
    const provider = model ? providerById.get(model.provider_id) : undefined;
    const installation = installationById.get(inference.engine_installation_id);
    const status = live.statuses[inference.id] ?? { status: "stopped" as InferenceStatusLabel, color: "gray", gpu_considered_free: true };

    const hasDiscrepancy = profile
      ? inference.cli_options !== profile.cli_options ||
        inference.system_prompt !== profile.system_prompt ||
        inference.port !== profile.port
      : false;

    return {
      id: inference.id,
      name: inference.name,
      status,
      providerName: provider?.name ?? "—",
      engineName: installation?.name ?? "—",
      modelRef: model?.ref ?? "—",
      modelId: inference.model_id,
      modelUnusableReason:
        inference.model_validity?.usable === false ? inference.model_validity.reason : null,
      profileName: profile?.name ?? "—",
      hasDiscrepancy,
      peakVramBytes: inference.last_run_peak_vram_bytes,
      peakRamBytes: inference.last_run_peak_ram_bytes,
      throughputInValues: tileThroughput[inference.id]?.inValues ?? [],
      throughputOutValues: tileThroughput[inference.id]?.outValues ?? [],
      caption: captionFor(status.status),
    };
  });

  // The card answers "what is on this card now", so a stopped inference is
  // left out — it occupies nothing. Everything else stays, "unresponsive" and
  // "failed" included: those may still be holding the card, and they are
  // exactly what the list has to surface. The binding comes from gpu_ids, not
  // from the card's intended_inference_ids (those are only the ids we asked
  // the GPU status about).
  const inferencesByGpu = (gpuId: number): GpuCardInference[] =>
    live.inferences
      .filter((inference) => inference.gpu_ids.includes(gpuId))
      .map((inference) => ({
        id: inference.id,
        name: inference.name,
        status: live.statuses[inference.id]?.status ?? "stopped",
      }))
      .filter((inference) => inference.status !== "stopped");

  return (
    <div>
      <header className="py-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 bg-primary animate-pulse" />
          <h1 className="font-['Space_Grotesk'] text-3xl font-extrabold tracking-tighter uppercase">Dashboard</h1>
        </div>
        <Link
          to="/inferences/new"
          className="flex items-center gap-2 bg-primary text-black font-['Space_Grotesk'] text-xs font-bold uppercase tracking-widest px-5 py-3 hover:bg-primary/80 transition-all"
        >
          <span className="material-symbols-outlined text-lg">add</span> Создать inference
        </Link>
      </header>

      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-['Space_Grotesk'] text-xs font-bold uppercase tracking-widest text-neutral-500">
            Мониторинг стенда
          </h2>
          <MetricsRangePicker value={metricsRange} onChange={changeMetricsRange} testId="metrics-range" />
        </div>
        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
          <div className="bg-surface-container-low p-5">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <span className="font-['Space_Grotesk'] text-xs font-bold uppercase text-neutral-400">
                Пропускная способность · сумма по всем inferences
              </span>
            </div>
            {/* Одна легенда на общее полотно: tok/s — по левой оси, мощность
                карт — по правой. */}
            <div className="flex items-center gap-3 flex-wrap text-[10px] font-mono text-neutral-500 mb-2" data-testid="throughput-legend">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ background: "#3987e5" }} />
                вход
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ background: "#d95926" }} />
                выход
              </span>
              <span className="text-neutral-600">tok/s, левая ось</span>
              {catalog.gpuPool.length > 0 ? (
                <span className="flex items-center gap-3 flex-wrap" data-testid="gpu-power-legend">
                  {catalog.gpuPool.map((gpuId, index) => {
                    const style = GPU_LINE_STYLES[index % GPU_LINE_STYLES.length];
                    return (
                      <span key={gpuId} className="flex items-center gap-1">
                        <svg width="14" height="2">
                          <line x1="0" y1="1" x2="14" y2="1" stroke={style.color} strokeWidth="2" strokeDasharray={style.dash} />
                        </svg>
                        gpu {gpuId}
                      </span>
                    );
                  })}
                  <span className="text-neutral-600">мощность, W, правая ось</span>
                </span>
              ) : null}
            </div>
            <ThroughputPowerChart
              throughput={throughput.samples}
              power={gpuPower.samples}
              gpuIds={catalog.gpuPool}
              powerLimitsWatts={live.gpuStatus
                .filter((entry) => catalog.gpuPool.includes(entry.gpu_id))
                .map((entry) => entry.power_limit_watts)}
              windowMs={throughput.windowMs}
            />
          </div>
          {/* Размер карточки — как у графика пропускной способности рядом:
              одна колонка сетки, а не растяжение на всю ширину. */}
          <div className="bg-surface-container-low p-5">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <span className="font-['Space_Grotesk'] text-xs font-bold uppercase text-neutral-400">
                Загрузка стенда · хост целиком
              </span>
            </div>
            {/* Легенда называет тип величины рядом с цветом: при четырёх разных
                величинах на одной области цвет без подписи типа не говорит, что
                за линия. Пара направлений различима стилем линии. */}
            <div className="flex items-center gap-3 flex-wrap text-[10px] font-mono text-neutral-500 mb-2">
              <span className="flex items-center gap-1" data-testid="legend-cpu">
                <svg width="14" height="2">
                  <line x1="0" y1="1" x2="14" y2="1" stroke="#3987e5" strokeWidth="2" />
                </svg>
                cpu
              </span>
              <span className="flex items-center gap-1" data-testid="legend-mem">
                <svg width="14" height="2">
                  <line x1="0" y1="1" x2="14" y2="1" stroke="#d95926" strokeWidth="2" strokeDasharray="4,2" />
                </svg>
                mem
              </span>
              <span className="flex items-center gap-1" data-testid="legend-hdd">
                <svg width="14" height="2">
                  <line x1="0" y1="1" x2="14" y2="1" stroke="#199e70" strokeWidth="2" />
                </svg>
                hdd r/w
                <svg width="14" height="2" className="ml-1">
                  <line x1="0" y1="1" x2="14" y2="1" stroke="#199e70" strokeWidth="2" strokeDasharray="1,2" />
                </svg>
              </span>
              <span className="flex items-center gap-1" data-testid="legend-net">
                <svg width="14" height="2">
                  <line x1="0" y1="1" x2="14" y2="1" stroke="#9085e9" strokeWidth="2" />
                </svg>
                net
                <svg width="14" height="2" className="ml-1">
                  <line x1="0" y1="1" x2="14" y2="1" stroke="#9085e9" strokeWidth="2" strokeDasharray="6,2,1,2" />
                </svg>
              </span>
              <span className="text-neutral-600" data-testid="stand-load-scales">
                шкалы: cpu {standScales.cpuPercent} %, mem{" "}
                {standScales.memBytes === null ? "100 %" : formatMemory(standScales.memBytes)}, hdd{" "}
                {formatByteRate(standScales.diskBytesPerSec)}, net {formatBitRate(standScales.netBytesPerSec)}
              </span>
            </div>
            <StandLoadChart samples={hostLoad.samples} ramTotalBytes={ramTotalBytes} windowMs={hostLoad.windowMs} />
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="font-['Space_Grotesk'] text-xs font-bold uppercase tracking-widest text-neutral-500 mb-4">
          Видеокарты // NVML
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-4">
          {live.gpuUnavailable ? (
            <div className="text-xs text-warn font-mono" data-testid="gpu-unavailable">
              GPU-данные недоступны (NVML не отвечает — проверьте драйвер NVIDIA)
            </div>
          ) : live.gpuStatus.length === 0 ? (
            <div className="text-xs text-neutral-600 font-mono">GPU не настроены (Настройки → пул GPU)</div>
          ) : (
            live.gpuStatus.map((entry) => (
              <GpuCard key={entry.gpu_id} entry={entry} inferences={inferencesByGpu(entry.gpu_id)} />
            ))
          )}
        </div>
      </section>

      <section className="mb-10">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h2 className="font-['Space_Grotesk'] text-xs font-bold uppercase tracking-widest text-neutral-500">
            Inferences
          </h2>
          <button
            type="button"
            data-testid="unload-all"
            className="flex items-center gap-2 border border-danger/50 text-danger font-['Space_Grotesk'] text-xs font-bold uppercase tracking-widest px-4 py-2 enabled:hover:bg-danger enabled:hover:text-black transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => setUnloadConfirmOpen(true)}
            disabled={unloadRunning}
          >
            <span className="material-symbols-outlined text-lg">eject</span>
            {unloadRunning ? "Выгрузка…" : "Выгрузить все модели"}
          </button>
        </div>

        {unloadError && (
          <div className="text-xs text-danger font-mono mb-4" data-testid="unload-all-error">
            {unloadError}
          </div>
        )}

        {unloadResults && (
          <div className="bg-surface-container-low p-4 mb-4 text-[11px] font-mono" data-testid="unload-all-report">
            {unloadResults.length === 0 ? (
              <span className="text-neutral-500">Выгружать было нечего — запущенных моделей нет.</span>
            ) : (
              <ul className="flex flex-col gap-1">
                {unloadResults.map((result) => (
                  <li key={result.unit} className="flex items-center justify-between gap-3">
                    <span className="truncate text-neutral-300">{result.unit}</span>
                    <span className={result.outcome === "failed" ? "text-danger shrink-0" : "text-neutral-500 shrink-0"}>
                      {UNLOAD_OUTCOME_LABELS[result.outcome]}
                      {result.detail ? ` — ${result.detail}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <Modal
          open={unloadConfirmOpen}
          onClose={() => setUnloadConfirmOpen(false)}
          title="Выгрузить все модели"
          tone="danger"
          testId="unload-all-confirm"
        >
          <p className="text-xs text-neutral-300 mb-4">
            Все запущенные модели стенда будут остановлены, а не завершившиеся — завершены принудительно. Видеокарты
            освободятся.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              data-testid="unload-all-confirm-yes"
              className="flex-1 py-2 bg-danger/20 border border-danger/50 text-danger font-['Space_Grotesk'] text-xs font-bold uppercase hover:bg-danger hover:text-black"
              onClick={handleUnloadAll}
            >
              Выгрузить
            </button>
            <button
              type="button"
              className="flex-1 py-2 border border-neutral-700 text-neutral-300 font-['Space_Grotesk'] text-xs font-bold uppercase hover:border-primary hover:text-primary"
              onClick={() => setUnloadConfirmOpen(false)}
            >
              Отмена
            </button>
          </div>
        </Modal>

        {tiles.length === 0 ? (
          <div className="text-xs text-neutral-600 font-mono">Нет ни одного inference — создайте первый.</div>
        ) : (
          <div className="grid grid-cols-1 2xl:grid-cols-3 gap-4">
            {tiles.map((tile) => (
              <InferenceTile key={tile.id} data={tile} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
