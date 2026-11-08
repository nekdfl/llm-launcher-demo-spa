import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiErrorMessage } from "../../api/client";
import { orchestratorApi } from "../../api/orchestrator";
import type {
  DownloadRecord,
  ModelDetailResponse,
  ModelEntity,
  ModelFileDetail,
  ModelSearchResult,
  RepoSyncReport,
} from "../../api/types";
import { DownloadStatsPanel } from "../../components/DownloadStatsPanel";
import { ModelCard } from "../../components/ModelCard";
import { ModelMetaInfo } from "../../components/ModelMetaInfo";
import { ModelTile } from "../../components/ModelTile";
import { ModelsQuickSwitch } from "../../components/ModelsQuickSwitch";
import { FIELD_INPUT, GHOST_BUTTON, PRIMARY_BUTTON, PageHeader, SECTION_CARD, SECTION_TITLE } from "../../components/ui";
import { formatBytes } from "../../lib/formatBytes";
import { modelTasks } from "../../lib/modelMeta";
import { resultDownloadStatus } from "./downloadStatus";

const TASK_OPTIONS = [
  { value: "text-generation", label: "Text Generation" },
  { value: "image-text-to-text", label: "Image-Text-to-Text" },
  { value: "text-to-image", label: "Text-to-Image" },
  { value: "text-to-speech", label: "Text-to-Speech" },
  { value: "automatic-speech-recognition", label: "Automatic Speech Recognition" },
  { value: "text-classification", label: "Text Classification" },
  { value: "question-answering", label: "Question Answering" },
  { value: "translation", label: "Translation" },
  { value: "summarization", label: "Summarization" },
];

const LIBRARY_OPTIONS = [
  { value: "gguf", label: "GGUF" },
  { value: "pytorch", label: "PyTorch" },
  { value: "transformers", label: "Transformers" },
  { value: "safetensors", label: "Safetensors" },
  { value: "awq", label: "AWQ" },
  { value: "gptq", label: "GPTQ" },
  { value: "onnx", label: "ONNX" },
  { value: "mlx", label: "MLX" },
  { value: "sentence-transformers", label: "sentence-transformers" },
  { value: "peft", label: "PEFT" },
];

const LICENSE_OPTIONS = ["apache-2.0", "mit", "llama3.3", "gemma"];

interface ParameterBucket {
  label: string;
  min: number;
  max: number;
}

const PARAMETER_BUCKETS: ParameterBucket[] = [
  { label: "< 1B", min: 0, max: 1 },
  { label: "1B – 3B", min: 1, max: 3 },
  { label: "3B – 7B", min: 3, max: 7 },
  { label: "7B – 13B", min: 7, max: 13 },
  { label: "13B – 30B", min: 13, max: 30 },
  { label: "30B – 70B", min: 30, max: 70 },
  { label: "70B+", min: 70, max: Infinity },
];

const SORT_OPTIONS = [
  { value: "downloads", label: "Most downloads" },
  { value: "trendingScore", label: "Trending" },
  { value: "likes", label: "Most likes" },
  { value: "lastModified", label: "Recently updated" },
];

/** Best-effort: HF repo names conventionally embed parameter count
 * ("Qwen3-32B-GGUF" → 32) — there's no structured field for it on the
 * search endpoint. A repo whose name doesn't match any pattern is excluded
 * from parameter-bucket filtering rather than guessed into a bucket. */
function estimateParamsBillions(repoId: string): number | null {
  const match = repoId.match(/(\d+(?:\.\d+)?)\s*[Bb](?![a-zA-Z])/);
  return match ? Number(match[1]) : null;
}

function licenseTagOf(tags: string[]): string | null {
  const tag = tags.find((t) => t.startsWith("license:"));
  return tag ? tag.slice("license:".length) : null;
}


export function ModelSearchPage() {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<Awaited<ReturnType<typeof orchestratorApi.listProviders>> | null>(null);
  const [providerId, setProviderId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ModelSearchResult[] | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [modelDetail, setModelDetail] = useState<ModelDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Сверка с репозиторием — только когда на диске что-то есть: у
  // нескачанной модели сверять нечего. `undefined` — ещё идёт.
  const [sync, setSync] = useState<RepoSyncReport | null | undefined>(undefined);
  const [actionBusy, setActionBusy] = useState(false);
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [models, setModels] = useState<ModelEntity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const [sort, setSort] = useState("downloads");
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [selectedLibraries, setSelectedLibraries] = useState<Set<string>>(new Set());
  const [selectedLicenses, setSelectedLicenses] = useState<Set<string>>(new Set());
  const [selectedBuckets, setSelectedBuckets] = useState<Set<string>>(new Set());

  const visibleResults = useMemo(() => {
    if (!results) return null;
    if (selectedBuckets.size === 0) return results;
    return results.filter((entry) => {
      const params = estimateParamsBillions(entry.id);
      if (params === null) return false;
      return PARAMETER_BUCKETS.some(
        (bucket) => selectedBuckets.has(bucket.label) && params >= bucket.min && params < bucket.max
      );
    });
  }, [results, selectedBuckets]);

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, value: string) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setSet(next);
  }

  useEffect(() => {
    (async () => {
      try {
        const list = await orchestratorApi.listProviders();
        setProviders(list);
        const downloadable = list.find((p) => p.name !== "локальный каталог");
        if (downloadable) setProviderId(String(downloadable.id));
      } catch {
        setError("Не удалось загрузить провайдеров");
      }
    })();
  }, []);


  /** Состояния задач и моделей для бейджей результатов. Запрашиваются
   * дозапросом в два момента — сразу после поиска (до отрисовки
   * результатов) и после запуска закачки; постоянного опроса здесь нет:
   * выдача поиска меняется только от действий пользователя. */
  async function loadDownloadStatuses() {
    const [tasks, registered] = await Promise.all([
      orchestratorApi.listDownloads().catch(() => [] as DownloadRecord[]),
      orchestratorApi.listModels().catch(() => [] as ModelEntity[]),
    ]);
    setDownloads(tasks);
    setModels(registered);
  }

  async function handleSearch() {
    if (!providerId) return;
    setSearching(true);
    setError(null);
    setSelectedRepo(null);
    setModelDetail(null);
    try {
      const tags = [
        ...selectedTasks,
        ...selectedLibraries,
        ...[...selectedLicenses].map((license) => `license:${license}`),
      ];
      const found = await orchestratorApi.searchProviderModels(Number(providerId), query, { tags, sort });
      // Статусы проставляются до показа результатов, иначе список мигает
      // без бейджей и предлагает скачать то, что уже качается.
      await loadDownloadStatuses();
      setResults(found);
    } catch {
      setError("Поиск недоступен — проверьте настройки провайдера");
    } finally {
      setSearching(false);
    }
  }

  // Search fires automatically on first load (once a provider is picked)
  // and whenever a facet changes — no "Применить фильтры" step. The text
  // query itself still needs Enter/the button (typing shouldn't fire a
  // request per keystroke); toggling a checkbox is a discrete action, so
  // firing immediately is the right default here.
  useEffect(() => {
    if (providerId) handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, sort, selectedTasks, selectedLibraries, selectedLicenses]);

  async function loadDetail(repoId: string) {
    const detail = await orchestratorApi.getModelDetail(Number(providerId), repoId);
    setModelDetail(detail);
    if (detail.local_bytes > 0) {
      setSync(undefined);
      orchestratorApi
        .getRepoSync(Number(providerId), repoId)
        .then(setSync)
        .catch(() => setSync(null));
    }
  }

  async function openModelDetail(repoId: string) {
    setSelectedRepo(repoId);
    setModelDetail(null);
    setSync(undefined);
    setDetailLoading(true);
    try {
      await loadDetail(repoId);
    } catch {
      setError("Не удалось получить данные о модели");
    } finally {
      setDetailLoading(false);
    }
  }

  /** «Скачать» у суммарного объёма (все нескачанные файлы) и у файла
   * (один файл) — одна закачка с переданным набором файлов. */
  async function downloadFiles(repoId: string, files: ModelFileDetail[]) {
    setActionBusy(true);
    try {
      await orchestratorApi.createDownload({
        provider_id: Number(providerId),
        model_ref: repoId,
        variant_label: "",
        files: files.map(({ filename, size }) => ({ filename, size })),
      });
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось начать загрузку"));
    } finally {
      // Отказ обычно значит, что закачка уже в очереди, — перечитанные
      // задачи покажут это в карточке.
      await loadDownloadStatuses();
      setActionBusy(false);
    }
  }

  async function updateFile(repoId: string, filename: string) {
    setActionBusy(true);
    try {
      await orchestratorApi.refreshModelVariant(Number(providerId), repoId, filename);
      await loadDetail(repoId);
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось обновить файл"));
    } finally {
      await loadDownloadStatuses();
      setActionBusy(false);
    }
  }

  return (
    <div>
      <PageHeader icon="travel_explore" title="Поиск моделей" />

      <DownloadStatsPanel />
      <ModelsQuickSwitch />

      <div className="flex gap-3 mb-6">
        <select className={`${FIELD_INPUT} text-xs`} value={providerId} onChange={(e) => setProviderId(e.currentTarget.value)}>
          {(providers ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          className="flex-grow bg-surface-container-low border border-neutral-800 px-3 py-2 text-sm font-mono"
          placeholder="Название модели или репозитория"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <button onClick={handleSearch} disabled={searching || !providerId} className={PRIMARY_BUTTON}>
          {searching ? "Поиск…" : "Найти"}
        </button>
      </div>

      {error && <p className="text-xs text-danger font-mono mb-4">{error}</p>}

      {results && (
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6 mb-6">
          <aside className="flex flex-col gap-6" data-testid="model-browse-filters">
            <div>
              <div className="text-[11px] font-['Space_Grotesk'] uppercase text-neutral-500 mb-2">Сортировка</div>
              <select
                className={`w-full ${FIELD_INPUT} text-xs`}
                value={sort}
                onChange={(e) => setSort(e.currentTarget.value)}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <FilterChecklist
              title="Tasks"
              options={TASK_OPTIONS}
              selected={selectedTasks}
              onToggle={(value) => toggle(selectedTasks, setSelectedTasks, value)}
            />
            <FilterChecklist
              title="Libraries"
              options={LIBRARY_OPTIONS}
              selected={selectedLibraries}
              onToggle={(value) => toggle(selectedLibraries, setSelectedLibraries, value)}
            />

            <div>
              <div className="text-[11px] font-['Space_Grotesk'] uppercase text-neutral-500 mb-2">Parameters</div>
              {PARAMETER_BUCKETS.map((bucket) => (
                <label key={bucket.label} className="flex items-center gap-2 text-xs text-neutral-300 mb-1">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={selectedBuckets.has(bucket.label)}
                    onChange={() => toggle(selectedBuckets, setSelectedBuckets, bucket.label)}
                  />
                  {bucket.label}
                </label>
              ))}
            </div>

            <div>
              <div className="text-[11px] font-['Space_Grotesk'] uppercase text-neutral-500 mb-2">License</div>
              {LICENSE_OPTIONS.map((license) => (
                <label key={license} className="flex items-center gap-2 text-xs text-neutral-300 mb-1">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={selectedLicenses.has(license)}
                    onChange={() => toggle(selectedLicenses, setSelectedLicenses, license)}
                  />
                  {license}
                </label>
              ))}
            </div>
          </aside>

          <div className={selectedRepo ? "grid grid-cols-1 xl:grid-cols-2 gap-6 items-start" : ""}>
            <section className={SECTION_CARD}>
              <h2 className={SECTION_TITLE}>Результаты поиска</h2>
              <div className="text-[11px] text-neutral-500 font-mono mb-3">{visibleResults?.length ?? 0} моделей</div>
              <div className="flex flex-col gap-2">
                {(visibleResults ?? []).map((entry) => {
                  const license = licenseTagOf(entry.tags);
                  const dlStatus = resultDownloadStatus(downloads, models, entry.id);
                  // Варианты известны только у раскрытого результата:
                  // выдача поиска их не содержит, и пустая строка здесь
                  // утверждала бы «вариантов нет».
                  const opened = selectedRepo === entry.id && modelDetail !== null;
                  return (
                    <ModelTile
                      key={entry.id}
                      repoId={entry.id}
                      onClick={() => openModelDetail(entry.id)}
                      selected={selectedRepo === entry.id}
                      testId={`model-tile-${entry.id}`}
                      quants={opened ? modelDetail!.variants.map((variant) => variant.quant_label) : []}
                      features={opened ? modelDetail!.features : []}
                      meta={
                        <span className="flex gap-2 flex-wrap items-center">
                          {entry.pipeline_tag && (
                            <span className="tag-pill text-[10px] px-2 py-0.5 rounded-full border border-neutral-800 text-neutral-400 font-mono">
                              {entry.pipeline_tag}
                            </span>
                          )}
                          {entry.library_name && (
                            <span className="tag-pill text-[10px] px-2 py-0.5 rounded-full border border-neutral-800 text-neutral-400 font-mono">
                              {entry.library_name}
                            </span>
                          )}
                          {license && (
                            <span className="tag-pill text-[10px] px-2 py-0.5 rounded-full border border-neutral-800 text-neutral-400 font-mono">
                              {license}
                            </span>
                          )}
                          {dlStatus && (
                            <span
                              data-testid="result-download-status"
                              className={`tag-pill text-[10px] px-2 py-0.5 rounded-full border font-mono inline-flex items-center gap-1 ${
                                dlStatus === "downloading"
                                  ? "border-primary text-primary"
                                  : "border-neutral-700 text-neutral-300"
                              }`}
                            >
                              <span className="material-symbols-outlined text-[13px]">
                                {dlStatus === "downloading" ? "cloud_download" : "hard_drive"}
                              </span>
                              {dlStatus === "downloading" ? "скачивается" : "скачан"}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1">
                            <span className="material-symbols-outlined text-sm">download</span>
                            {entry.downloads.toLocaleString("ru-RU")}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="material-symbols-outlined text-sm">favorite</span>
                            {entry.likes.toLocaleString("ru-RU")}
                          </span>
                        </span>
                      }
                    />
                  );
                })}
                {visibleResults && visibleResults.length === 0 && (
                  <p className="text-xs text-neutral-500 font-mono">Ничего не найдено.</p>
                )}
              </div>
            </section>

            {selectedRepo && (
              // Панель деталей: имя выбранной модели (без кнопок) и под ним два
              // самостоятельных раздела — «Метаданные» и «Карточка модели».
              <div data-testid="model-detail-panel" className="min-w-0">
                <div className="font-['Space_Grotesk'] text-sm font-bold text-primary break-all mb-4">{selectedRepo}</div>
                <ModelMetaInfo
                  detail={modelDetail}
                  loading={detailLoading}
                  tasks={modelTasks(downloads, Number(providerId), selectedRepo)}
                  sync={sync}
                  onRetry={() => openModelDetail(selectedRepo)}
                />
                <ModelCard
                  detail={modelDetail}
                  loading={detailLoading}
                  tasks={modelTasks(downloads, Number(providerId), selectedRepo)}
                  sync={sync}
                  busy={actionBusy}
                  onDownloadFiles={(files) => downloadFiles(selectedRepo, files)}
                  onUpdateFile={(filename) => updateFile(selectedRepo, filename)}
                  onRetry={() => openModelDetail(selectedRepo)}
                />
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

function FilterChecklist({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  const [filterText, setFilterText] = useState("");
  const filtered = options.filter((o) => o.label.toLowerCase().includes(filterText.toLowerCase()));

  return (
    <div>
      <div className="text-[11px] font-['Space_Grotesk'] uppercase text-neutral-500 mb-2">{title}</div>
      <input
        className="w-full bg-surface-container-low border border-neutral-800 px-2 py-1.5 text-[11px] font-mono mb-2"
        placeholder={`Filter ${title.toLowerCase()}`}
        value={filterText}
        onChange={(e) => setFilterText(e.currentTarget.value)}
      />
      {filtered.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-xs text-neutral-300 mb-1">
          <input
            type="checkbox"
            className="accent-primary"
            checked={selected.has(option.value)}
            onChange={() => onToggle(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
