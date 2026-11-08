import { useEffect, useRef, useState } from "react";
import { orchestratorApi } from "../../api/orchestrator";
import type {
  DownloadRecord,
  DownloadStats,
  ModelDetailResponse,
  ModelEntity,
  ModelFileDetail,
  RepoSyncReport,
} from "../../api/types";
import { DownloadStatsPanel, formatDuration } from "../../components/DownloadStatsPanel";
import { ModelCard } from "../../components/ModelCard";
import { ModelMetaInfo } from "../../components/ModelMetaInfo";
import { ModelTile } from "../../components/ModelTile";
import { ModelsQuickSwitch } from "../../components/ModelsQuickSwitch";
import { PageHeader } from "../../components/ui";
import { formatBytes } from "../../lib/formatBytes";
import { modelTasks } from "../../lib/modelMeta";

const LIST_POLL_INTERVAL_MS = 2000;
/** Сглаживание запасного расчёта скорости — как у сводки и воркера. */
const FALLBACK_SPEED_TAU_SECONDS = 5;

/** Страница «Загрузка моделей» (`/models/downloads`) — только очередь задач
 * и управление ими. Поиск живёт на своей странице.
 *
 * Сводку страница запрашивает ради `active_etas`: ETA на плитке задачи и
 * «ETA загружаемых» в панели должны приходить из одного ответа, иначе сумма
 * плиток не совпадёт с панелью (active-download-eta-per-tile). Панель при
 * этом опрашивает сводку сама — это осознанная цена её самодостаточности. */
export function ModelDownloadsPage() {
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [stats, setStats] = useState<DownloadStats | null>(null);
  // Зарегистрированные модели: по ним карточка решает, показывать
  // «Обновить» или «Скачать». Признак «скачана» — именно запись модели,
  // а не статус задачи: завершённая задача бывает и обновлением, а у
  // добавленной вручную модели задачи нет вовсе.
  const [models, setModels] = useState<ModelEntity[]>([]);

  function refreshDownloads() {
    orchestratorApi
      .listDownloads()
      .then(setDownloads)
      .catch(() => setDownloads([]));
  }

  useEffect(() => {
    orchestratorApi
      .listModels()
      .then(setModels)
      .catch(() => setModels([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      orchestratorApi
        .getDownloadStats()
        .then((next) => !cancelled && setStats(next))
        .catch(() => !cancelled && setStats(null));
      orchestratorApi
        .listDownloads()
        .then((next) => !cancelled && setDownloads(next))
        .catch(() => undefined);
    };
    tick();
    const timer = setInterval(tick, LIST_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div>
      <PageHeader icon="download" title="Загрузка моделей" />

      <DownloadStatsPanel />
      <ModelsQuickSwitch />

      <section className="bg-surface-container-lowest p-6">
        <h2 className="font-['Space_Grotesk'] text-xs font-bold uppercase tracking-widest text-primary mb-4">
          Загрузки
        </h2>
        <DownloadList
          downloads={downloads}
          onChanged={refreshDownloads}
          activeEtas={stats?.active_etas ?? {}}
          models={models}
        />
      </section>
    </div>
  );
}

export function DownloadList({
  downloads,
  onChanged,
  activeEtas = {},
  models = [],
}: {
  downloads: DownloadRecord[];
  onChanged: () => void;
  // Per-active ETA (seconds) keyed by download id, from /downloads/stats
  // (active-download-eta-per-tile).
  activeEtas?: Record<string, number | null>;
  // Зарегистрированные модели — чтобы карточка задачи показывала то же
  // действие, что карточка на странице скачанной модели.
  models?: ModelEntity[];
}) {
  const [dragId, setDragId] = useState<string | null>(null);

  if (downloads.length === 0) return <p className="text-xs text-neutral-500 font-mono">Нет загрузок.</p>;

  // Any unfinished download is reorderable — active, queued or paused: the
  // user sets the download order by dragging any of them; only terminal rows
  // keep their place (download-reorder-any-unfinished). Reordering an active
  // download just moves its place in the order, it doesn't stop the transfer.
  // Перетаскивание — управление приоритетом исполнения, поэтому доступно
  // только активным задачам (загрузка и очередь). У записи на паузе
  // приоритета нет: она не в очереди.
  const isReorderable = (status: string) => status === "active" || status === "queued";

  // Плитка — репозиторий, а не задача: у репозитория с несколькими
  // квантами задач столько же, и список показывал их как разные модели.
  const groups: { key: string; items: DownloadRecord[] }[] = [];
  for (const download of downloads) {
    const key = `${download.provider_id}:${download.model_ref}`;
    const existing = groups.find((group) => group.key === key);
    if (existing) existing.items.push(download);
    else groups.push({ key, items: [download] });
  }

  async function handleDrop(targetKey: string) {
    if (!dragId || dragId === targetKey) return;
    const reorderableKeys = groups
      .filter((group) => group.items.some((item) => isReorderable(item.status)))
      .map((group) => group.key);
    if (!reorderableKeys.includes(dragId) || !reorderableKeys.includes(targetKey)) return;
    // Перетаскивается группа, а порядок оркестратор знает по задачам:
    // ключи раскрываются в идентификаторы задач уже после перестановки.
    const targetIndex = reorderableKeys.indexOf(targetKey);
    const without = reorderableKeys.filter((key) => key !== dragId);
    without.splice(targetIndex, 0, dragId);
    setDragId(null);
    const ids = without.flatMap((key) =>
      (groups.find((group) => group.key === key)?.items ?? [])
        .filter((item) => isReorderable(item.status))
        .map((item) => item.id)
    );
    await orchestratorApi.reorderDownloads(ids);
    onChanged();
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const draggable = group.items.some((item) => isReorderable(item.status));
        return (
          <div
            key={group.key}
            draggable={draggable}
            onDragStart={() => draggable && setDragId(group.key)}
            onDragOver={(e) => draggable && e.preventDefault()}
            onDrop={() => draggable && handleDrop(group.key)}
            className={draggable ? "cursor-move" : undefined}
            data-testid={draggable ? "download-row-draggable" : undefined}
          >
            <DownloadRow
              group={group.items}
              queue={downloads}
              draggable={draggable}
              etaSeconds={group.items.reduce<number | null>((sum, item) => {
                const eta = activeEtas[item.id];
                if (eta === null || eta === undefined) return sum;
                return (sum ?? 0) + eta;
              }, null)}
              onChanged={onChanged}
              modelDownloaded={models.some(
                (model) => model.provider_id === group.items[0].provider_id && model.ref === group.items[0].model_ref
              )}
            />
          </div>
        );
      })}
    </div>
  );
}

// Status glyph in the tile: a disk for an already-downloaded file, a

// network/cloud glyph for any unfinished one — active, queued or paused
// (download-tile-hide-and-pending-cloud). Пауза с ошибкой показывает значок
// ошибки — по значку видно, что пауза из-за сбоя, а не по решению человека.
const STATUS_ICON: Partial<Record<DownloadRecord["status"], { icon: string; label: string }>> = {
  completed: { icon: "hard_drive", label: "скачано на диск" },
  active: { icon: "cloud_download", label: "загружается по сети" },
  queued: { icon: "cloud_download", label: "в очереди на загрузку" },
  paused: { icon: "cloud_download", label: "загрузка на паузе" },
};

function DownloadRow({
  group,
  queue,
  draggable = false,
  etaSeconds = null,
  onChanged,
  modelDownloaded = false,
}: {
  /** Задачи одного репозитория: плитка у них одна, и действия плитки
   * применяются ко всей группе — иначе «Пауза» на плитке останавливала бы
   * один квант из четырёх. */
  group: DownloadRecord[];
  // The whole queue, so the model card opened from this row can tell which
  // of its variants already have an unfinished download and must not be
  // offered again (download-duplicate-guard).
  queue: DownloadRecord[];
  // Reorderable (queued) rows show a drag handle; others don't.
  draggable?: boolean;
  // ETA (seconds) for an active download, from /downloads/stats; null if n/a.
  etaSeconds?: number | null;
  onChanged: () => void;
  /** У этой модели есть зарегистрированная запись, то есть она скачана. */
  modelDownloaded?: boolean;
}) {
  // Представитель группы: по нему адресуются репозиторий и провайдер —
  // они у группы общие.
  const download = group[0];
  // Ход закачки — по группе: байты опрашиваются по каждой активной
  // задаче, остальные берут последнее известное значение из записи.
  const [polledBytes, setPolledBytes] = useState<Record<string, number>>({});
  const [speed, setSpeed] = useState<number | null>(null);
  // Скорость измеряет воркер (download-speed-steady-display). Запасной путь
  // для воркеров без неё — сглаженная разность байт между опросами; её
  // предыдущий замер — ref, а не state: обновление не вызывает перерисовку.
  const prevSample = useRef<{ bytes: number; time: number; smoothed: number | null } | null>(null);

  // Clicking the row opens the model card (same card as search) in a modal;
  // the compact row itself is unchanged. Details load on open via getModelDetail.
  const [cardOpen, setCardOpen] = useState(false);
  const [cardDetail, setCardDetail] = useState<ModelDetailResponse | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  // Сверка с репозиторием: без неё неизвестно, есть ли расхождение, и
  // «Обновить» остаётся выключенным — кнопка, перекачивающая файл «на
  // всякий случай», это ровно то, от чего уходит требование.
  // `undefined` — сверка ещё идёт, `null` — не удалась. Сверяется только
  // модель, у которой что-то лежит на диске.
  const [sync, setSync] = useState<RepoSyncReport | null | undefined>(undefined);
  const [cardBusy, setCardBusy] = useState(false);

  async function loadCard() {
    setCardLoading(true);
    try {
      const detail = await orchestratorApi.getModelDetail(download.provider_id, download.model_ref);
      setCardDetail(detail);
      if (detail.local_bytes > 0) {
        orchestratorApi
          .getRepoSync(download.provider_id, download.model_ref)
          .then(setSync)
          .catch(() => setSync(null));
      }
    } catch {
      setCardDetail(null);
    } finally {
      setCardLoading(false);
    }
  }

  function openCard() {
    setCardOpen(true);
    setCardDetail(null);
    setSync(undefined);
    loadCard();
  }

  async function downloadFiles(files: ModelFileDetail[]) {
    setCardBusy(true);
    try {
      await orchestratorApi.createDownload({
        provider_id: download.provider_id,
        model_ref: download.model_ref,
        variant_label: "",
        files: files.map(({ filename, size }) => ({ filename, size })),
      });
    } catch {
      /* surfaced by the list refresh; keep the card open */
    } finally {
      onChanged();
      await loadCard();
      setCardBusy(false);
    }
  }

  async function updateFile(filename: string) {
    setCardBusy(true);
    try {
      await orchestratorApi.refreshModelVariant(download.provider_id, download.model_ref, filename);
    } catch {
      /* keep the card open */
    } finally {
      onChanged();
      await loadCard();
      setCardBusy(false);
    }
  }

  const activeIds = group.filter((item) => item.status === "active").map((item) => item.id);
  const activeIdsKey = activeIds.join(",");

  useEffect(() => {
    prevSample.current = null;
    // Скорость сбрасывается, только когда активных задач не осталось. Смена
    // набора активных задач её не стирает: до нового значения строка держит
    // последнее известное, а не пропадает.
    if (activeIdsKey === "") {
      setSpeed(null);
      return;
    }
    const timer = setInterval(async () => {
      try {
        const sampled = await Promise.all(
          activeIdsKey.split(",").map(async (id) => [id, await orchestratorApi.getDownloadProgress(id)] as const)
        );
        const now = Date.now();
        const next: Record<string, number> = {};
        for (const [id, progress] of sampled) {
          if (progress.downloaded_bytes !== null) next[id] = progress.downloaded_bytes;
        }
        const got = Object.values(next).reduce((sum, value) => sum + value, 0);
        const workerSpeeds = sampled.map(([, progress]) => progress.speed_bytes_per_sec ?? null);
        let smoothed = prevSample.current?.smoothed ?? null;
        if (workerSpeeds.every((value) => value !== null)) {
          setSpeed(workerSpeeds.reduce<number>((sum, value) => sum + (value ?? 0), 0));
        } else if (prevSample.current) {
          const dt = (now - prevSample.current.time) / 1000;
          if (dt > 0) {
            const instantaneous = Math.max(0, (got - prevSample.current.bytes) / dt);
            const alpha = 1 - Math.exp(-dt / FALLBACK_SPEED_TAU_SECONDS);
            smoothed = smoothed === null ? instantaneous : alpha * instantaneous + (1 - alpha) * smoothed;
            setSpeed(smoothed);
          }
        }
        prevSample.current = { bytes: got, time: now, smoothed };
        setPolledBytes((previous) => ({ ...previous, ...next }));
      } catch {
        /* transient — next tick retries */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [activeIdsKey]);

  const bytes = group.reduce<number | null>((sum, item) => {
    const value = polledBytes[item.id] ?? item.downloaded_bytes;
    if (value === null) return sum;
    return (sum ?? 0) + value;
  }, null);
  const totalBytes = group.reduce((sum, item) => sum + (item.total_bytes ?? 0), 0);

  // Percent is computed from the raw byte counts (two decimals) rather than
  // the backend's progress.percent, which is rounded to one decimal — too
  // coarse to show movement on a large model between polls.
  const percent = bytes !== null && totalBytes ? (100 * bytes) / totalBytes : null;

  // Состояние группы: пока хоть одна задача идёт, группа идёт. Группа
  // завершена, только когда завершены все её задачи.
  const groupStatus = (["active", "queued", "paused"] as const).find((status) =>
    group.some((item) => item.status === status)
  )
    ? ((["active", "queued", "paused"] as const).find((status) => group.some((item) => item.status === status)) as string)
    : group.every((item) => item.status === "completed")
      ? "completed"
      : download.status;
  const terminal = groupStatus === "completed" || groupStatus === "cancelled";
  // Ошибка — это пауза с сообщением: такую запись можно удалить напрямую,
  // не отменяя сначала.
  const errorPaused = group.some((item) => item.status === "paused" && !!item.error_message);
  const errorMessage = group.find((item) => item.error_message)?.error_message ?? null;
  // Имя файла в подписи оставляем, только когда задача — про один файл:
  // у группы из нескольких задач оно ничего не уточняет.
  const singleFile = group.length === 1 && download.file_names?.length === 1 ? download.file_names[0] : null;
  const displayName =
    download.kind === "update"
      ? `${download.model_ref}-update${singleFile ? `-${singleFile}` : ""}`
      : singleFile
        ? `${download.model_ref}-${singleFile}`
        : download.model_ref;

  const statusIcon = errorPaused
    ? { icon: "error", label: "загрузка остановлена ошибкой" }
    : STATUS_ICON[groupStatus as DownloadRecord["status"]];
  const toggleCard = () => (cardOpen ? setCardOpen(false) : openCard());

  return (
    <div className="bg-surface-container p-4">
      <div className="flex items-stretch gap-2">
        {draggable && (
          <span
            data-testid="download-drag-handle"
            aria-label="Перетащить для изменения порядка"
            title="Перетащить для изменения порядка"
            className="material-symbols-outlined text-neutral-600 self-center cursor-move select-none"
          >
            drag_indicator
          </span>
        )}
        <button
          type="button"
          data-testid="download-description-toggle"
          aria-expanded={cardOpen}
          aria-label={cardOpen ? "Свернуть описание" : "Развернуть описание"}
          onClick={toggleCard}
          className="material-symbols-outlined text-neutral-400 self-center hover:text-primary"
        >
          {cardOpen ? "expand_more" : "chevron_right"}
        </button>
        <div
          className="flex-grow cursor-pointer min-w-0"
          role="button"
          tabIndex={0}
          data-testid="download-row-toggle"
          onClick={toggleCard}
        >
          {/* Плитка модели — общая со списками скачанных и поиска;
              раздел добавляет к ней только ход закачки. Варианты
              известны из деталей раскрытой карточки: сама задача знает
              лишь имена файлов, а группировать их в кванты второй раз,
              уже в интерфейсе, значило бы разойтись с оркестратором. */}
          <ModelTile
            repoId={displayName}
            quants={cardOpen ? (cardDetail?.variants ?? []).map((variant) => variant.quant_label) : []}
            features={cardOpen ? (cardDetail?.features ?? []) : []}
            icons={
              statusIcon && (
                <span
                  data-testid="download-status-icon"
                  aria-label={statusIcon.label}
                  title={statusIcon.label}
                  className="material-symbols-outlined text-sm text-neutral-400"
                >
                  {statusIcon.icon}
                </span>
              )
            }
            meta={
              <span className="flex flex-wrap gap-x-3 gap-y-1 items-baseline">
                <span>{groupStatus}</span>
                {group.length > 1 && <span>задач: {group.length}</span>}
                <span className="text-primary">
                  {percent !== null ? `${percent.toFixed(2)}% · ` : ""}
                  {formatBytes(bytes)} {totalBytes ? `/ ${formatBytes(totalBytes)}` : ""}
                  {groupStatus === "active" && speed !== null ? ` · ${formatBytes(speed)}/s` : ""}
                  {groupStatus === "active" && etaSeconds !== null ? (
                    <span data-testid="download-eta"> · ETA {formatDuration(etaSeconds)}</span>
                  ) : null}
                </span>
              </span>
            }
            testId="download-model-tile"
          >
            <div className="h-1.5 bg-neutral-800 mt-3">
              <div className="h-full bg-primary" style={{ width: `${percent ?? 0}%` }} />
            </div>
          </ModelTile>
        </div>
      </div>
      {(groupStatus === "active" || groupStatus === "queued") && (
        <button
          onClick={async () => {
            // Пауза плитки — пауза всей группы: иначе она остановила бы
            // один квант из четырёх, а плитка показана одна.
            for (const item of group.filter((i) => i.status === "active" || i.status === "queued")) {
              await orchestratorApi.pauseDownload(item.id);
            }
            onChanged();
          }}
          className="text-[10px] text-neutral-300 uppercase font-['Space_Grotesk'] mr-3"
        >
          Пауза
        </button>
      )}
      {groupStatus === "paused" && (
        <button
          onClick={async () => {
            for (const item of group.filter((i) => i.status === "paused")) {
              await orchestratorApi.resumeDownload(item.id);
            }
            onChanged();
          }}
          className="text-[10px] text-primary uppercase font-['Space_Grotesk'] mr-3"
        >
          Возобновить
        </button>
      )}
      {!terminal && groupStatus !== "paused" && (
        <button
          onClick={async () => {
            for (const item of group.filter((i) => i.status !== "completed" && i.status !== "cancelled")) {
              await orchestratorApi.cancelDownload(item.id);
            }
            onChanged();
          }}
          className="text-[10px] text-danger uppercase font-['Space_Grotesk']"
        >
          Отменить
        </button>
      )}
      {(terminal || errorPaused) && (
        // Завершённая оставляет файлы на диске — кнопка только убирает
        // плитку («Скрыть»). Недокачанная (отменённая или остановленная
        // ошибкой) удаляет запись и частично скачанное («Удалить запись»);
        // файлы уже скачанной модели бэкенд не трогает.
        <button
          onClick={async () => {
            for (const item of group) {
              await orchestratorApi.deleteDownload(item.id);
            }
            onChanged();
          }}
          title={
            groupStatus === "completed"
              ? "Убрать из списка; файлы модели останутся на диске"
              : "Удалить запись и частично скачанные файлы"
          }
          className="text-[10px] text-neutral-500 uppercase font-['Space_Grotesk'] hover:text-danger"
        >
          {groupStatus === "completed" ? "Скрыть" : "Удалить запись"}
        </button>
      )}
      {errorPaused && <div className="text-[10px] text-danger font-mono mt-1">{errorMessage}</div>}
      {cardOpen && (
        <div className="mt-3">
          <ModelMetaInfo
            detail={cardDetail}
            loading={cardLoading}
            tasks={modelTasks(queue, download.provider_id, download.model_ref)}
            sync={sync}
            onRetry={openCard}
          />
          <ModelCard
            detail={cardDetail}
            loading={cardLoading}
            tasks={modelTasks(queue, download.provider_id, download.model_ref)}
            sync={sync}
            showSyncColumn={modelDownloaded}
            busy={cardBusy}
            onDownloadFiles={downloadFiles}
            onUpdateFile={updateFile}
            onRetry={openCard}
          />
        </div>
      )}
    </div>
  );
}
