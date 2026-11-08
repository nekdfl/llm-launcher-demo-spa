import { ApiError, apiFetch, apiJson, apiText } from "./client";
import type {
  AssistantSuggestionsResponse,
  ApiKeyCreated,
  ApiKeyRecord,
  ComposedStatus,
  DownloadRecord,
  DownloadSettings,
  DownloadStats,
  EngineExtension,
  ExtensionSelection,
  EngineInstallation,
  GpuStatusEntry,
  GpuPowerHistoryPoint,
  HistorySettings,
  Inference,
  InferenceRun,
  RunTraceEntry,
  ModelDeletionPreview,
  ModelDetailResponse,
  ModelEntity,
  ModelsRelocationResult,
  ModelSearchResult,
  RepoSyncReport,
  RepoSyncState,
  RepoUpdateResult,
  Profile,
  ProfileFormulaSuggestion,
  PluginRecord,
  Provider,
  RequestLogEntry,
  SearchVariant,
  SystemUser,
  MetricsRetentionSettings,
  StandLoadHistoryPoint,
  ThroughputHistoryPoint,
  UnitUnloadResult,
  HardwareInfo,
} from "./types";

const BASE = "/orchestrator/api";

export interface FieldDescriptor {
  name: string;
  type: string;
  label: string;
  required: boolean;
  default: unknown;
  description: string;
  choices: string[] | null;
}

/** Элемент каталога роутера для одного inference: задача движка, модальности,
 * голоса TTS и возможности общего речевого интерфейса. */
export interface RouterModelEntry {
  id: string;
  slug: string;
  task: string | null;
  input_modalities: string[];
  output_modalities: string[];
  supported_voices?: string[];
  capabilities?: Record<string, unknown>;
}

export interface PluginSchema {
  install_schema: FieldDescriptor[];
  profile_schema: FieldDescriptor[];
  tasks?: string[];
  /** Почему к плагину нельзя ставить расширения; `null` — можно. */
  extensions_unsupported_reason?: string | null;
  extensions?: EngineExtension[];
}

export interface HostLoadSnapshot {
  cpu_percent: number;
  ram_percent: number;
  disk_read_bytes_per_sec: number;
  disk_write_bytes_per_sec: number;
  net_recv_bytes_per_sec: number;
  net_sent_bytes_per_sec: number;
}

export interface CreateInferenceInput {
  name: string;
  profile_id: number;
  model_id: number;
  engine_installation_id: number;
  port?: number;
  gpu_ids?: number[];
  structural_fields?: Record<string, unknown>;
  cli_options?: string;
  system_prompt?: string;
  autostart?: boolean;
  reasoning?: boolean;
  input_modalities?: string[];
  trace?: boolean;
}

export interface UpdateInferenceInput {
  name?: string;
  slug?: string;
  port?: number;
  gpu_ids?: number[];
  structural_fields?: Record<string, unknown>;
  cli_options?: string;
  system_prompt?: string;
  autostart?: boolean;
  reasoning?: boolean;
  input_modalities?: string[];
  trace?: boolean;
}

export interface CreateProfileInput {
  name: string;
  model_id: number;
  engine_plugin_id: number;
  plugin_version: string;
  schema_fields: FieldDescriptor[];
  gpu_ids?: number[];
  port?: number | null;
  structural_fields?: Record<string, unknown>;
  cli_options?: string;
  system_prompt?: string;
  reasoning?: boolean;
  input_modalities?: string[];
  trace?: boolean;
  extensions?: ExtensionSelection;
}

export const orchestratorApi = {
  // Domain
  listInferences: () => apiJson<Inference[]>(`${BASE}/inferences`),
  getInference: (id: string) => apiJson<Inference>(`${BASE}/inferences/${id}`),
  createInference: (payload: CreateInferenceInput) =>
    apiJson<Inference>(`${BASE}/inferences`, { method: "POST", body: JSON.stringify(payload) }),
  updateInference: (id: string, payload: UpdateInferenceInput) =>
    apiJson<Inference>(`${BASE}/inferences/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteInference: (id: string) => apiJson<void>(`${BASE}/inferences/${id}`, { method: "DELETE" }),

  listModels: () => apiJson<ModelEntity[]>(`${BASE}/models`),
  getModel: (id: number) => apiJson<ModelEntity>(`${BASE}/models/${id}`),
  // Передаётся желаемое состояние, а не «переключи»: повторное
  // нажатие не может дать неопределённый результат.
  setModelFavorite: (id: number, favorite: boolean) =>
    apiJson<ModelEntity>(`${BASE}/models/${id}/favorite`, {
      method: "PUT",
      body: JSON.stringify({ favorite }),
    }),

  listProfiles: () => apiJson<Profile[]>(`${BASE}/profiles`),
  getProfile: (id: number) => apiJson<Profile>(`${BASE}/profiles/${id}`),
  createProfile: (payload: CreateProfileInput) =>
    apiJson<Profile>(`${BASE}/profiles`, { method: "POST", body: JSON.stringify(payload) }),
  updateProfile: (id: number, payload: Partial<CreateProfileInput>) =>
    apiJson<Profile>(`${BASE}/profiles/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteProfile: (id: number) => apiJson<void>(`${BASE}/profiles/${id}`, { method: "DELETE" }),

  listEngineInstallations: () => apiJson<EngineInstallation[]>(`${BASE}/engine-installations`),
  getEngineInstallation: (id: number) => apiJson<EngineInstallation>(`${BASE}/engine-installations/${id}`),
  createEngineInstallation: (payload: { name: string; plugin_id: number; install_fields: Record<string, unknown> }) =>
    apiJson<EngineInstallation>(`${BASE}/engine-installations`, { method: "POST", body: JSON.stringify(payload) }),
  recheckEngineInstallation: (id: number) =>
    apiJson<EngineInstallation>(`${BASE}/engine-installations/${id}/recheck`, { method: "POST" }),
  updateEngineInstallation: (
    id: number,
    payload: { name?: string; install_fields?: Record<string, unknown> }
  ) => apiJson<EngineInstallation>(`${BASE}/engine-installations/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteEngineInstallation: (id: number) =>
    apiJson<void>(`${BASE}/engine-installations/${id}`, { method: "DELETE" }),

  listProviders: () => apiJson<Provider[]>(`${BASE}/providers`),
  getProvider: (id: number) => apiJson<Provider>(`${BASE}/providers/${id}`),
  updateProviderConfig: (id: number, config: Record<string, unknown>) =>
    apiJson<Provider>(`${BASE}/providers/${id}`, { method: "PATCH", body: JSON.stringify({ config }) }),

  // Сверка и обновление до полной копии репозитория
  getRepoSync: (providerId: number, repoId: string) =>
    apiJson<RepoSyncReport>(`${BASE}/providers/${providerId}/repo-sync?repo_id=${encodeURIComponent(repoId)}`),
  listRepoSyncStates: () => apiJson<RepoSyncState[]>(`${BASE}/model-sync/states`),
  // Запуск асинхронный: ответ приходит сразу, ход проверки виден по
  // признаку `checking` в состояниях.
  checkModelUpdates: () =>
    apiJson<{ started: boolean; states: RepoSyncState[] }>(`${BASE}/model-sync/check-updates`, { method: "POST" }),
  updateRepo: (providerId: number, repoId: string, deleteExtra: boolean) =>
    apiJson<RepoUpdateResult>(`${BASE}/providers/${providerId}/repo-update`, {
      method: "POST",
      body: JSON.stringify({ repo_id: repoId, delete_extra: deleteExtra }),
    }),
  updateRepoFile: (providerId: number, repoId: string, filename: string) =>
    apiJson<{ started: boolean }>(`${BASE}/providers/${providerId}/file-update`, {
      method: "POST",
      body: JSON.stringify({ repo_id: repoId, filename }),
    }),

  getPluginSchema: (pluginId: number) => apiJson<PluginSchema>(`${BASE}/plugins/${pluginId}/schema`),

  // Речевые inference (speech-voice-api): задача и голоса из каталога роутера,
  // проверка синтеза и распознавания из консоли.
  describeRouterModel: (inferenceId: string) => apiJson<RouterModelEntry>(`${BASE}/router-models/${inferenceId}`),
  synthesizeSpeech: async (inferenceId: string, input: string, voice: string | null): Promise<Blob> => {
    const response = await apiFetch(`${BASE}/inferences/${inferenceId}/audio/speech`, {
      method: "POST",
      body: JSON.stringify({ input, ...(voice ? { voice } : {}), response_format: "wav" }),
    });
    if (!response.ok) throw new ApiError(response.status, await response.json().catch(() => null));
    return response.blob();
  },
  transcribeAudio: (inferenceId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    form.append("response_format", "json");
    return apiJson<{ text: string; usage?: { seconds: number } }>(
      `${BASE}/inferences/${inferenceId}/audio/transcriptions`,
      { method: "POST", body: form, headers: {} }
    );
  },

  // Lifecycle
  startInference: (id: string, gpuIds?: number[]) =>
    apiJson<{ unit: string; warnings?: string[] }>(`${BASE}/inferences/${id}/start`, {
      method: "POST",
      body: gpuIds ? JSON.stringify({ gpu_ids: gpuIds }) : undefined,
    }),
  stopInference: (id: string) => apiJson<{ status: string }>(`${BASE}/inferences/${id}/stop`, { method: "POST" }),
  stopAllInferences: () =>
    apiJson<{ units: UnitUnloadResult[] }>(`${BASE}/inferences/stop-all`, { method: "POST" }),
  getInferenceStatus: (id: string) => apiJson<ComposedStatus>(`${BASE}/inferences/${id}/status`),
  getStopProgress: (id: string, secondsSinceStopRequested: number) =>
    apiJson<{ progress: string }>(
      `${BASE}/inferences/${id}/stop-progress?seconds_since_stop_requested=${secondsSinceStopRequested}`
    ),
  getInferenceLogs: (id: string, lines = 200) =>
    apiJson<{ lines: string[] }>(`${BASE}/inferences/${id}/logs?lines=${lines}`),

  // Resources
  getGpuStatus: (gpuIds: number[], inferenceIds: string[] = []) =>
    apiJson<GpuStatusEntry[]>(
      `${BASE}/resources/gpu-status?gpu_ids=${gpuIds.join(",")}&inference_ids=${inferenceIds.join(",")}`
    ),
  updateResourceSettings: (payload: {
    cpu_pool: number[];
    gpu_pool: number[];
    port_range_start: number;
    port_range_end: number;
    disk_ceiling_bytes_per_sec: number;
    net_ceiling_bytes_per_sec: number;
  }) =>
    apiJson<{
      cpu_pool: number[];
      gpu_pool: number[];
      port_range_start: number;
      port_range_end: number;
      disk_ceiling_bytes_per_sec: number;
      net_ceiling_bytes_per_sec: number;
    }>(`${BASE}/resources/settings`, { method: "PATCH", body: JSON.stringify(payload) }),
  getResourceSettings: () =>
    apiJson<{
      cpu_pool: number[];
      gpu_pool: number[];
      port_range_start: number;
      port_range_end: number;
      disk_ceiling_bytes_per_sec: number;
      net_ceiling_bytes_per_sec: number;
    }>(`${BASE}/resources/settings`),
  getHostLoad: () => apiJson<HostLoadSnapshot>(`${BASE}/resources/host-load`),

  // Metrics history — accumulated by the orchestrator in the background, so
  // a chart shows the whole stored period and not just the time this tab
  // has been open.
  getHostLoadHistory: (range: string) =>
    apiJson<{ range: string; step_seconds?: number; points: StandLoadHistoryPoint[] }>(
      `${BASE}/metrics/host-load-history?range=${range}`
    ),
  getThroughputHistory: (range: string, inferenceIds: string[] = []) =>
    apiJson<{ range: string; step_seconds?: number; points: ThroughputHistoryPoint[] }>(
      `${BASE}/metrics/inference-throughput-history?range=${range}` +
        (inferenceIds.length > 0 ? `&inference_ids=${inferenceIds.join(",")}` : "")
    ),
  getGpuPowerHistory: (range: string) =>
    apiJson<{ range: string; step_seconds?: number; points: GpuPowerHistoryPoint[] }>(
      `${BASE}/metrics/gpu-power-history?range=${range}`
    ),
  getMetricsSettings: () => apiJson<MetricsRetentionSettings>(`${BASE}/metrics/settings`),
  updateMetricsSettings: (settings: MetricsRetentionSettings) =>
    apiJson<MetricsRetentionSettings>(`${BASE}/metrics/settings`, {
      method: "PATCH",
      body: JSON.stringify(settings),
    }),
  getInferenceThroughput: (inferenceIds: string[]) =>
    apiJson<Record<string, { tokens_in_per_sec: number; tokens_out_per_sec: number }>>(
      `${BASE}/resources/inference-throughput?inference_ids=${inferenceIds.join(",")}`
    ),

  // History
  listRunsForProfile: (profileId: number) => apiJson<InferenceRun[]>(`${BASE}/history/runs?profile_id=${profileId}`),
  listRunsForInference: (inferenceId: string) =>
    apiJson<InferenceRun[]>(`${BASE}/history/runs?inference_id=${inferenceId}`),

  // Plugins (plugin-and-engine-management-ui) — install is admin-only server-side
  listPlugins: () => apiJson<PluginRecord[]>(`${BASE}/plugins`),
  installPlugin: (archive: File, sha256: string, name: string) => {
    const form = new FormData();
    form.append("archive", archive);
    form.append("sha256", sha256);
    form.append("name", name);
    // apiFetch sets Content-Type: application/json when a body exists —
    // wrong for multipart, the browser must set the boundary itself.
    return apiJson<{ status: string; name: string }>(`${BASE}/plugins/install`, {
      method: "POST",
      body: form,
      headers: {},
    });
  },
  listPluginExtensions: (pluginId: number) => apiJson<EngineExtension[]>(`${BASE}/plugins/${pluginId}/extensions`),
  installPluginExtension: (pluginId: number, archive: File, sha256: string) => {
    const form = new FormData();
    form.append("archive", archive);
    form.append("sha256", sha256);
    return apiJson<EngineExtension>(`${BASE}/plugins/${pluginId}/extensions/install`, {
      method: "POST",
      body: form,
      headers: {},
    });
  },
  deletePluginExtension: (pluginId: number, extensionId: number) =>
    apiJson<void>(`${BASE}/plugins/${pluginId}/extensions/${extensionId}`, { method: "DELETE" }),
  rescanPluginExtensions: (pluginId: number) =>
    apiJson<EngineExtension[]>(`${BASE}/plugins/${pluginId}/extensions/rescan`, { method: "POST" }),
  deletePlugin: (pluginId: number) => apiJson<void>(`${BASE}/plugins/${pluginId}`, { method: "DELETE" }),
  disablePlugin: (pluginId: number) => apiJson<PluginRecord>(`${BASE}/plugins/${pluginId}/disable`, { method: "POST" }),
  enablePlugin: (pluginId: number) => apiJson<PluginRecord>(`${BASE}/plugins/${pluginId}/enable`, { method: "POST" }),

  // Downloads (provider-plugin-and-model-downloads)
  listDownloads: () => apiJson<DownloadRecord[]>(`${BASE}/downloads`),
  getDownload: (downloadId: string) => apiJson<DownloadRecord>(`${BASE}/downloads/${downloadId}`),
  getDownloadProgress: (downloadId: string) =>
    apiJson<{
      downloaded_bytes: number | null;
      total_bytes: number | null;
      percent: number | null;
      /** Сглаженная скорость, измеренная воркером; null — не сообщается. */
      speed_bytes_per_sec?: number | null;
    }>(
      `${BASE}/downloads/${downloadId}/progress`
    ),
  cancelDownload: (downloadId: string) =>
    apiJson<DownloadRecord>(`${BASE}/downloads/${downloadId}/cancel`, { method: "POST" }),
  pauseDownload: (downloadId: string) =>
    apiJson<DownloadRecord>(`${BASE}/downloads/${downloadId}/pause`, { method: "POST" }),
  resumeDownload: (downloadId: string) =>
    apiJson<DownloadRecord>(`${BASE}/downloads/${downloadId}/resume`, { method: "POST" }),
  deleteDownload: (downloadId: string) => apiJson<void>(`${BASE}/downloads/${downloadId}`, { method: "DELETE" }),
  getDownloadSettings: () => apiJson<DownloadSettings>(`${BASE}/downloads/settings`),
  updateDownloadSettings: (payload: Partial<DownloadSettings>) =>
    apiJson<DownloadSettings>(`${BASE}/downloads/settings`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  getDownloadStats: () => apiJson<DownloadStats>(`${BASE}/downloads/stats`),
  reorderDownloads: (orderedIds: string[]) =>
    apiJson<DownloadRecord[]>(`${BASE}/downloads/reorder`, {
      method: "POST",
      body: JSON.stringify({ ordered_ids: orderedIds }),
    }),
  searchProviderModels: (providerId: number, query: string, filters: { tags?: string[]; sort?: string } = {}) => {
    const params = new URLSearchParams({ query });
    if (filters.tags && filters.tags.length > 0) params.set("tags", filters.tags.join(","));
    if (filters.sort) params.set("sort", filters.sort);
    return apiJson<ModelSearchResult[]>(`${BASE}/providers/${providerId}/search?${params.toString()}`);
  },
  listProviderVariants: (providerId: number, repoId: string) =>
    apiJson<SearchVariant[]>(
      `${BASE}/providers/${providerId}/variants?repo_id=${encodeURIComponent(repoId)}`
    ),
  createDownload: (payload: { provider_id: number; model_ref: string; variant_label: string; files: { filename: string; size: number }[] }) =>
    apiJson<DownloadRecord>(`${BASE}/downloads`, { method: "POST", body: JSON.stringify(payload) }),
  getModelDetail: (providerId: number, repoId: string) =>
    apiJson<ModelDetailResponse>(
      `${BASE}/providers/${providerId}/model-detail?repo_id=${encodeURIComponent(repoId)}`
    ),
  refreshModelVariant: (providerId: number, repoId: string, filename: string) =>
    apiJson<{ started: boolean; download?: DownloadRecord }>(`${BASE}/providers/${providerId}/model-detail/refresh`, {
      method: "POST",
      body: JSON.stringify({ repo_id: repoId, filename }),
    }),

  // Model deletion (spec: preview before the separate confirming call)
  getModelDeletionPreview: (modelId: number) =>
    apiJson<ModelDeletionPreview>(`${BASE}/models/${modelId}/deletion-preview`),
  deleteModel: (modelId: number) => apiJson<void>(`${BASE}/models/${modelId}`, { method: "DELETE" }),
  // Исправление пути существующей записи: перерегистрация сменила бы
  // `model_id`, на который ссылаются профили и инференсы.
  setModelFilePath: (modelId: number, filePath: string) =>
    apiJson<ModelEntity>(`${BASE}/models/${modelId}/file-path`, {
      method: "PUT",
      body: JSON.stringify({ file_path: filePath }),
    }),
  // Снятие записи без удаления файлов — не то же, что deleteModel.
  detachModel: (modelId: number) => apiJson<void>(`${BASE}/models/${modelId}/record`, { method: "DELETE" }),
  restoreModel: (modelId: number) =>
    apiJson<{ started: boolean; download: DownloadRecord }>(`${BASE}/downloads/restore-model`, {
      method: "POST",
      body: JSON.stringify({ model_id: modelId }),
    }),
  relocateModels: (previousModelsDir: string) =>
    apiJson<ModelsRelocationResult>(`${BASE}/downloads/settings/relocate-models`, {
      method: "POST",
      body: JSON.stringify({ previous_models_dir: previousModelsDir }),
    }),

  // Profile formula (profile-default-formula) — pre-fills cli_options text
  getProfileFormula: (modelId: number, gpuIds: number[] = []) =>
    apiJson<ProfileFormulaSuggestion>(
      `${BASE}/profile-formula?model_id=${modelId}&gpu_ids=${gpuIds.join(",")}`
    ),
  copyProfile: (profileId: number, newName: string) =>
    apiJson<Profile>(`${BASE}/profiles/${profileId}/copy`, {
      method: "POST",
      body: JSON.stringify({ name: newName }),
    }),

  // Router support — API keys + request log (router-openai-compatible-api)
  listApiKeys: () => apiJson<ApiKeyRecord[]>(`${BASE}/api-keys`),
  createApiKey: (ownerUsername: string, aclInferenceIds: string[], expiresAt: string | null) =>
    apiJson<ApiKeyCreated>(`${BASE}/api-keys`, {
      method: "POST",
      body: JSON.stringify({
        owner_user_id: 0,
        owner_username: ownerUsername,
        acl_inference_ids: aclInferenceIds,
        expires_at: expiresAt,
      }),
    }),
  revokeApiKey: (keyId: number) => apiJson<void>(`${BASE}/api-keys/${keyId}`, { method: "DELETE" }),
  deleteApiKey: (keyId: number) => apiJson<void>(`${BASE}/api-keys/${keyId}/record`, { method: "DELETE" }),

  // LLM profile assistant (llm-profile-assistant) — never blocks profile
  // creation: unavailability comes back as 200 + available:false.
  getAssistantSettings: () =>
    apiJson<{ router_base_url: string; model: string; has_api_key: boolean; configured: boolean }>(
      `${BASE}/assistant/settings`
    ),
  updateAssistantSettings: (payload: { router_base_url: string; api_key: string; model: string }) =>
    apiJson<{ router_base_url: string; model: string; configured: boolean }>(`${BASE}/assistant/settings`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  getAssistantSuggestions: (modelId: number) =>
    apiJson<AssistantSuggestionsResponse>(`${BASE}/models/${modelId}/assistant-suggestions`),
  listRequestLog: (limit = 100) => apiJson<RequestLogEntry[]>(`${BASE}/request-log?limit=${limit}`),
  getRequestLogSettings: () => apiJson<{ max_records: number }>(`${BASE}/request-log/settings`),
  updateRequestLogSettings: (maxRecords: number) =>
    apiJson<{ max_records: number }>(`${BASE}/request-log/settings`, {
      method: "PATCH",
      body: JSON.stringify({ max_records: maxRecords }),
    }),

  // Run history retention (run-history-and-logs) — per-profile record count
  // plus a total-bytes ceiling on kept run logs.
  getHistorySettings: () => apiJson<HistorySettings>(`${BASE}/history/settings`),
  updateHistorySettings: (payload: Partial<HistorySettings>) =>
    apiJson<HistorySettings>(`${BASE}/history/settings`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  // Журнал завершённого запуска — из его архива, хвостом (срез читается
  // потоком из сжатого файла, без полной распаковки).
  getRunLog: async (runId: number, lines = 200): Promise<string[]> => {
    const text = await apiText(`${BASE}/history/runs/${runId}/log?lines=${lines}`);
    return text === "" ? [] : text.split("\n");
  },
  // Сохранённые запросы запуска (trace) — отдельно от журнала процесса:
  // движок тел не пишет, их сохраняет роутер.
  getRunTrace: (runId: number, entries = 20) =>
    apiJson<RunTraceEntry[]>(`${BASE}/history/runs/${runId}/trace?entries=${entries}`),

  // Audit log (audit-log-middleware)
  listAuditLog: (limit = 100) => apiJson<Record<string, unknown>[]>(`${BASE}/audit-log?limit=${limit}`),
  getAuditSettings: () => apiJson<{ max_records: number }>(`${BASE}/audit-log/settings`),
  updateAuditSettings: (maxRecords: number) =>
    apiJson<{ max_records: number }>(`${BASE}/audit-log/settings`, {
      method: "PATCH",
      body: JSON.stringify({ max_records: maxRecords }),
    }),

  // NUMA topology (gpu-cpu-port-resource-accounting)
  getNumaTopology: () => apiJson<Record<string, number[]>>(`${BASE}/resources/numa-topology`),
  getHardwareInfo: () => apiJson<HardwareInfo>(`${BASE}/resources/hardware-info`),
};
