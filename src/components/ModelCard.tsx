import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import type { DownloadRecord, FileSyncState, ModelDetailResponse, ModelFileDetail, RepoSyncReport } from "../api/types";
import { formatBytes } from "../lib/formatBytes";
import { type FileAction, fileAction, repoAction, unfinishedTask } from "../lib/modelMeta";
import { DetailLoadState } from "./DetailLoadState";
import { SECTION_CARD, SECTION_TITLE } from "./ui";

/** Model README rendered as Markdown. README comes from a third-party source
 * (HuggingFace), so raw HTML inside it is sanitized (rehypeRaw parses it,
 * rehypeSanitize strips scripts/event handlers) before display. Styled for
 * the card's dark theme; no nested scroll area. */
function DescriptionMarkdown({ text }: { text: string }) {
  return (
    <div className="text-[11px] text-neutral-400 font-['Inter'] mb-3 space-y-2 break-words leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{
          h1: ({ children }) => <div className="text-sm text-neutral-200 font-['Space_Grotesk'] font-bold">{children}</div>,
          h2: ({ children }) => <div className="text-xs text-neutral-200 font-['Space_Grotesk'] font-bold uppercase tracking-wide mt-2">{children}</div>,
          h3: ({ children }) => <div className="text-[11px] text-neutral-300 font-['Space_Grotesk'] font-bold mt-2">{children}</div>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
              {children}
            </a>
          ),
          code: ({ children }) => <code className="bg-surface-container px-1 text-neutral-200">{children}</code>,
          pre: ({ children }) => <pre className="bg-surface-container p-2 overflow-x-auto text-[10px]">{children}</pre>,
          ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
          img: ({ src, alt }) => <img src={typeof src === "string" ? src : undefined} alt={alt} className="max-w-full inline-block" />,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="text-[10px]">{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

const SYNC_STATE_LABELS: Record<FileSyncState, string> = {
  same: "совпадает",
  changed: "изменён",
  missing: "добавлен в репозитории",
  extra: "лишний локально",
};

const SYNC_STATE_CLASS: Record<FileSyncState, string> = {
  same: "text-neutral-600",
  changed: "text-warn",
  missing: "text-warn",
  extra: "text-danger",
};

const DOWNLOAD_BUTTON =
  "px-3 py-1 bg-primary text-black font-['Space_Grotesk'] text-[10px] font-bold uppercase disabled:opacity-40 disabled:cursor-not-allowed";
const UPDATE_BUTTON =
  "px-3 py-1 border border-neutral-700 text-neutral-300 font-['Space_Grotesk'] text-[10px] font-bold uppercase enabled:hover:border-primary enabled:hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed";

function FileActionCell({
  file,
  action,
  busy,
  onDownload,
  onUpdate,
}: {
  file: ModelFileDetail;
  action: FileAction;
  busy: boolean;
  onDownload: () => void;
  onUpdate: () => void;
}) {
  switch (action.kind) {
    case "download":
      return (
        <button onClick={onDownload} disabled={busy} className={DOWNLOAD_BUTTON} data-testid={`download-file-${file.filename}`}>
          Скачать
        </button>
      );
    case "update":
      return (
        <button onClick={onUpdate} disabled={busy} className={UPDATE_BUTTON} data-testid={`update-file-${file.filename}`}>
          Обновить
        </button>
      );
    case "downloaded":
      return <span className="text-primary text-[10px] uppercase">скачано</span>;
    case "task":
      return <span className="text-neutral-500 text-[10px] uppercase">{action.label}</span>;
  }
}

/** Раздел «Карточка модели» — самостоятельный раздел и единый компонент:
 * один и тот же в поиске, в раскрытой плитке закачки и на странице
 * скачанной модели. Описание, источник, суммарный занимаемый объём с одной
 * кнопкой «Скачать» на все нескачанные файлы и список файлов репозитория —
 * каждый файл один раз, со своим действием. Данные (`detail`, задачи
 * модели, сверка) и обработчики даёт контекст; состояния считает
 * `lib/modelMeta`. */
export function ModelCard({
  detail,
  loading = false,
  tasks,
  sync,
  showSyncColumn = false,
  busy = false,
  onDownloadFiles,
  onUpdateFile,
  headerAction,
  favorite,
  onToggleFavorite,
  favoriteBusy = false,
  favoriteError = null,
  onRetry,
  testId = "model-card",
}: {
  detail: ModelDetailResponse | null;
  loading?: boolean;
  /** Задачи закачки именно этой модели (`modelTasks`). */
  tasks: DownloadRecord[];
  sync?: RepoSyncReport | null;
  /** Столбец расхождения и строки лишних локальных файлов — у скачанной
   * модели, где сверка и нужна. */
  showSyncColumn?: boolean;
  busy?: boolean;
  onDownloadFiles: (files: ModelFileDetail[]) => void;
  onUpdateFile: (filename: string) => void;
  /** Действия уровня репозитория скачанной модели рядом с объёмом. */
  headerAction?: ReactNode;
  /** Избранное показывается только у зарегистрированной модели: у
   * репозитория без записи помечать нечего, и переключатель не
   * рендерится вовсе. */
  favorite?: boolean;
  onToggleFavorite?: (next: boolean) => void;
  favoriteBusy?: boolean;
  favoriteError?: string | null;
  /** Перезапрос деталей после ошибки. */
  onRetry?: () => void;
  testId?: string;
}) {
  const task = unfinishedTask(tasks);
  const syncByFile = new Map((sync?.files ?? []).map((entry) => [entry.filename, entry]));
  const withSync = showSyncColumn && Boolean(sync);
  const extraFiles = withSync ? (sync?.files ?? []).filter((entry) => entry.state === "extra") : [];
  const repo = detail ? repoAction(detail, task) : null;

  return (
    <section className={SECTION_CARD} data-testid={testId}>
      <div className="flex items-center justify-between">
        <h2 className={`${SECTION_TITLE} flex items-center gap-2`}>
          Карточка модели
          {favorite !== undefined && onToggleFavorite && (
            <button
              type="button"
              data-testid="favorite-toggle"
              aria-label={favorite ? "Убрать из избранного" : "Добавить в избранное"}
              title={favorite ? "Убрать из избранного" : "Добавить в избранное"}
              aria-pressed={favorite}
              // Пока запрос не завершился, повторное нажатие заблокировано:
              // иначе уйдут два противоречащих друг другу запроса.
              disabled={favoriteBusy}
              onClick={() => onToggleFavorite(!favorite)}
              className={`material-symbols-outlined text-base leading-none disabled:opacity-40 disabled:cursor-not-allowed ${
                favorite ? "text-primary" : "text-neutral-500 enabled:hover:text-primary"
              }`}
              style={favorite ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              star
            </button>
          )}
        </h2>
      </div>

      {favoriteError && (
        <p className="text-xs text-danger font-mono mb-1" data-testid="favorite-error">
          {favoriteError}
        </p>
      )}

      {(loading || !detail) && <DetailLoadState loading={loading} onRetry={onRetry} />}

      {!loading && detail && repo && (
        <>
          {detail.description && <DescriptionMarkdown text={detail.description} />}
          {detail.source_url && (
            <div className="text-[11px] text-neutral-500 font-mono mb-3" data-testid="model-source-url">
              Источник:{" "}
              <a
                href={detail.source_url}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline break-all"
              >
                {detail.source_url}
              </a>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="text-[11px] text-neutral-500 font-mono">
              Суммарный занимаемый объём: <span className="text-on-surface">{formatBytes(detail.total_bytes)}</span>
              {!detail.total_disk_sufficient && <span className="text-danger ml-2">недостаточно места на диске</span>}
            </div>
            <span className="flex items-center gap-2">
              {repo.kind === "download" && (
                <button
                  onClick={() => onDownloadFiles(repo.files)}
                  disabled={busy}
                  className={DOWNLOAD_BUTTON}
                  data-testid="download-full-repo"
                >
                  Скачать
                </button>
              )}
              {repo.kind === "task" && (
                <span className="text-neutral-500 text-[10px] uppercase font-['Space_Grotesk']" data-testid="repo-task-state">
                  {repo.label}
                </span>
              )}
              {headerAction}
            </span>
          </div>

          {detail.files.length === 0 ? (
            <p className="text-xs text-neutral-500 font-mono">В репозитории нет файлов.</p>
          ) : (
            // Со столбцом расхождения на узком экране список прокручивается
            // внутри карточки, а не растягивает страницу.
            <div className="overflow-x-auto" data-testid="files-table-scroll">
              <table className="w-full text-xs font-mono min-w-[28rem]">
                <thead>
                  <tr className="text-neutral-500 uppercase text-[10px] border-b border-neutral-800">
                    <th className="text-left py-2 font-normal">Файл</th>
                    <th className="text-left font-normal">Размер</th>
                    <th className="text-left font-normal">Место на диске</th>
                    {withSync && <th className="text-left font-normal">Расхождение</th>}
                    <th className="text-left font-normal"></th>
                  </tr>
                </thead>
                <tbody className="text-neutral-300">
                  {detail.files.map((file) => {
                    const syncEntry = syncByFile.get(file.filename);
                    const action = fileAction(file, task, syncEntry?.state);
                    return (
                      <tr key={file.filename} className="border-b border-neutral-900" data-testid={`file-row-${file.filename}`}>
                        <td className="py-2 pr-3 break-all">{file.filename}</td>
                        <td>{formatBytes(file.size)}</td>
                        <td className={file.disk_sufficient ? "text-primary" : "text-danger"}>
                          {file.disk_sufficient ? "достаточно" : "недостаточно"}
                        </td>
                        {withSync && (
                          <td className={SYNC_STATE_CLASS[syncEntry?.state ?? "same"]} data-testid={`sync-state-${file.filename}`}>
                            {SYNC_STATE_LABELS[syncEntry?.state ?? "same"]}
                            {syncEntry?.content_verified === false && <span className="text-neutral-600"> (по размеру)</span>}
                          </td>
                        )}
                        <td>
                          <FileActionCell
                            file={file}
                            action={action}
                            busy={busy}
                            onDownload={() => onDownloadFiles([file])}
                            onUpdate={() => onUpdateFile(file.filename)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {extraFiles.map((entry) => (
                    <tr key={`extra-${entry.filename}`} className="border-b border-neutral-900" data-testid={`extra-file-${entry.filename}`}>
                      <td className="py-2 pr-3 text-neutral-400 break-all">{entry.filename}</td>
                      <td className="text-neutral-600">—</td>
                      <td className="text-neutral-600">{formatBytes(entry.local_size)} на диске</td>
                      <td className={SYNC_STATE_CLASS.extra}>{SYNC_STATE_LABELS.extra}</td>
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
