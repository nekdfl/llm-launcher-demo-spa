import { SpeechConsole } from "./SpeechConsole";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api/client";
import { orchestratorApi } from "../api/orchestrator";
import type { FieldDescriptor } from "../api/orchestrator";
import type { Inference, InferenceRun, ModelEntity, PluginRecord, Profile } from "../api/types";
import { EngineBadge } from "../components/EngineBadge";
import { EntityLink } from "../components/EntityLink";
import { DiscrepancyIcon } from "../components/DiscrepancyIcon";
import { ArgvEditor } from "../components/ArgvEditor";
import { INHERITED_BLOCK, InheritanceMark } from "../components/InheritanceMark";
import { PluginStampFields } from "../components/PluginStampFields";
import { SchemaField } from "../components/SchemaField";
import { ProfileExtensionsSection } from "./profiles/ProfileExtensionsSection";
import { GpuChecklist, toggleGpuId, useGpuChecklistItems } from "../components/GpuChecklist";
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
import { LaunchCommandField } from "../components/LaunchCommandField";
import { hasProfileDiscrepancy } from "../lib/discrepancy";
import {
  isOverridden,
  PROFILE_PARITY_KEYS,
  profileParityValues,
  structuralFieldOverridden,
  type ProfileParityKey,
  type ProfileParityValues,
} from "../lib/launchParams";
import { formatBytes } from "../lib/formatBytes";
import { statusLineClass } from "../lib/status";
import { CHECKBOX, FIELD_HINT, FIELD_INPUT, FIELD_LABEL, INHERITED_FIELD, SECTION_TITLE } from "../components/ui";

const CHART_POLL_INTERVAL_MS = 5000;

/** Форма карточки: параметры, общие с профилем, хранятся в его же виде —
 * «из профиля» или «переопределено» выводится сравнением, а не флагами. */
interface ParamsForm extends ProfileParityValues {
  name: string;
  slug: string;
  port: string;
  autostart: boolean;
  autostartOrder: string;
}

function toForm(inference: Inference): ParamsForm {
  const params = Object.fromEntries(PROFILE_PARITY_KEYS.map((key) => [key, structuredClone(inference[key])])) as ProfileParityValues;
  return {
    ...params,
    name: inference.name,
    slug: inference.slug,
    port: String(inference.port),
    autostart: inference.autostart,
    autostartOrder: String(inference.autostart_order),
  };
}

function fieldClass(overridden: boolean): string {
  return overridden ? FIELD_INPUT : INHERITED_FIELD;
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
  const [plugin, setPlugin] = useState<PluginRecord | null>(null);
  const [profileSchema, setProfileSchema] = useState<FieldDescriptor[]>([]);
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

  const loadAll = async () => {
    const inf = await orchestratorApi.getInference(inferenceId);
    const [prof, mdl, plugins, schema, runHistory] = await Promise.all([
      orchestratorApi.getProfile(inf.profile_id),
      orchestratorApi.getModel(inf.model_id),
      orchestratorApi.listPlugins(),
      orchestratorApi.getPluginSchema(inf.plugin_id).catch(() => null),
      orchestratorApi.listRunsForInference(inf.id),
    ]);
    setInference(inf);
    setForm((prev) => prev ?? toForm(inf));
    setProfile(prof);
    setModel(mdl);
    setPlugin(plugins.find((item) => item.id === inf.plugin_id) ?? null);
    setProfileSchema(schema?.profile_schema ?? []);
    setRuns(runHistory);
  };

  useEffect(() => {
    if (inferenceId) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inferenceId]);


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
  const finishedRuns = runs.filter((run) => run.outcome !== null);

  useEffect(() => {
    if (selectedRunId === null) {
      setArchivedLogLines([]);
      return;
    }
    orchestratorApi
      .getRunLog(selectedRunId)
      .then(setArchivedLogLines)
      .catch(() => setArchivedLogLines([]));
  }, [selectedRunId]);

  const liveLogLines = useInferenceLogs(selectedRunId === null ? inferenceId || null : null);
  const shownLogLines = selectedRunId === null ? liveLogLines : archivedLogLines;

  const gpuPicker = useGpuChecklistItems(form?.gpu_ids ?? []);

  if (!inference || !form || !profile) {
    return <div className="py-8 text-sm text-neutral-500 font-mono">Загрузка…</div>;
  }

  const diverged = hasProfileDiscrepancy(inference, profile);
  const profileValues = profileParityValues(profile);

  const updateField = <K extends keyof ParamsForm>(key: K, value: ParamsForm[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const overridden = (key: ProfileParityKey) => isOverridden(key, form[key], profileValues[key]);
  const resetToProfile = (key: ProfileParityKey) => updateField(key, structuredClone(profileValues[key]));
  const mark = (key: ProfileParityKey) => (
    <InheritanceMark overridden={overridden(key)} onReset={() => resetToProfile(key)} testId={`inherit-${key.replace(/_/g, "-")}`} />
  );

  const toggleGpu = (gpuId: number) => updateField("gpu_ids", toggleGpuId(form.gpu_ids, gpuId));

  // Поля схемы сравниваются с профилем по отдельности: изменённый драйвер не
  // делает переопределёнными остальные поля.
  const setStructuralField = (name: string, value: unknown) =>
    updateField("structural_fields", { ...form.structural_fields, [name]: value });
  const resetStructuralField = (name: string) => {
    const next = { ...form.structural_fields };
    if (name in profileValues.structural_fields) next[name] = structuredClone(profileValues.structural_fields[name]);
    else delete next[name];
    updateField("structural_fields", next);
  };
  const driverField = profileSchema.find((field) => field.name === "driver") ?? null;
  const engineFields = profileSchema.filter((field) => field.name !== "driver");
  const renderSchemaField = (field: FieldDescriptor) => {
    const fieldOverridden = structuralFieldOverridden(form.structural_fields, profileValues.structural_fields, field.name);
    return (
      <SchemaField
        key={field.name}
        field={field}
        value={form.structural_fields[field.name] ?? field.default ?? ""}
        testId={`inference-field-${field.name}`}
        dimmed={!fieldOverridden}
        labelExtra={
          <InheritanceMark overridden={fieldOverridden} onReset={() => resetStructuralField(field.name)} testId={`inherit-field-${field.name}`} />
        }
        onChange={(value) => setStructuralField(field.name, value)}
      />
    );
  };

  const handleSave = async () => {
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const updated = await orchestratorApi.updateInference(inference.id, {
        name: form.name,
        slug: form.slug,
        port: Number(form.port),
        gpu_ids: form.gpu_ids,
        structural_fields: form.structural_fields,
        cli_options: form.cli_options,
        system_prompt: form.system_prompt,
        autostart: form.autostart,
        autostart_order: Number(form.autostartOrder) || 0,
        extensions: form.extensions,
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
    if (!newProfileName.trim()) return;
    setError(null);
    try {
      await orchestratorApi.createProfile({
        name: newProfileName.trim(),
        model_id: inference.model_id,
        plugin_id: inference.plugin_id,
        plugin_version: inference.plugin_version,
        schema_fields: profileSchema,
        port: Number(form.port),
        gpu_ids: form.gpu_ids,
        structural_fields: form.structural_fields,
        cli_options: form.cli_options,
        system_prompt: form.system_prompt,
        extensions: form.extensions,
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
        <h2 className={SECTION_TITLE}>Источник</h2>
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
          {/* Движок — плагин профиля: inference его отдельно не выбирает. */}
          <EntityLink
            label="Движок"
            name={plugin?.name}
            to={plugin ? `/engines/${plugin.id}` : null}
            missingNote="движок не найден"
            testId="inference-plugin-link"
          />
          <PluginStampFields pluginVersion={inference.plugin_version} schemaHash={inference.schema_hash} needsReview={inference.needs_review} />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 bg-surface-container-lowest tactical-accent p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className={`${SECTION_TITLE} !mb-0`}>
              Параметры запуска
              <EngineBadge pluginId={inference.plugin_id} />
            </h2>
            <span className="text-[10px] text-warn font-mono uppercase">правки применяются при следующем запуске</span>
          </div>
          <div className="mb-5">
            <span className={`${FIELD_LABEL} flex flex-wrap items-center gap-2`}>
              Карты
              {mark("gpu_ids")}
            </span>
            <div className={`mt-2 ${overridden("gpu_ids") ? "" : INHERITED_BLOCK}`}>
              <GpuChecklist
                items={gpuPicker.items}
                selected={new Set(form.gpu_ids)}
                onToggle={toggleGpu}
                nvmlError={gpuPicker.nvmlError}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-5">
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Порт (TCP)</span>
              <input className={FIELD_INPUT} value={form.port} onChange={(e) => updateField("port", e.currentTarget.value)} />
            </label>
            {driverField && renderSchemaField(driverField)}
          </div>

          <div className="mb-2">
            <ArgvEditor
              value={form.cli_options}
              onChange={(value) => updateField("cli_options", value)}
              inherited={!overridden("cli_options")}
              testId="inference-argv"
              label={
                <>
                  Опции командной строки
                  {mark("cli_options")}
                </>
              }
            />
          </div>
          <div className={`${FIELD_HINT} mb-5`}>
            -m, --alias, --host и --port ядро подставляет само из модели, имени и поля «Порт» выше — остальное передаётся в argv как записано.
          </div>

          <div className="flex flex-col gap-4 mb-5">
            <LaunchCommandField
              label="Команда запуска профиль"
              hint="та же, что в карточке профиля"
              input={{
                plugin_id: profile.plugin_id,
                model_id: profile.model_id,
                port: profile.port,
                gpu_ids: profile.gpu_ids,
                structural_fields: profile.structural_fields,
                cli_options: profile.cli_options,
              }}
              testId="inference-profile-launch-command"
            />
            <LaunchCommandField
              label="Команда запуска текущая"
              hint="с переопределениями и несохранёнными правками"
              input={{
                plugin_id: inference.plugin_id,
                model_id: inference.model_id,
                inference_name: form.name,
                port: Number(form.port) || null,
                gpu_ids: form.gpu_ids,
                structural_fields: form.structural_fields,
                cli_options: form.cli_options,
              }}
              testId="inference-current-launch-command"
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className={`${FIELD_LABEL} flex flex-wrap items-center gap-2`}>
              System prompt
              {mark("system_prompt")}
              <span className="text-neutral-700 normal-case font-normal">— вставляется роутером в начало каждого запроса</span>
            </span>
            <textarea
              aria-label="System prompt"
              className={`${fieldClass(overridden("system_prompt"))} h-16`}
              value={form.system_prompt}
              onChange={(e) => updateField("system_prompt", e.currentTarget.value)}
            />
          </div>

          {engineFields.length > 0 && (
            <div className="mt-5 pt-4 border-t border-neutral-900" data-testid="inference-schema-fields">
              <span className={FIELD_LABEL}>Параметры движка</span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mt-2">{engineFields.map(renderSchemaField)}</div>
            </div>
          )}

          <div className="flex items-center gap-6 mt-5 pt-4 border-t border-neutral-900">
            <label className="flex items-center gap-2 text-xs text-neutral-400 uppercase font-['Space_Grotesk']">
              <input type="checkbox" className={CHECKBOX} checked={form.autostart} onChange={(e) => updateField("autostart", e.currentTarget.checked)} />
              Автозапуск
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-400 uppercase font-['Space_Grotesk']">
              Порядок
              <input
                type="number"
                min={0}
                className={`${FIELD_INPUT} w-20 !py-1`}
                value={form.autostartOrder}
                onChange={(e) => updateField("autostartOrder", e.currentTarget.value)}
                data-testid="autostart-order"
              />
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
          <h2 className={`${SECTION_TITLE} !mb-0`}>Потребление</h2>
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

      {/* Расширения — отдельной карточкой, как в профиле. */}
      <div className="h-6" />
      <ProfileExtensionsSection
        pluginId={inference.plugin_id}
        value={form.extensions}
        onChange={(value) => updateField("extensions", value)}
        fieldError={null}
        profileValue={profileValues.extensions}
      />

      <SpeechConsole inferenceId={inference.id} running={isRunning} />

      <section className="mt-6 bg-surface-container-lowest p-6">
        <h2 className={SECTION_TITLE}>История запусков</h2>
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
          <h2 className={`${SECTION_TITLE} !mb-0`}>Пропускная способность</h2>
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
          <h2 className={`${SECTION_TITLE} !mb-0`}>
            Журнал{" "}
            <span className="text-neutral-600 normal-case font-normal">
              {selectedRunId === null ? "(текущий запуск, live tail)" : "(завершённый запуск, из архива)"}
            </span>
          </h2>
          <div className="flex items-center gap-3">
            <select
              className={`${FIELD_INPUT} !text-[11px] !px-2 !py-1`}
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

      </section>
    </div>
  );
}
