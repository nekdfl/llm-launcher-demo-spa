import type { ReactNode } from "react";
import type { DownloadRecord, ModelDetailResponse, RepoSyncReport } from "../api/types";
import { downloadStatus, supportInfo, updatesLabel, variantMarks } from "../lib/modelMeta";
import { DetailLoadState } from "./DetailLoadState";
import { SECTION_CARD, SECTION_TITLE } from "./ui";

const STATUS_CLASS: Record<string, string> = {
  downloading: "text-primary",
  paused: "text-warn",
  queued: "text-neutral-300",
  downloaded: "text-primary",
  partial: "text-warn",
  not_downloaded: "text-neutral-400",
  not_installed: "text-neutral-400",
};

const UPDATES_CLASS = { warn: "text-warn", neutral: "text-neutral-300", muted: "text-neutral-600" };

const GROUP_TITLE = "text-[10px] font-['Space_Grotesk'] uppercase tracking-widest text-neutral-600 mb-1";

export type MetaRow = [label: string, value: ReactNode];

function Rows({ rows }: { rows: MetaRow[] }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-y-1">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <div className="text-neutral-500 uppercase">{label}</div>
          <div className="break-words min-w-0">{value}</div>
        </div>
      ))}
    </div>
  );
}

/** Раздел «Метаданные» — самостоятельный раздел над карточкой модели, один
 * и тот же во всех её контекстах: статус загрузки, обновления, поддержка
 * установленными движками, все кванты репозитория. Страница скачанной
 * модели добавляет сведения записи (`recordRows`) и файлы на диске
 * (`diskRows`) — отдельного раздела метаданных у неё нет. */
export function ModelMetaInfo({
  detail,
  loading = false,
  tasks,
  sync,
  recordRows,
  diskRows,
  onRetry,
}: {
  detail: ModelDetailResponse | null;
  loading?: boolean;
  /** Задачи закачки именно этой модели (`modelTasks`). */
  tasks: DownloadRecord[];
  /** `undefined` — сверка ещё идёт, `null` — не удалась. */
  sync: RepoSyncReport | null | undefined;
  recordRows?: MetaRow[];
  diskRows?: MetaRow[];
  /** Перезапрос деталей после ошибки. */
  onRetry?: () => void;
}) {
  let state: MetaRow[] = [];
  if (detail) {
    const status = downloadStatus(detail, tasks);
    const updates = updatesLabel(detail, sync);
    const support = supportInfo(detail);
    const marks = variantMarks(detail, tasks);
    state = [
      ["Статус", <span className={STATUS_CLASS[status.kind]} data-testid="meta-status">{status.label}</span>],
      ["Обновления", <span className={UPDATES_CLASS[updates.tone]} data-testid="meta-updates">{updates.label}</span>],
      [
        "Поддержка",
        support.supported ? (
          <span data-testid="meta-support">
            <span className="text-primary">поддерживается</span>{" "}
            <span className="text-neutral-500">· {support.engines.join(", ")}</span>
          </span>
        ) : (
          <span className="text-warn" data-testid="meta-support">
            не удалось проверить совместимость
          </span>
        ),
      ],
    ];
    if (marks.length > 0) {
      state.push([
        "квантизации",
        <span className="flex flex-wrap gap-x-2" data-testid="meta-quants">
          {marks.map(({ label, mark }) => (
            <span
              key={label}
              data-mark={mark}
              title={mark === "downloaded" ? "скачан" : mark === "downloading" ? "качается" : "не скачан"}
              className={mark === "downloaded" ? "text-primary" : mark === "downloading" ? "text-warn" : "text-neutral-400"}
            >
              {label}
              {mark === "downloaded" ? " ✓" : mark === "downloading" ? " ↓" : ""}
            </span>
          ))}
          {detail.features.map((feature) => (
            <span key={feature} className="text-neutral-400">
              +{feature}
            </span>
          ))}
        </span>,
      ]);
    }
  }
  const grouped = Boolean(recordRows?.length || diskRows?.length);

  return (
    <section className={SECTION_CARD} data-testid="model-meta-info">
      <h2 className={SECTION_TITLE}>Метаданные</h2>
      {(loading || !detail) && <DetailLoadState loading={loading} onRetry={onRetry} />}
      {!loading && detail &&
        (grouped ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3 text-[11px] font-mono bg-surface-container-low px-3 py-3">
            <div>
              <div className={GROUP_TITLE}>Состояние</div>
              <Rows rows={state} />
            </div>
            {recordRows && recordRows.length > 0 && (
              <div>
                <div className={GROUP_TITLE}>Модель</div>
                <Rows rows={recordRows} />
              </div>
            )}
            {diskRows && diskRows.length > 0 && (
              <div>
                <div className={GROUP_TITLE}>Файлы</div>
                <Rows rows={diskRows} />
              </div>
            )}
          </div>
        ) : (
          <div className="text-[11px] font-mono bg-surface-container-low px-3 py-2">
            <Rows rows={state} />
          </div>
        ))}
    </section>
  );
}
