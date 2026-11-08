import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { buildLaunchVariantsLine } from "../lib/launchVariants";
import { StatusBadge, type AccentTone, type BadgeTone } from "./ui";

/** Плитка модели — одна подача модели во всех списках: скачанные, поиск,
 * загрузка. Разделы передают то, что у них различается (пометка, действие,
 * свои сведения строкой), а состав и вид плитки определяет компонент:
 * собственная разметка плитки в разделах расходилась уже тем, что одна и
 * та же пометка «скачан» выглядела в них по-разному.
 *
 * Единица плитки — **репозиторий модели**, а не запись и не файл: записи
 * создаются на каждый квант, и плитка на запись давала четыре плитки с
 * одинаковым названием.
 *
 * `quants`/`features` пусты, когда состав вариантов неизвестен (результат
 * поиска без полученных деталей) — тогда строка вариантов не рисуется:
 * пустая строка утверждала бы «вариантов нет». */
export function ModelTile({
  repoId,
  to,
  onClick,
  accent = "primary",
  quants = [],
  features = [],
  favorite = false,
  unusableReason = null,
  badge,
  action,
  icons,
  meta,
  children,
  selected = false,
  testId = "model-tile",
}: {
  repoId: string;
  /** Плитка-ссылка. Без `to` и `onClick` — обычный блок. */
  to?: string;
  onClick?: () => void;
  accent?: AccentTone;
  quants?: string[];
  features?: string[];
  /** Избранная модель помечается звёздочкой во всех списках. */
  favorite?: boolean;
  /** Причина негодности записи; пусто у годной. */
  unusableReason?: string | null;
  badge?: { tone: BadgeTone; label: ReactNode };
  action?: ReactNode;
  /** Значки состояния перед названием (проверка, расхождение, ошибка). */
  icons?: ReactNode;
  /** Сведения раздела под названием. */
  meta?: ReactNode;
  children?: ReactNode;
  selected?: boolean;
  testId?: string;
}) {
  const variants = buildLaunchVariantsLine(quants, features);
  const body = (
    <>
      <div className="flex flex-wrap justify-between items-start gap-3">
        <div className="min-w-0">
          {/* Усечение вместо выдавливания: без min-w-0 и truncate длинное
              имя репозитория расталкивает плитку шире экрана. Полное имя
              остаётся в подсказке. */}
          <div className="font-['Space_Grotesk'] font-bold flex items-center gap-2 min-w-0" title={repoId}>
            {favorite && (
              <span
                className="material-symbols-outlined text-primary text-base"
                style={{ fontVariationSettings: "'FILL' 1" }}
                data-testid="favorite-star"
                aria-label="избранная модель"
                title="избранная модель"
              >
                star
              </span>
            )}
            {icons}
            <span className="truncate">{repoId}</span>
          </div>
          {variants.text && (
            // Усечение по ширине, полный перечень — подсказкой: молча
            // терять варианты строка не должна.
            <div
              className="text-[11px] font-mono text-neutral-400 mt-1 truncate"
              data-testid="launch-variants"
              title={variants.text}
            >
              {variants.text}
            </div>
          )}
          {unusableReason && (
            <div className="text-[11px] font-mono text-danger mt-1" data-testid="model-unusable">
              негодна: {unusableReason}
            </div>
          )}
          {meta && <div className="text-[11px] text-neutral-500 font-mono mt-1">{meta}</div>}
        </div>
        {action ? (
          <span
            className="shrink-0"
            data-testid="model-tile-action"
            onClick={(event) => {
              // Плитка целиком — ссылка, поэтому действие внутри неё
              // гасит переход: иначе один клик и запустит действие, и
              // откроет страницу.
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            {action}
          </span>
        ) : (
          badge && <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
        )}
      </div>
      {children}
    </>
  );

  const classes = `block w-full text-left bg-surface-container-low p-5 hover:bg-surface-container border-l-4 ${
    selected ? "border-primary" : "border-transparent hover:border-primary"
  }`;
  const accentColor: Record<AccentTone, string> = {
    primary: "var(--color-primary)",
    warn: "var(--color-warn)",
    danger: "var(--color-danger)",
    off: "var(--color-neutral-700)",
    neutral: "var(--color-neutral-700)",
  };

  if (to) {
    return (
      <Link to={to} className={classes} style={{ borderLeftColor: accentColor[accent] }} data-testid={testId}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes} data-testid={testId}>
        {body}
      </button>
    );
  }
  return (
    <div className={classes} data-testid={testId}>
      {body}
    </div>
  );
}
