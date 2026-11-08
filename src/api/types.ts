import type { FieldDescriptor } from "./orchestrator";

export interface Provider {
  id: number;
  name: string;
  plugin_id: number;
  config: Record<string, unknown>;
}

export interface ModelEntity {
  id: number;
  provider_id: number;
  ref: string;
  file_path: string;
  format: string;
  /** Задача модели (HF `pipeline_tag`) из карточки; `null` — неизвестна. */
  pipeline_tag?: string | null;
  metadata: Record<string, unknown>;
  /** Избранная модель идёт первой в перечнях и помечается звёздочкой. */
  favorite: boolean;
  /** Годность записи: файл по `file_path` на месте. Считается по
   * файловой системе при выдаче, а не хранится в базе. */
  validity: ModelValidity;
}

export interface ModelValidity {
  usable: boolean;
  /** Причина негодности; пусто у годной записи. */
  reason: string | null;
}

export interface ModelsRelocationResult {
  moved: ModelEntity[];
  skipped: { model_id: number; file_path: string; reason: string }[];
}

export interface Profile {
  id: number;
  /** Годность модели профиля — унаследована по `model_id`, не считается
   * здесь заново. */
  model_validity?: ModelValidity;
  name: string;
  model_id: number;
  engine_plugin_id: number;
  gpu_ids: number[];
  port: number | null;
  structural_fields: Record<string, unknown>;
  cli_options: string;
  system_prompt: string;
  /** Признаки, которые движок не сообщает: задаются человеком и
   * наследуются создаваемыми inference. */
  reasoning: boolean;
  input_modalities: string[];
  plugin_version: string;
  schema_hash: string;
  origin_profile_id: number | null;
  needs_review: boolean;
  extensions?: ExtensionSelection;
}

export interface EngineInstallation {
  id: number;
  name: string;
  plugin_id: number;
  install_fields: Record<string, unknown>;
  version: string | null;
  available: boolean;
  unavailable_reason: string | null;
}

export interface Inference {
  id: string;
  slug: string;
  name: string;
  profile_id: number;
  model_id: number;
  engine_installation_id: number;
  gpu_ids: number[];
  port: number;
  structural_fields: Record<string, unknown>;
  cli_options: string;
  system_prompt: string;
  autostart: boolean;
  /** Уходят в `GET /v1/models` роутера: движок эти признаки не знает. */
  reasoning: boolean;
  input_modalities: string[];
  /** Годность модели этого inference — унаследована по `model_id`. */
  model_validity?: ModelValidity;
  /** Последний запуск этого inference: время старта задаёт порядок плиток на
   * Dashboard, пики — их содержимое. `null` — ни разу не запускался либо
   * значение не было снято (`0` значил бы снятый ноль). */
  /** Опция trace: журнал запуска содержит входящие и исходящие запросы.
   * Применяется при следующем запуске — подробность журналирования задаётся
   * аргументом процесса. */
  trace: boolean;
  extensions?: ExtensionSelection;
  last_started_at: string | null;
  last_run_peak_vram_bytes: number | null;
  last_run_peak_ram_bytes: number | null;
}

export type InferenceStatusLabel = "stopped" | "warming" | "running" | "unresponsive" | "failed";

export interface ComposedStatus {
  status: InferenceStatusLabel;
  color: string;
  gpu_considered_free: boolean;
}

export interface GpuStatusEntry {
  gpu_id: number;
  intended_inference_ids: string[];
  discrepancy: boolean;
  used_bytes: number | null;
  total_bytes: number | null;
  utilization_percent: number | null;
  temperature_c: number | null;
  processes: { pid: number; used_bytes: number }[];
  /** Телеметрия карты как в nvtop. `null` — карта не сообщила значение; это
   * не то же самое, что ноль (простаивающая карта честно отдаёт 0 МБ/с). */
  name: string | null;
  pcie_gen_current: number | null;
  pcie_gen_max: number | null;
  pcie_width_current: number | null;
  pcie_width_max: number | null;
  graphics_clock_mhz: number | null;
  memory_clock_mhz: number | null;
  fan_speed_percent: number | null;
  power_draw_watts: number | null;
  power_limit_watts: number | null;
  pcie_rx_bytes_per_sec: number | null;
  pcie_tx_bytes_per_sec: number | null;
}

/** Итог массовой выгрузки по одному юниту: `inference_id` отсутствует у
 * осиротевшего юнита, за которым нет записи inference. */
export interface UnitUnloadResult {
  unit: string;
  inference_id: string | null;
  outcome: "stopped" | "killed" | "failed";
  detail: string | null;
}

/** Точка истории: `at` — ISO-момент бакета. Отсутствующих периодов в
 * ответе нет — разрыв в данных остаётся разрывом, а не нулями. */
export interface StandLoadHistoryPoint {
  at: string;
  cpu_percent: number;
  ram_percent: number;
  disk_read_bytes_per_sec: number;
  disk_write_bytes_per_sec: number;
  net_recv_bytes_per_sec: number;
  net_sent_bytes_per_sec: number;
}

export interface ThroughputHistoryPoint {
  at: string;
  tokens_in_per_sec: number;
  tokens_out_per_sec: number;
}

export interface GpuPowerHistoryPoint {
  at: string;
  gpu_id: number;
  power_watts: number;
}

export interface MetricsRetentionSettings {
  raw_retention_hours: number;
  aggregate_retention_days: number;
}

export type FileSyncState = "same" | "changed" | "missing" | "extra";

/** Расхождение по одному файлу. `remote_size` пуст у лишнего локально
 * файла, `local_size` — у отсутствующего. `content_verified` ложно, когда
 * снимка не было и сверялся только размер. */
export interface FileSyncEntry {
  filename: string;
  state: FileSyncState;
  remote_size: number | null;
  local_size: number | null;
  content_verified: boolean;
}

export interface RepoSyncReport {
  has_updates: boolean;
  content_verified: boolean;
  missing_count: number;
  changed_count: number;
  extra_count: number;
  files: FileSyncEntry[];
}

/** Сохранённый результат проверки. Отсутствие записи означает «не
 * проверялась» — это не то же самое, что «совпадает с репозиторием». */
export interface RepoSyncState {
  provider_id: number;
  model_ref: string;
  /** Пусто, пока модель ни разу не проверялась. */
  checked_at: string | null;
  missing_count: number;
  changed_count: number;
  extra_count: number;
  content_verified: boolean;
  check_error: string | null;
  has_updates: boolean;
  /** Проверка этой модели идёт сейчас. */
  checking: boolean;
}

export interface RepoUpdateResult {
  started: boolean;
  deleted: string[];
  kept_extra: string[];
  download?: DownloadRecord;
}

export interface InferenceRun {
  id: number;
  inference_id: string;
  profile_id: number;
  engine_installation_id: number;
  engine_installation_version: string | null;
  gpu_ids: number[];
  port: number;
  started_at: string;
  stopped_at: string | null;
  /** `unobserved` — запуск кончился вне наблюдения оркестратора (процесс
   * умер вместе с юнитом либо стенд перезагрузили). */
  outcome: "stopped" | "failed" | "unobserved" | null;
  peak_vram_bytes: number | null;
  peak_ram_bytes: number | null;
  initiated_by: string | null;
  log_file_path: string | null;
}

export interface PluginRecord {
  id: number;
  name: string;
  plugin_version: string;
  contract_version: string;
  plugin_type: string;
  path: string;
  status: string;
  error_detail: string | null;
  enabled: boolean;
  /** Задачи engine-плагина (HF `pipeline_tag`); пусто у provider. */
  tasks: string[];
  /** Форматы моделей, которые запускает движок. */
  model_formats?: string[];
}

/** Расширение engine-плагина (словари речевых движков). */
export interface EngineExtension {
  id: number;
  plugin_id: number;
  name: string;
  version: string;
  task: string;
  path: string;
  /** `ok` | `invalid_manifest` | `incompatible` | `missing`. */
  status: string;
  error_detail: string | null;
  dictionaries: { name: string; path: string; description: string }[];
  options: FieldDescriptor[];
}

/** Включённые расширения и значения их опций: наличие ключа = включено. */
export type ExtensionSelection = Record<string, Record<string, unknown>>;

export interface ApiKeyRecord {
  id: number;
  key_prefix: string;
  owner_user_id: number;
  owner_username: string;
  acl_inference_ids: string[];
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface ApiKeyCreated extends ApiKeyRecord {
  /** The raw key, visible exactly once in this creation response. */
  key: string;
}

export interface RequestLogEntry {
  id: number;
  api_key_id: number | null;
  inference_id: string | null;
  duration_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  status_code: number;
  started_at: string;
}

export interface DownloadRecord {
  id: string;
  provider_id: number;
  model_ref: string;
  target_dir: string;
  total_bytes: number | null;
  downloaded_bytes: number | null;
  status: string;
  error_message: string | null;
  file_names: string[] | null;
  /** Вид задачи: обычная закачка или обновление — от него зависит имя. */
  kind?: "download" | "update";
}

export interface DownloadSettings {
  /** Приходит только в ответе на смену каталога: сколько записей
   * остались с путями в прежнем каталоге и какой он был. */
  orphaned_models?: number;
  previous_models_dir?: string;
  models_dir: string;
  rate_limit_bytes_per_sec: number;
  max_concurrent_downloads: number;
}

export interface DownloadStats {
  /** Активные задачи — загружающиеся и ожидающие очереди. */
  active_count: number;
  completed_count: number;
  /** Число зарегистрированных (скачанных) моделей — приходит той же
   * сводкой, чтобы панели статистики хватало одного запроса. */
  models_count: number;
  free_bytes: number | null;
  remaining_bytes: number;
  speed_bytes_per_sec: number | null;
  /** Загружающиеся задачи (`active`, без очереди). */
  downloading_count?: number;
  eta_active_seconds: number | null;
  eta_all_seconds: number | null;
  active_etas: Record<string, number | null>;
}

export interface SearchVariant {
  filename: string;
  size: number;
}

export interface ModelSearchResult {
  id: string;
  downloads: number;
  likes: number;
  tags: string[];
  pipeline_tag: string | null;
  library_name: string | null;
  last_modified: string | null;
}

export interface ModelVariantDetail {
  filename: string;
  quant_label: string;
  size: number;
  downloaded: boolean;
  local_size: number | null;
  disk_sufficient: boolean;
  estimated_vram_bytes: number;
}

/** Файл репозитория — одна строка списка карточки. Скачан ли он, решает
 * диск: `downloaded` — файл лежит по пути закачки. */
export interface ModelFileDetail {
  filename: string;
  size: number;
  downloaded: boolean;
  local_size: number | null;
  disk_sufficient: boolean;
}

export interface ModelDetailResponse {
  description: string | null;
  source_url: string | null;
  total_bytes: number;
  total_disk_sufficient: boolean;
  variants: ModelVariantDetail[];
  /** Особенности репозитория, применимые вместе с любым вариантом
   * (`mmproj`): они не варианты и показываются отдельной группой. */
  features: string[];
  /** Все файлы репозитория. */
  files: ModelFileDetail[];
  /** Объём файлов репозитория, уже лежащих на диске. */
  local_bytes: number;
  /** `null` — формат, которого оркестратор не знает. */
  repo_format: "gguf" | "safetensors" | "ninfer" | null;
  /** Доступные установки движков, объявляющих формат репозитория. */
  supporting_engines: { id: number; name: string }[];
}

export interface ModelDeletionPreview {
  model_id: number;
  file_path: string;
  size_bytes: number;
}

export interface ProfileFormulaSuggestion {
  cli_options: string;
  model_weight_bytes: number;
  kv_cache_bytes: number;
  recommended_context_length: number;
  n_gpu_layers: string;
  gpu_memory_utilization: number;
  warnings: string[];
}

export interface SystemUser {
  id: number;
  username: string;
  role: "admin" | "user";
  is_active: boolean;
}

export interface AssistantSuggestion {
  field: string;
  value: string;
  reason: string;
  quote: string;
}

export interface AssistantSuggestionsResponse {
  available: boolean;
  reason: string | null;
  suggestions: AssistantSuggestion[];
  warnings: string[];
}

export interface HardwareGpuInfo {
  gpu_id: number;
  name: string;
  used_bytes: number;
  total_bytes: number;
  utilization_percent: number;
  temperature_c: number;
}

export interface HardwareInfo {
  cpu: { model_name: string; core_count: number };
  ram: { total_bytes: number; available_bytes: number };
  numa_topology: Record<string, number[]>;
  gpus: HardwareGpuInfo[] | null;
  nvml_error: string | null;
}

/** Политика хранения истории запусков и их журналов
 * (run-history-and-logs, inference-log-archive-retention-and-trace). */
export interface HistorySettings {
  max_records_per_profile: number;
  max_total_log_bytes: number;
  max_log_age_days: number;
  max_log_files: number;
}

/** Одна сохранённая пара «запрос — ответ» запуска (опция trace). */
export interface RunTraceEntry {
  at: string;
  request: unknown;
  response: unknown;
}
