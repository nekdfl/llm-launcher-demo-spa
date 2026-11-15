// In-memory состояние эмулированного backend'а. Засеяно снимком GET-ответов
// оркестратора стенда (seed.json, курированное подмножество) и синтетикой там,
// где снимок брать нельзя (пользователи, ключи, журнал запросов, закачки).
// Перезагрузка страницы возвращает исходное состояние.
import seedJson from "./seed.json";
import type { FieldDescriptor, PluginSchema, RouterModelEntry } from "../src/api/orchestrator";
import type {
  ApiKeyRecord,
  DownloadRecord,
  DownloadSettings,
  EngineExtension,
  GpuStatusEntry,
  HardwareInfo,
  HistorySettings,
  Inference,
  InferenceRun,
  InferenceStatusLabel,
  MetricsRetentionSettings,
  ModelDetailResponse,
  ModelEntity,
  ModelSearchResult,
  PluginRecord,
  Profile,
  ProfileFormulaSuggestion,
  Provider,
  RepoSyncReport,
  RepoSyncState,
  RequestLogEntry,
  SystemUser,
} from "../src/api/types";
import { fail } from "./server";

/** Установка движка в снимке стенда: в эмулируемом контракте её нет —
 * при загрузке она становится engine-плагином (вариантом движка). */
interface SeedInstallation {
  id: number;
  name: string;
  plugin_id: number;
  install_fields: Record<string, unknown>;
  version: string | null;
  available: boolean;
  unavailable_reason: string | null;
}

/** Записи снимка в старой модели: inference и запуски ссылаются на
 * установку, у профиля плагин назван `engine_plugin_id`. */
/** Признаки trace, reasoning и модальностей в снимке есть, но в эмулируемом
 * контракте SPA их нет — при загрузке отбрасываются. */
interface SeedUiDroppedFields {
  trace?: boolean;
  reasoning?: boolean;
  input_modalities?: string[];
}
type SeedProfile = Omit<Profile, "plugin_id"> & SeedUiDroppedFields & { engine_plugin_id: number };
type SeedInference = Omit<Inference, "plugin_id" | "plugin_version" | "schema_hash" | "needs_review"> &
  SeedUiDroppedFields & { engine_installation_id: number };
type SeedRun = Omit<InferenceRun, "plugin_id" | "engine_version"> & { engine_installation_id: number; engine_installation_version: string | null };

interface Seed {
  plugins: PluginRecord[];
  engines: SeedInstallation[];
  providers: Provider[];
  models: ModelEntity[];
  profiles: SeedProfile[];
  inferences: SeedInference[];
  schemas: Record<string, PluginSchema>;
  extensions: Record<string, EngineExtension[]>;
  model_details: Record<string, ModelDetailResponse>;
  repo_syncs: Record<string, RepoSyncReport>;
  formulas: Record<string, ProfileFormulaSuggestion>;
  sync_states: RepoSyncState[];
  searches: Record<string, ModelSearchResult[]>;
  runs: Record<string, SeedRun[]>;
  logs: Record<string, string[]>;
  router_models: Record<string, RouterModelEntry>;
  statuses: Record<string, { status: InferenceStatusLabel }>;
  gpu_status: GpuStatusEntry[];
  hardware: HardwareInfo;
  host_load: Record<string, number>;
  settings: {
    downloads: DownloadSettings;
    resources: ResourceSettings;
    metrics: MetricsRetentionSettings;
    history: HistorySettings;
    audit: { max_records: number };
    request_log: { max_records: number };
    assistant: { router_base_url: string; model: string; has_api_key: boolean; configured: boolean };
  };
  numa: Record<string, number[]>;
}

export interface ResourceSettings {
  cpu_pool: number[];
  gpu_pool: number[];
  port_range_start: number;
  port_range_end: number;
  disk_ceiling_bytes_per_sec: number;
  net_ceiling_bytes_per_sec: number;
}

/** Процесс inference в симуляции: `warming` длится до `readyAt`, остановка —
 * до `stoppedAt`. Текущая нагрузка — для метрик и графиков. */
export interface ProcessState {
  status: InferenceStatusLabel;
  readyAt: number | null;
  stoppingUntil: number | null;
  pid: number;
  gpuIds: number[];
  tokensIn: number;
  tokensOut: number;
  busyUntil: number;
}

/** Активная закачка ведёт байты сама; скорость — сглаженная, как у воркера. */
export interface DownloadState extends DownloadRecord {
  speed: number | null;
  files: { filename: string; size: number }[];
  created_at: string;
}

const seed = structuredClone(seedJson) as unknown as Seed;

export const GiB = 1024 ** 3;
export const MiB = 1024 ** 2;

/** Время сервера — наивный ISO в UTC, как отдаёт оркестратор. */
export function isoNow(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().replace("Z", "");
}

function randomHex(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

export function uuid(): string {
  const h = randomHex(32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const byId = <T extends { id: unknown }>(items: T[]) => new Map(items.map((item) => [item.id, item]));

// Пограничные состояния, которых на стенде сейчас нет, но которые SPA
// показывает особо: модель с пропавшим файлом и inference после сбоя.
const missingModel = seed.models.find((m) => m.ref === "microsoft/VibeVoice-ASR");
if (missingModel) missingModel.validity = { usable: false, reason: "файл не найден" };
const failedInference = seed.inferences.find((i) => i.slug === "voxtral-rt");
if (failedInference) {
  seed.statuses[failedInference.id] = { status: "failed" };
  const lastRun = seed.runs[failedInference.id]?.[0];
  if (lastRun) {
    lastRun.outcome = "failed";
    lastRun.stopped_at = lastRun.stopped_at ?? lastRun.started_at;
  }
  seed.logs[failedInference.id] = [
    ...(seed.logs[failedInference.id] ?? []),
    "Traceback (most recent call last):",
    '  File "/opt/llm/llm-engine/voxtral/venv/lib/python3.12/site-packages/vllm/worker.py", line 412, in load_model',
    "torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 2.00 GiB. GPU 0 has a total capacity of 23.56 GiB of which 1.12 GiB is free.",
  ];
}
// Закачки идут без ограничения скорости, чтобы прогресс был виден сразу.
seed.settings.downloads.rate_limit_bytes_per_sec = 0;
seed.settings.downloads.max_concurrent_downloads = 2;

// Снимок стенда — в старой модели: плагин (код) и установки (данные).
// В эмулируемом контракте плагин и есть вариант движка, поэтому каждая
// установка становится engine-плагином. Первая установка плагина занимает
// его id, остальные получают новые; схема, расширения и задачи — от кода.
const variantByInstallation = new Map<number, number>();
const providerPlugins = seed.plugins.filter((plugin) => plugin.plugin_type !== "engine");
const variants: PluginRecord[] = [];
let nextPluginId = Math.max(...seed.plugins.map((plugin) => plugin.id)) + 1;
for (const installation of seed.engines) {
  const code = seed.plugins.find((plugin) => plugin.id === installation.plugin_id);
  if (!code) continue;
  const firstOfCode = !variants.some((variant) => variant.path === code.path);
  const id = firstOfCode ? code.id : nextPluginId++;
  variants.push({
    ...code,
    id,
    name: installation.name,
    install_fields: installation.install_fields,
    engine_version: installation.version,
    available: installation.available,
    unavailable_reason: installation.unavailable_reason,
  });
  if (!firstOfCode) {
    seed.schemas[String(id)] = structuredClone(seed.schemas[String(code.id)]);
    seed.extensions[String(id)] = structuredClone(seed.extensions[String(code.id)] ?? []).map((ext) => ({ ...ext, plugin_id: id }));
  }
  variantByInstallation.set(installation.id, id);
}
// Код без установок остаётся вариантом без install-полей — недоступным.
for (const code of seed.plugins.filter((plugin) => plugin.plugin_type === "engine")) {
  if (variants.some((variant) => variant.path === code.path)) continue;
  variants.push({ ...code, install_fields: {}, engine_version: null, available: false, unavailable_reason: "install-поля не заданы" });
}
const plugins: PluginRecord[] = [
  ...variants,
  ...providerPlugins.map((plugin) => ({ ...plugin, install_fields: {}, engine_version: null, available: true, unavailable_reason: null })),
];

const inferences: Inference[] = [];
const profiles: Profile[] = seed.profiles.map(({ engine_plugin_id, trace, reasoning, input_modalities, ...profile }) => {
  void trace, void reasoning, void input_modalities;
  const firstInference = seed.inferences.find((inference) => inference.profile_id === profile.id);
  const code = seed.plugins.find((plugin) => plugin.id === engine_plugin_id);
  const plugin_id = firstInference
    ? (variantByInstallation.get(firstInference.engine_installation_id) ?? engine_plugin_id)
    : (variants.find((variant) => variant.path === code?.path)?.id ?? engine_plugin_id);
  return { ...profile, plugin_id, extensions: profile.extensions ?? {} };
});
for (const { engine_installation_id, trace, reasoning, input_modalities, ...inference } of seed.inferences) {
  void trace, void reasoning, void input_modalities;
  const profile = profiles.find((candidate) => candidate.id === inference.profile_id);
  inferences.push({
    ...inference,
    plugin_id: profile?.plugin_id ?? variantByInstallation.get(engine_installation_id) ?? 0,
    extensions: inference.extensions ?? {},
    plugin_version: profile?.plugin_version ?? "",
    schema_hash: profile?.schema_hash ?? "",
    needs_review: profile?.needs_review ?? false,
  });
}
const runs: Record<string, InferenceRun[]> = Object.fromEntries(
  Object.entries(seed.runs).map(([inferenceId, items]) => [
    inferenceId,
    items.map(({ engine_installation_id, engine_installation_version, ...run }) => ({
      ...run,
      plugin_id: variantByInstallation.get(engine_installation_id) ?? 0,
      engine_version: engine_installation_version,
    })),
  ])
);

const processes = new Map<string, ProcessState>();
let nextPid = 48211;
for (const inference of inferences) {
  const status = seed.statuses[inference.id]?.status ?? "stopped";
  processes.set(inference.id, {
    status,
    readyAt: null,
    stoppingUntil: null,
    pid: status === "running" ? (nextPid += 37) : 0,
    gpuIds: [...inference.gpu_ids],
    tokensIn: 0,
    tokensOut: 0,
    busyUntil: 0,
  });
}

const users: SystemUser[] = [
  { id: 1, username: "admin", role: "admin", is_active: true },
  { id: 2, username: "operator", role: "user", is_active: true },
  { id: 3, username: "demo-agent", role: "user", is_active: true },
  { id: 4, username: "old-tester", role: "user", is_active: false },
];

const textInferences = inferences.filter((i) => seed.router_models[i.id]?.task === "text-generation");
const apiKeys: ApiKeyRecord[] = [
  {
    id: 16,
    key_prefix: "sk-ll-7f3a",
    owner_user_id: 3,
    owner_username: "demo-agent",
    acl_inference_ids: textInferences.slice(0, 3).map((i) => i.id),
    created_at: isoNow(-12 * 24 * 3600e3),
    expires_at: null,
    revoked_at: null,
  },
  {
    id: 17,
    key_prefix: "sk-ll-c21e",
    owner_user_id: 1,
    owner_username: "admin",
    acl_inference_ids: [],
    created_at: isoNow(-5 * 24 * 3600e3),
    expires_at: isoNow(25 * 24 * 3600e3),
    revoked_at: null,
  },
  {
    id: 12,
    key_prefix: "sk-ll-09bd",
    owner_user_id: 2,
    owner_username: "operator",
    acl_inference_ids: [],
    created_at: isoNow(-40 * 24 * 3600e3),
    expires_at: null,
    revoked_at: isoNow(-20 * 24 * 3600e3),
  },
];

const runningTextIds = textInferences.filter((i) => processes.get(i.id)?.status === "running").map((i) => i.id);
const requestLog: RequestLogEntry[] = [];
for (let n = 0; n < 60; n += 1) {
  const inferenceId = runningTextIds[n % Math.max(runningTextIds.length, 1)] ?? null;
  const tokensIn = 800 + Math.floor(Math.random() * 90000);
  requestLog.push({
    id: 2300 - n,
    api_key_id: n % 7 === 0 ? 17 : 16,
    inference_id: inferenceId,
    duration_ms: 900 + Math.floor(Math.random() * 14000),
    tokens_in: tokensIn,
    tokens_out: 40 + Math.floor(Math.random() * 1600),
    status_code: n % 23 === 5 ? 499 : n % 31 === 9 ? 502 : 200,
    started_at: isoNow(-(n * 4 + Math.random() * 3) * 60e3),
  });
}

function download(
  partial: Pick<DownloadState, "model_ref" | "status" | "total_bytes" | "downloaded_bytes"> & Partial<DownloadState>
): DownloadState {
  const ref = partial.model_ref;
  const fileName = partial.file_names?.[0] ?? `${ref.split("/")[1]}.Q4_K_M.gguf`;
  return {
    id: uuid(),
    provider_id: 1,
    target_dir: `${seed.settings.downloads.models_dir}/huggingface/${ref}`,
    error_message: null,
    file_names: [fileName],
    kind: "download",
    speed: null,
    files: [{ filename: fileName, size: partial.total_bytes ?? 0 }],
    created_at: isoNow(-3600e3),
    ...partial,
  };
}

const downloads: DownloadState[] = [
  download({
    model_ref: "unsloth/Qwen3.6-35B-A3B-GGUF",
    status: "active",
    total_bytes: Math.round(9.6 * GiB),
    downloaded_bytes: Math.round(6.9 * GiB),
    file_names: ["Qwen3.6-35B-A3B-UD-Q2_K_XL.gguf"],
  }),
  download({
    model_ref: "Systran/faster-whisper-large-v3",
    status: "queued",
    total_bytes: Math.round(3.09 * GiB),
    downloaded_bytes: 0,
    file_names: ["model.bin", "config.json", "tokenizer.json", "vocabulary.json"],
  }),
  download({
    model_ref: "google/gemma-4-12b-it",
    status: "paused",
    total_bytes: Math.round(24.1 * GiB),
    downloaded_bytes: Math.round(14.4 * GiB),
    file_names: ["model-00001-of-00005.safetensors", "model-00002-of-00005.safetensors"],
  }),
  download({
    model_ref: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    status: "failed",
    total_bytes: Math.round(217 * GiB),
    downloaded_bytes: 0,
    error_message: "HTTP 403: доступ к gated-репозиторию не выдан — примите лицензию на странице модели",
    file_names: ["model-00001-of-00050.safetensors"],
  }),
  download({
    model_ref: "zai-org/GLM-OCR",
    status: "completed",
    total_bytes: Math.round(1.8 * GiB),
    downloaded_bytes: Math.round(1.8 * GiB),
    file_names: ["model.safetensors", "config.json"],
    created_at: isoNow(-26 * 3600e3),
  }),
];
for (const item of downloads) item.files = (item.file_names ?? []).map((filename) => ({ filename, size: Math.round((item.total_bytes ?? 0) / (item.file_names?.length || 1)) }));

const auditLog: Record<string, unknown>[] = [
  { id: 1628411, method: "POST", path: "/inferences/aa79d2e9-dee8-4639-afa9-1e6b88d492ff/start", body_summary: "", initiator: "admin", status_code: 200, created_at: isoNow(-50 * 60e3) },
  { id: 1628410, method: "PATCH", path: "/profiles/23", body_summary: '{"cli_options":"--max-num-seqs 1"}', initiator: "admin", status_code: 200, created_at: isoNow(-55 * 60e3) },
];

export const db = {
  plugins,
  providers: seed.providers,
  models: seed.models,
  profiles,
  inferences,
  schemas: seed.schemas,
  extensions: seed.extensions,
  modelDetails: seed.model_details,
  repoSyncs: seed.repo_syncs,
  formulas: seed.formulas,
  syncStates: seed.sync_states,
  searches: seed.searches,
  runs,
  logs: seed.logs,
  routerModels: seed.router_models,
  gpuBaseline: seed.gpu_status,
  hardware: seed.hardware,
  hostLoadBaseline: seed.host_load,
  settings: seed.settings,
  numa: seed.numa,
  processes,
  users,
  apiKeys,
  requestLog,
  downloads,
  auditLog,
  nextPid: () => (nextPid += 37),
  /** Момент загрузки страницы: метрики раньше него синтезируются, позже —
   * берутся из накопленных отсчётов симуляции. */
  bootedAt: Date.now(),
};

/** Имя кода плагина — каталог, общий у всех вариантов движка; имя самого
 * плагина — имя варианта («llama.cpp (cuda)»). */
export function pluginCode(plugin: PluginRecord | undefined): string {
  return plugin?.path.split("/").pop() ?? "";
}

export const index = {
  model: (id: number) => byId(db.models).get(id),
  profile: (id: number) => byId(db.profiles).get(id),
  inference: (id: string) => db.inferences.find((i) => i.id === id || i.slug === id),
  plugin: (id: number) => byId(db.plugins).get(id),
};

export function nextId(items: { id: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

export type { FieldDescriptor };
