import type {
  DownloadRecord,
  FileSyncState,
  ModelDetailResponse,
  ModelFileDetail,
  RepoSyncReport,
} from "../api/types";

/** Состояния разделов «Метаданные» и «Карточка модели» — одно правило на
 * все контексты (поиск, плитка закачки, страница скачанной модели).
 * Наличие файлов решает диск (`model-detail`), журнал закачек отвечает
 * только на «идёт ли / стоит ли в очереди» и «пытались ли скачать». */

const TASK_LABELS: Record<string, string> = {
  active: "качается",
  paused: "на паузе",
  queued: "в очереди",
};

/** Незавершённая закачка модели. Задача на каталог одна
 * (download-duplicate-guard), поэтому порядок нужен только на случай
 * переходного состояния: активная важнее приостановленной и ждущей. */
export function unfinishedTask(tasks: DownloadRecord[]): DownloadRecord | undefined {
  for (const status of ["active", "paused", "queued"]) {
    const task = tasks.find((candidate) => candidate.status === status);
    if (task) return task;
  }
  return undefined;
}

export function taskLabel(task: DownloadRecord): string {
  return TASK_LABELS[task.status] ?? task.status;
}

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

export type DownloadStatusKind =
  | "downloading"
  | "paused"
  | "queued"
  | "downloaded"
  | "partial"
  | "not_downloaded"
  | "not_installed";

export interface DownloadStatus {
  kind: DownloadStatusKind;
  label: string;
}

/** Статус загрузки модели — первое подходящее по порядку. */
export function downloadStatus(detail: ModelDetailResponse, tasks: DownloadRecord[]): DownloadStatus {
  const task = unfinishedTask(tasks);
  if (task?.status === "active") {
    return { kind: "downloading", label: `качается ${percent(task.downloaded_bytes ?? 0, task.total_bytes ?? 0)}%` };
  }
  if (task?.status === "paused") {
    return { kind: "paused", label: `на паузе ${percent(task.downloaded_bytes ?? 0, task.total_bytes ?? 0)}%` };
  }
  if (task?.status === "queued") return { kind: "queued", label: "в очереди" };
  if (detail.files.length > 0 && detail.files.every((file) => file.downloaded)) {
    return { kind: "downloaded", label: "скачано" };
  }
  if (detail.local_bytes > 0) {
    return { kind: "partial", label: `скачано частично ${percent(detail.local_bytes, detail.total_bytes)}%` };
  }
  if (tasks.length > 0) return { kind: "not_downloaded", label: "не скачано" };
  return { kind: "not_installed", label: "не установлена" };
}

/** Обновления — по сверке с репозиторием. У нескачанной модели сверять
 * нечего («—»). У частично скачанной недостающие файлы — недокачка, а не
 * обновление: обновлением считается только изменённый файл.
 * `sync === undefined` — сверка ещё идёт, `null` — не удалась. */
export function updatesLabel(
  detail: ModelDetailResponse,
  sync: RepoSyncReport | null | undefined
): { label: string; tone: "warn" | "neutral" | "muted" } {
  if (detail.local_bytes === 0) return { label: "—", tone: "muted" };
  if (sync === undefined) return { label: "проверяется…", tone: "muted" };
  if (sync === null) return { label: "не удалось проверить", tone: "muted" };
  const complete = detail.files.every((file) => file.downloaded);
  const hasUpdates = sync.changed_count > 0 || (complete && sync.missing_count > 0);
  return hasUpdates ? { label: "есть обновления", tone: "warn" } : { label: "актуально", tone: "neutral" };
}

export function supportInfo(detail: ModelDetailResponse): { supported: boolean; engines: string[] } {
  const engines = detail.supporting_engines.map((installation) => installation.name);
  return { supported: engines.length > 0, engines };
}

export type VariantMark = "downloaded" | "downloading" | "absent";

/** Пометки всех вариантов репозитория для строки «квантизации». */
export function variantMarks(
  detail: ModelDetailResponse,
  tasks: DownloadRecord[]
): { label: string; mark: VariantMark }[] {
  const task = unfinishedTask(tasks);
  const seen = new Set<string>();
  const marks: { label: string; mark: VariantMark }[] = [];
  for (const variant of detail.variants) {
    if (seen.has(variant.quant_label)) continue;
    seen.add(variant.quant_label);
    let mark: VariantMark = "absent";
    if (variant.downloaded) mark = "downloaded";
    else if (task && (task.file_names === null || task.file_names.includes(variant.filename))) mark = "downloading";
    marks.push({ label: variant.quant_label, mark });
  }
  return marks;
}

export type FileAction =
  | { kind: "download" }
  | { kind: "update" }
  | { kind: "downloaded" }
  | { kind: "task"; label: string };

/** Действие у файла в списке карточки. Пока у модели есть незавершённая
 * закачка, «Скачать» не предлагается — задача на каталог одна, вторую
 * оркестратор отклонит. */
export function fileAction(
  file: ModelFileDetail,
  task: DownloadRecord | undefined,
  syncState: FileSyncState | undefined
): FileAction {
  const complete = file.downloaded && syncState !== "changed";
  if (task) return complete ? { kind: "downloaded" } : { kind: "task", label: taskLabel(task) };
  if (file.downloaded && syncState === "changed") return { kind: "update" };
  if (file.downloaded) return { kind: "downloaded" };
  return { kind: "download" };
}

/** Действие уровня модели у суммарного объёма: одна «Скачать» на все
 * нескачанные файлы, либо состояние незавершённой закачки, либо ничего. */
export function repoAction(
  detail: ModelDetailResponse,
  task: DownloadRecord | undefined
): { kind: "download"; files: ModelFileDetail[] } | { kind: "task"; label: string } | { kind: "none" } {
  if (task) return { kind: "task", label: taskLabel(task) };
  const missing = detail.files.filter((file) => !file.downloaded);
  if (missing.length === 0) return { kind: "none" };
  return { kind: "download", files: missing };
}

/** Задачи именно этой модели: provider и репозиторий вместе. */
export function modelTasks(downloads: DownloadRecord[], providerId: number, repoId: string): DownloadRecord[] {
  return downloads.filter((download) => download.provider_id === providerId && download.model_ref === repoId);
}
