import { SpeechConsole } from "./SpeechConsole";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api/client";
import { orchestratorApi } from "../api/orchestrator";
import type { EngineInstallation, HardwareInfo, Inference, InferenceRun, ModelEntity, Profile, RunTraceEntry } from "../api/types";
import { EntityLink } from "../components/EntityLink";
import { DiscrepancyIcon } from "../components/DiscrepancyIcon";
import { GpuChecklist, type GpuChecklistItem } from "../components/GpuChecklist";
import { MetricsRangePicker } from "../components/MetricsRangePicker";
import { ThroughputChart } from "../components/ThroughputChart";
import { STATUS_POLL_INTERVAL_MS, usePolling } from "../hooks/usePolling";
import { useInferenceLogs } from "../hooks/useInferenceLogs";
import {
  historyStepMs,
  readStoredMetricsRange,
  storeMetricsRange,
  useMetricsSeries,
  type MetricsRangeKey,
} from "../hooks/useMetricsSeries";
import { hasProfileDiscrepancy } from "../lib/discrepancy";
import { formatBytes } from "../lib/formatBytes";
import { statusLineClass } from "../lib/status";

const CHART_POLL_INTERVAL_MS = 5000;

const FIELD_LABEL = "text-[11px] text-neutral-500 uppercase font-['Space_Grotesk']";
const FIELD_INPUT = "bg-surface-container border border-neutral-800 px-3 py-2 font-mono text-xs";
// Модальности ввода, которые понимает OpenAI-совместимый клиент.
const MODALITIES = ["text", "image", "audio"] as const;

interface ParamsForm {
  name: string;
  slug: string;
  gpuIds: number[];
  port: string;
  driver: string;
  cliOptions: string;
  systemPrompt: string;
  autostart: boolean;
  reasoning: boolean;
  trace: boolean;
  inputModalities: string[];
}

function toForm(inference: Inference): ParamsForm {
  return {
    name: inference.name,
    slug: inference.slug,
    gpuIds: [...inference.gpu_ids],
    port: String(inference.port),
    driver: String(inference.structural_fields.driver ?? "cpu"),
    cliOptions: inference.cli_options,
    systemPrompt: inference.system_prompt,
    autostart: inference.autostart,
    reasoning: inference.reasoning,
    trace: inference.trace,
    inputModalities: [...inference.input_modalities],
  };
}

const RUN_OUTCOME_LABELS: Record<string, string> = {
  stopped: "остановлен",
  failed: "упал",
  unobserved: "завершён вне наблюдения",
};

/** Запуски должны быть различимы: время старта и исход. */
function formatRunLabel(run: InferenceRun): string {
  const started = new Date(`${run.started_at}Z`).toLocaleString("ru-RU");
  return `${started} — ${RUN_OUTCOME_LABELS[run.outcome ?? ""] ?? "исход неизвестен"}`;
}

export function InferenceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const inferenceId = id ?? "";

  const [inference, setInference] = useState<Inference | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [model, setModel] = useState<ModelEntity | null>(null);
  const [installation, setInstallation] = useState<EngineInstallation | null>(null);
  const [runs, setRuns] = useState<InferenceRun[]>([]);
  const [form, setForm] = useState<ParamsForm | null>(null);
  const [newProfileName, setNewProfileName] = useState("");
  const [showSaveAsProfile, setShowSaveAsProfile] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Which lifecycle action is in flight (null = none). Drives the "busy"
  // state so the buttons disable and show progress immediately, and the
  // result renders next to them (inference-action-feedback). Kept separate
  // from the params-section message/error so save and lifecycle feedback
  // don't appear in each other's place.
  const [actionBusy, setActionBusy] = useState<null | "start" | "stop" | "restart">(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Card picking mirrors /settings/cpu-gpu: the pool says what may be
  // chosen, hardware-info gives the names and metrics.
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [gpuPool, setGpuPool] = useState<number[] | null>(null);

  const loadAll = async () => {
    const inf = await orchestratorApi.getInference(inferenceId);
    setInference(inf);
    setForm((prev) => prev ?? toForm(inf));

    const [prof, mdl, inst, runHistory] = await Promise.all([
      orchestratorApi.getProfile(inf.profile_id),
      orchestratorApi.getModel(inf.model_id),
      orchestratorApi.getEngineInstallation(inf.engine_installation_id),
      orchestratorApi.listRunsForInference(inf.id),
    ]);
    setProfile(prof);
    setModel(mdl);
    setInstallation(inst);
    setRuns(runHistory);
  };

  useEffect(() => {
    if (inferenceId) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inferenceId]);

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

  const { data: status } = usePolling(
    () => orchestratorApi.getInferenceStatus(inferenceId),
    STATUS_POLL_INTERVAL_MS,
    !!inferenceId
  );

  const [metricsRange, setMetricsRange] = useState<MetricsRangeKey>(readStoredMetricsRange);
  const changeMetricsRange = (next: MetricsRangeKey) => {
    setMetricsRange(next);
    storeMetricsRange(next);
  };

  // История этого inference живёт на сервере, поэтому график показывает
  // накопленный период сразу, а не заполняется с нуля при каждом открытии.
  const throughput = useMetricsSeries<{ tokensInPerSec: number; tokensOutPerSec: number }>({
    loadHistory: async (range) => {
      const history = await orchestratorApi.getThroughputHistory(range, [inferenceId]);
      const stepMs = historyStepMs(history.step_seconds);
      return history.points.map((point) => ({
        time: Date.parse(`${point.at}Z`),
        stepMs,
        value: { tokensInPerSec: point.tokens_in_per_sec, tokensOutPerSec: point.tokens_out_per_sec },
      }));
    },
    pollLive: async () => {
      const result = await orchestratorApi.getInferenceThroughput([inferenceId]);
      const point = result[inferenceId] ?? { tokens_in_per_sec: 0, tokens_out_per_sec: 0 };
      return { tokensInPerSec: point.tokens_in_per_sec, tokensOutPerSec: point.tokens_out_per_sec };
    },
    rangeKey: metricsRange,
    intervalMs: CHART_POLL_INTERVAL_MS,
    enabled: !!inferenceId,
  });

  // Журнал текущего запуска идёт живым потоком, завершённого — из архива его
  // записи истории. Выбор определяет, что показано. Список запусков страница
  // уже грузит для истории — берём его же, завершённые.
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [archivedLogLines, setArchivedLogLines] = useState<string[]>([]);
  const [traceEntries, setTraceEntries] = useState<RunTraceEntry[]>([]);
  const finishedRuns = runs.filter((run) => run.outcome !== null);

  useEffect(() => {
    if (selectedRunId === null) {
      setArchivedLogLines([]);
      setTraceEntries([]);
      return;
    }
    orchestratorApi
      .getRunLog(selectedRunId)
      .then(setArchivedLogLines)
      .catch(() => setArchivedLogLines([]));
    orchestratorApi
      .getRunTrace(selectedRunId)
      .then(setTraceEntries)
      .catch(() => setTraceEntries([]));
  }, [selectedRunId]);

  const liveLogLines = useInferenceLogs(selectedRunId === null ? inferenceId || null : null);
  const shownLogLines = selectedRunId === null ? liveLogLines : archivedLogLines;

  if (!inference || !form) {
    return <div className="py-8 text-sm text-neutral-500 font-mono">Загрузка…</div>;
  }

  const diverged = profile ? hasProfileDiscrepancy(inference, profile) : false;

  const updateField = <K extends keyof ParamsForm>(key: K, value: ParamsForm[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const toggleGpu = (gpuId: number) =>
    setForm((prev) =>
      prev
        ? {
            ...prev,
            gpuIds: prev.gpuIds.includes(gpuId)
              ? prev.gpuIds.filter((id) => id !== gpuId)
              : [...prev.gpuIds, gpuId].sort((left, right) => left - right),
          }
        : prev
    );

  // Only pool cards are offered, so a card outside the pool cannot be
  // picked here. A card already assigned to this inference but since dropped
  // from the pool stays listed and marked — otherwise saving the form would
  // silently erase an existing assignment.
  const detectedGpuById = new Map((hardware?.gpus ?? []).map((gpu) => [gpu.gpu_id, gpu]));
  const poolGpuIds = gpuPool ?? [];
  const gpuChecklistItems: GpuChecklistItem[] = [
    ...poolGpuIds,
    ...form.gpuIds.filter((gpuId) => !poolGpuIds.includes(gpuId)),
  ]
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

  const handleSave = async () => {
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const updated = await orchestratorApi.updateInference(inference.id, {
        name: form.name,
        slug: form.slug,
        port: Number(form.port),
        gpu_ids: form.gpuIds,
        structural_fields: { ...inference.structural_fields, driver: form.driver },
        cli_options: form.cliOptions,
        system_prompt: form.systemPrompt,
        autostart: form.autostart,
        reasoning: form.reasoning,
        trace: form.trace,
        input_modalities: form.inputModalities,
      });
      setInference(updated);
      setMessage("Сохранено — изменения применятся при следующем запуске");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAsProfile = async () => {
    if (!installation || !newProfileName.trim()) return;
    setError(null);
    try {
      const schema = await orchestratorApi.getPluginSchema(installation.plugin_id);
      await orchestratorApi.createProfile({
        name: newProfileName.trim(),
        model_id: inference.model_id,
        engine_plugin_id: installation.plugin_id,
        plugin_version: installation.version ?? "",
        schema_fields: schema.profile_schema,
        gpu_ids: form.gpuIds,
        port: Number(form.port),
        structural_fields: { ...inference.structural_fields, driver: form.driver },
        cli_options: form.cliOptions,
        system_prompt: form.systemPrompt,
        reasoning: form.reasoning,
        trace: form.trace,
        input_modalities: form.inputModalities,
      });
      setShowSaveAsProfile(false);
      setNewProfileName("");
      setMessage("Новый профиль создан");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать профиль");
    }
  };

  const handleStart = async () => {
    setActionError(null);
    setActionMessage(null);
    setActionBusy("start");
    try {
      await orchestratorApi.startInference(inference.id);
      setActionMessage("Запуск выполнен");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Не удалось запустить");
    } finally {
      setActionBusy(null);
    }
  };

  const handleStop = async () => {
    setActionError(null);
    setActionMessage(null);
    setActionBusy("stop");
    try {
      await orchestratorApi.stopInference(inference.id);
      setActionMessage("Остановка запрошена");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Не удалось остановить");
    } finally {
      setActionBusy(null);
    }
  };

  const handleViewRunLog = async (runId: number) => {
    setError(null);
    try {
      // A plain <a href> can't carry the Authorization header, so the log
      // is fetched via the authenticated client and opened as a blob URL.
      const response = await apiFetch(`/orchestrator/api/history/runs/${runId}/log`);
      if (!response.ok) throw new Error("лог недоступен");
      const text = await response.text();
      const blobUrl = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
      window.open(blobUrl, "_blank");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось открыть лог");
    }
  };

  const handleDelete = async () => {
    setError(null);
    try {
      await orchestratorApi.deleteInference(inference.id);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить inference");
    }
  };

  const handleRestart = async () => {
    setActionError(null);
    setActionMessage(null);
    setActionBusy("restart");
    try {
      const wasRunning = status?.status === "running" || status?.status === "warming";
      if (!wasRunning) {
        // Nothing to stop — restarting a stopped inference is just a start, so
        // skip the stop-progress wait entirely (that wait never resolves when
        // NVML can't confirm the GPU is freed).
        await orchestratorApi.startInference(inference.id);
        setActionMessage("Запуск выполнен");
        return;
      }
      await orchestratorApi.stopInference(inference.id);
      // Bounded wait: stop at the first non-in-progress result, otherwise give
      // up after ~20s and start anyway, so unconfirmable stop (NVML down) never
      // leaves the action hanging silently.
      let confirmed = false;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const progress = await orchestratorApi.getStopProgress(inference.id, attempt * 2);
        if (progress.progress !== "in_progress") {
          confirmed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      await orchestratorApi.startInference(inference.id);
      setActionMessage(confirmed ? "Перезапуск выполнен" : "Перезапуск выполнен (остановка не подтверждена)");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Не удалось перезапустить");
    } finally {
      setActionBusy(null);
    }
  };

  // Header indicator: the same accent line as the dashboard, not a dot.
  // Stopping/restarting is an intermediate stage known only here (systemd has
  // no "stopping" status), so it paints the line yellow on its own.
  const statusLine = statusLineClass(status?.status ?? null, {
    transitioning: actionBusy === "stop" || actionBusy === "restart",
  });

  const STATUS_LABELS: Record<string, string> = {
    running: "работает",
    warming: "прогрев",
    stopped: "остановлен",
    unresponsive: "не отвечает",
    failed: "сбой",
  };
  const statusLabel = status ? STATUS_LABELS[status.status] ?? status.status : "…";
  // Anything but "stopped" means the resources are not confirmed freed, so
  // stop/restart stay available there — including "unresponsive" and
  // "failed", where VRAM may still be held and a disabled stop button would
  // leave no way out through the UI. Start is the inverse.
  const isRunning = status !== null && status !== undefined && status.status !== "stopped";
  const modelUnusableReason =
    inference?.model_validity?.usable === false ? inference.model_validity.reason : null;
  const busy = actionBusy !== null;

  return (
    <div>
      <header className="py-8">
        <Link className="text-[10px] font-['Space_Grotesk'] uppercase text-neutral-500 hover:text-primary" to="/">
          &larr; Dashboard
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <span className={`w-1 h-8 shrink-0 ${statusLine}`} data-testid="inference-status-line" />
          <h1 className="font-['Space_Grotesk'] text-3xl font-extrabold tracking-tighter">{inference.name}</h1>
          {diverged && <DiscrepancyIcon title={`параметры разошлись с профилем ${profile?.name ?? ""}`} />}
        </div>
        <div className="text-[11px] font-mono text-neutral-500 mt-1">
          uuid: <span className="text-neutral-600">{inference.id}</span> · профиль-источник:{" "}
          {profile && (
            <span className="text-primary underline">{profile.name}</span>
          )}
        </div>
      </header>

      <section className="bg-surface-container-lowest tactical-accent p-6 mb-6">
        <h2 className="font-['Space_Grotesk'] text-xs font-bold uppercase tracking-widest text-primary mb-4">Источник</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Имя</span>
            <input className={FIELD_INPUT} value={form.name} onChange={(e) => updateField("name", e.currentTarget.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Slug</span>
            <input className={FIELD_INPUT} value={form.slug} onChange={(e) => updateField("slug", e.currentTarget.value)} />
          </label>
          {/* Цепочка модель → профиль → inference должна проходиться по
              ссылкам, а не выясняться сопоставлением названий. */}
          <EntityLink
            label="Модель"
            name={model?.ref}
            to={model ? `/models/${model.id}` : null}
            missingNote="модель не найдена"
            testId="inference-model-link"
          />
          <EntityLink
            label="Профиль"
            name={profile?.name}
            to={profile ? `/profiles/${profile.id}` : null}
            missingNote="профиль не найден"
            testId="inference-profile-link"
          />
          <EntityLink
            label="Установка движка"
            name={installation?.name}
            to={installation ? `/engines/${installation.id}` : null}
            missingNote="установка не найдена"
            testId="inference-installation-link"
          />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 bg-surface-container-lowest tactical-accent p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-['Space_Grotesk'] text-xs font-bold uppercase tracking-widest text-primary">Параметры запуска</h2>
            <span className="text-[10px] text-warn font-mono uppercase">правки применяются при следующем запуске</span>
          </div>
          <div className="mb-5">
            <span className={FIELD_LABEL}>Карты</span>
            <div className="mt-2">
              <GpuChecklist
                items={gpuChecklistItems}
                selected={new Set(form.gpuIds)}
                onToggle={toggleGpu}
                nvmlError={hardware?.nvml_error ?? null}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-5">
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Порт (TCP)</span>
              <input className={FIELD_INPUT} value={form.port} onChange={(e) => updateField("port", e.currentTarget.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Драйвер</span>
              <select className={FIELD_INPUT} value={form.driver} onChange={(e) => updateField("driver", e.currentTarget.value)}>
                <option value="nvidia">nvidia (CUDA)</option>
                <option value="cpu">cpu</option>
                <option value="rocm">rocm</option>
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1 mb-2">
            <span className={`${FIELD_LABEL} flex flex-wrap items-center gap-2`}>
              Опции командной строки
              <span className="text-neutral-700 normal-case font-normal">— передаются в argv как есть, без схемы</span>
            </span>
            <textarea
              className={`${FIELD_INPUT} h-32 leading-relaxed`}
              spellCheck={false}
              value={form.cliOptions}
              onChange={(e) => updateField("cliOptions", e.currentTarget.value)}
            />
          </label>
          <div className="text-[10px] text-neutral-600 font-mono mb-5">
            -m, --alias, --host и --port ядро подставляет само из модели, имени и поля «Порт» выше — остальное свободный текст.
          </div>

          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>
              System prompt <span className="text-neutral-700 normal-case font-normal">— вставляется роутером в начало каждого запроса</span>
            </span>
            <textarea
              className={`${FIELD_INPUT} h-16`}
              value={form.systemPrompt}
              onChange={(e) => updateField("systemPrompt", e.currentTarget.value)}
            />
          </label>

          <div className="flex flex-col gap-2 mt-5 pt-4 border-t border-neutral-900">
            <span className={FIELD_LABEL}>
              Возможности <span className="text-neutral-700 normal-case font-normal">— уходят клиентам в <code>/v1/models</code>; движок их не сообщает</span>
            </span>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-xs text-neutral-400 uppercase font-['Space_Grotesk']">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={form.reasoning}
                  onChange={(e) => updateField("reasoning", e.currentTarget.checked)}
                />
                Reasoning
              </label>
              {MODALITIES.map((modality) => (
                <label key={modality} className="flex items-center gap-2 text-xs text-neutral-400 uppercase font-['Space_Grotesk']">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={form.inputModalities.includes(modality)}
                    onChange={(e) =>
                      updateField(
                        "inputModalities",
                        e.currentTarget.checked
                          ? [...form.inputModalities, modality]
                          : form.inputModalities.filter((item) => item !== modality),
                      )
                    }
                  />
                  {modality}
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-6 mt-5 pt-4 border-t border-neutral-900">
            <label className="flex items-center gap-2 text-xs text-neutral-400 uppercase font-['Space_Grotesk']">
              <input type="checkbox" className="accent-primary" checked={form.autostart} onChange={(e) => updateField("autostart", e.currentTarget.checked)} />
              Автозапуск
            </label>
            <div className="flex-grow" />
            {showSaveAsProfile ? (
              <div className="flex items-center gap-2">
                <input
                  className={FIELD_INPUT}
                  placeholder="название профиля"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.currentTarget.value)}
                />
                <button
                  className="px-4 py-2 border border-neutral-700 text-neutral-300 text-xs font-['Space_Grotesk'] uppercase hover:border-primary hover:text-primary"
                  onClick={handleSaveAsProfile}
                >
                  Создать профиль
                </button>
              </div>
            ) : (
              <button
                className="px-4 py-2 border border-neutral-700 text-neutral-300 text-xs font-['Space_Grotesk'] uppercase hover:border-primary hover:text-primary"
                onClick={() => setShowSaveAsProfile(true)}
              >
                Сохранить как новый профиль
              </button>
            )}
            <button
              className="px-4 py-2 bg-primary text-black text-xs font-['Space_Grotesk'] font-bold uppercase hover:bg-primary/80 disabled:opacity-50"
              onClick={handleSave}
              disabled={saving}
            >
              Сохранить
            </button>
          </div>

          {message && <div className="text-xs text-primary font-mono mt-3">{message}</div>}
          {error && <div className="text-xs text-danger font-mono mt-3">{error}</div>}
        </section>

        <section className="bg-surface-container-lowest p-6 flex flex-col gap-4">
          <h2 className="font-['Space_Grotesk'] text-xs font-bold uppercase tracking-widest text-primary">Потребление</h2>
          <div className="grid grid-cols-2 gap-3 text-[11px] font-mono">
            <div className="bg-surface-container p-3">
              <div className="text-neutral-500 uppercase">VRAM peak</div>
              <div className="text-on-surface text-lg">{formatBytes(runs[0]?.peak_vram_bytes ?? null)}</div>
            </div>
            <div className="bg-surface-container p-3">
              <div className="text-neutral-500 uppercase">RAM peak</div>
              <div className="text-on-surface text-lg">{formatBytes(runs[0]?.peak_ram_bytes ?? null)}</div>
            </div>
          </div>
          <div className="bg-surface-container p-3 flex items-center justify-between" data-testid="inference-status">
            <span className="text-neutral-500 uppercase text-[11px] font-['Space_Grotesk']">Статус</span>
            <span className="flex items-center gap-2 font-mono text-xs">
              <span className={`w-1 h-4 shrink-0 ${statusLine}`} />
              <span data-testid="inference-status-label">{statusLabel}</span>
            </span>
          </div>
          <div className="flex gap-3">
            <button
              data-testid="action-start"
              className="flex-1 py-3 bg-primary/20 border border-primary/50 text-primary font-['Space_Grotesk'] text-xs font-bold uppercase enabled:hover:bg-primary enabled:hover:text-black transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={handleStart}
              // Негодная модель не стартует: лучше выключенная кнопка с
              // причиной, чем падение движка при нажатии.
              disabled={isRunning || busy || modelUnusableReason !== null}
              title={modelUnusableReason ? `модель негодна: ${modelUnusableReason}` : undefined}
            >
              {actionBusy === "start" ? "Запуск…" : "Запустить"}
            </button>
            <button
              data-testid="action-stop"
              className="flex-1 py-3 bg-danger/20 border border-danger/50 text-danger font-['Space_Grotesk'] text-xs font-bold uppercase enabled:hover:bg-danger enabled:hover:text-black transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={handleStop}
              disabled={!isRunning || busy}
            >
              {actionBusy === "stop" ? "Остановка…" : "Остановить"}
            </button>
            <button
              data-testid="action-restart"
              className="flex-1 py-3 border border-neutral-700 text-neutral-300 font-['Space_Grotesk'] text-xs font-bold uppercase enabled:hover:border-primary enabled:hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={handleRestart}
              disabled={!isRunning || busy}
            >
              {actionBusy === "restart" ? "Перезапуск…" : "Перезапустить"}
            </button>
          </div>
          {actionBusy === null && actionMessage && (
            <div className="text-xs text-primary font-mono" data-testid="action-feedback">{actionMessage}</div>
          )}
          {actionError && <div className="text-xs text-danger font-mono" data-testid="action-error">{actionError}</div>}
          <button
            className="py-3 border border-danger/30 text-danger/40 font-['Space_Grotesk'] text-xs font-bold uppercase disabled:cursor-not-allowed enabled:hover:bg-danger enabled:hover:text-black"
            onClick={handleDelete}
            disabled={status?.status === "running" || status?.status === "warming"}
            title={
              status?.status === "running" || status?.status === "warming"
                ? "остановите inference перед удалением"
                : undefined
            }
          >
            Удалить inference
          </button>
        </section>
      </div>

      <SpeechConsole inferenceId={inference.id} running={isRunning} />

      <section className="mt-6 bg-surface-container-lowest p-6">
        <h2 className="font-['Space_Grotesk'] text-xs font-bold uppercase tracking-widest text-primary mb-4">История запусков</h2>
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-neutral-500 uppercase text-[10px] border-b border-neutral-800">
              <th className="text-left py-2 font-normal">Старт</th>
              <th className="text-left font-normal">Исход</th>
              <th className="text-left font-normal">VRAM peak</th>
              <th className="text-left font-normal">Инициатор</th>
              <th className="text-left font-normal"></th>
            </tr>
          </thead>
          <tbody className="text-neutral-300">
            {runs.map((run) => (
              <tr key={run.id} className="border-b border-neutral-900">
                <td className={`py-2 ${run.outcome === "failed" ? "text-danger" : ""}`}>
                  {new Date(run.started_at).toLocaleString()}
                </td>
                <td className={run.outcome === "failed" ? "text-danger" : run.outcome === null ? "text-primary" : ""}>
                  {run.outcome === "failed" ? "упал" : run.outcome === null ? "работает" : "остановлен вручную"}
                </td>
                <td>{formatBytes(run.peak_vram_bytes)}</td>
                <td>{run.initiated_by ?? "—"}</td>
                <td>
                  <button className="text-primary underline" onClick={() => handleViewRunLog(run.id)}>
                    логи
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6 bg-surface-container-lowest p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-['Space_Grotesk'] text-xs font-bold uppercase tracking-widest text-primary">Пропускная способность</h2>
          <MetricsRangePicker value={metricsRange} onChange={changeMetricsRange} testId="metrics-range" />
        </div>
        <div className="flex items-center gap-4 text-[10px] font-mono text-neutral-500 mb-2">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: "#3987e5" }} />
            вход, tok/s
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: "#d95926" }} />
            выход, tok/s
          </span>
        </div>
        <ThroughputChart samples={throughput.samples} windowMs={throughput.windowMs} />
      </section>

      <section className="mt-6 bg-surface-container-lowest tactical-accent p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="font-['Space_Grotesk'] text-xs font-bold uppercase tracking-widest text-primary">
            Журнал{" "}
            <span className="text-neutral-600 normal-case font-normal">
              {selectedRunId === null ? "(текущий запуск, live tail)" : "(завершённый запуск, из архива)"}
            </span>
          </h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-[11px] text-neutral-400 uppercase font-['Space_Grotesk']">
              <input
                type="checkbox"
                className="accent-primary"
                checked={form.trace}
                onChange={(e) => updateField("trace", e.currentTarget.checked)}
                data-testid="trace-toggle"
              />
              Trace
            </label>
            <select
              className="bg-surface-container text-[11px] font-mono text-neutral-300 px-2 py-1"
              value={selectedRunId === null ? "current" : String(selectedRunId)}
              onChange={(e) =>
                setSelectedRunId(e.currentTarget.value === "current" ? null : Number(e.currentTarget.value))
              }
              data-testid="run-select"
            >
              <option value="current">Текущий запуск</option>
              {finishedRuns.map((run) => (
                <option key={run.id} value={run.id}>
                  {formatRunLabel(run)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="text-[10px] text-neutral-600 font-mono mb-3" data-testid="trace-note">
          Trace сохраняет запросы и ответы — их пишет роутер, движок тел не логирует. Действует на
          последующие запросы, перезапуск не нужен; виден только трафик через роутер.
        </div>
        {shownLogLines.length === 0 && selectedRunId !== null ? (
          <div className="text-[11px] font-mono text-neutral-500" data-testid="run-log-absent">
            Журнала по этому запуску нет.
          </div>
        ) : (
          <pre
            className="bg-black/60 text-[11px] leading-relaxed font-mono text-neutral-400 p-4 h-48 overflow-y-auto"
            data-testid="log-view"
          >
            {shownLogLines.join("\n")}
          </pre>
        )}

        {selectedRunId !== null && (
          <div className="mt-4">
            <div className="text-[10px] font-['Space_Grotesk'] uppercase text-neutral-500 mb-2">
              Сохранённые запросы{" "}
              <span className="text-neutral-700 normal-case font-normal">— только при включённом trace</span>
            </div>
            {traceEntries.length === 0 ? (
              <div className="text-[11px] font-mono text-neutral-500" data-testid="run-trace-absent">
                По этому запуску запросы не сохранялись.
              </div>
            ) : (
              <pre
                className="bg-black/60 text-[11px] leading-relaxed font-mono text-neutral-400 p-4 h-48 overflow-y-auto"
                data-testid="run-trace-view"
              >
                {traceEntries
                  .map((entry) => `${entry.at}\n${JSON.stringify(entry.request)}\n${JSON.stringify(entry.response)}`)
                  .join("\n\n")}
              </pre>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
