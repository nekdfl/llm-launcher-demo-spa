import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/** Shared design-system pieces for the management screens — the class
 * strings are carried over verbatim from the reference mockups so every
 * section renders as the same design system, not a re-interpretation. */

export const FIELD_LABEL = "text-[11px] text-neutral-500 uppercase font-['Space_Grotesk']";
export const FIELD_INPUT = "bg-surface-container border border-neutral-800 px-3 py-2 font-mono text-xs";

export const SECTION_CARD = "bg-surface-container-lowest tactical-accent p-6 mb-6";
export const SECTION_TITLE = "font-['Space_Grotesk'] text-xs font-bold uppercase tracking-widest text-primary mb-4";

export const PRIMARY_BUTTON =
  "px-4 py-2 bg-primary text-black font-['Space_Grotesk'] text-xs font-bold uppercase hover:bg-primary/80 disabled:opacity-50";
export const GHOST_BUTTON =
  "px-4 py-2 border border-neutral-700 text-neutral-300 font-['Space_Grotesk'] text-xs font-bold uppercase hover:border-neutral-500";
export const DANGER_BUTTON =
  "flex items-center gap-2 px-4 py-2 border border-danger/50 text-danger font-['Space_Grotesk'] text-xs font-bold uppercase hover:bg-danger hover:text-black transition-all";
export const SMALL_BUTTON =
  "text-[10px] font-['Space_Grotesk'] uppercase text-neutral-400 border border-neutral-700 px-3 py-1.5 hover:border-primary hover:text-primary";

/** Status badge colors, mirroring the tactical-accent palette. */
export type BadgeTone = "primary" | "warn" | "danger" | "neutral";

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  primary: "text-primary bg-primary/10",
  warn: "text-warn bg-warn/10",
  danger: "text-danger bg-danger/10",
  neutral: "text-neutral-300 bg-neutral-700/30",
};

export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className={`text-[10px] font-['Space_Grotesk'] font-bold uppercase px-2 py-1 ${BADGE_TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

/** Left accent stripe color for list cards — the "цветная левая полоса-акцент
 * по статусу" pattern from UI-BEHAVIOR §1. */
export type AccentTone = "primary" | "warn" | "danger" | "off" | "neutral";

const ACCENT_COLOR: Record<AccentTone, string> = {
  primary: "#3ce36a",
  warn: "#f1c100",
  danger: "#ff5c5c",
  off: "#4a4a4a",
  neutral: "#8b9cb3",
};

function accentStyle(tone: AccentTone): React.CSSProperties {
  return { boxShadow: `inset 4px 0 0 0 ${ACCENT_COLOR[tone]}` };
}

/** Breadcrumb page header with a back link ("← Раздел") — UI-BEHAVIOR §1:
 * every create/edit/detail page is its own screen with this header. */
export function PageHeader({
  backTo,
  backLabel,
  title,
  icon,
  pulse,
  children,
}: {
  backTo?: string;
  backLabel?: string;
  title: ReactNode;
  icon?: string;
  pulse?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="py-8">
      {backTo && backLabel && (
        <Link className="text-[10px] font-['Space_Grotesk'] uppercase text-neutral-500 hover:text-primary" to={backTo}>
          &larr; {backLabel}
        </Link>
      )}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-3">
          {pulse && <span className="w-2 h-2 bg-primary animate-pulse" />}
          {icon && <span className="material-symbols-outlined text-primary text-2xl">{icon}</span>}
          <h1 className="font-['Space_Grotesk'] text-3xl font-extrabold tracking-tighter uppercase">{title}</h1>
        </div>
        {children}
      </div>
    </header>
  );
}

interface ListCardProps {
  to?: string;
  accent: AccentTone;
  title: ReactNode;
  meta?: ReactNode;
  badge?: { tone: BadgeTone; label: ReactNode };
  /** Действие на карточке вместо бейджа. Карточка остаётся ссылкой, а
   * нажатие действия не открывает страницу: обработчик гасит переход. */
  action?: ReactNode;
  children?: ReactNode;
  dimmed?: boolean;
}

/** Grid list card — UI-BEHAVIOR §1: "Список — сетка карточек, не таблица…
 * Карточка — настоящая ссылка". When `to` is absent (provider «локальный
 * каталог», plugin delete-only states) the card renders as a plain div —
 * the spec's "Provider без настроек не кликабелен". */
export function ListCard({ to, accent, title, meta, badge, action, children, dimmed }: ListCardProps) {
  const body = (
    <>
      <div className="flex justify-between items-start">
        <div className="min-w-0">
          <div className={`font-['Space_Grotesk'] font-bold ${dimmed ? "text-neutral-400" : ""}`}>{title}</div>
          {meta && <div className="text-[11px] text-neutral-500 font-mono mt-1">{meta}</div>}
        </div>
        {action ? (
          <span
            className="shrink-0"
            data-testid="list-card-action"
            onClick={(event) => {
              // Карточка целиком — ссылка (UI-BEHAVIOR §1), поэтому
              // действие внутри неё обязано погасить переход, иначе один
              // клик и запустит действие, и откроет страницу.
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

  const classes = `block bg-surface-container-low p-5 hover:bg-surface-container ${dimmed ? "opacity-70" : ""}`;

  if (to) {
    return (
      <Link to={to} className={classes} style={accentStyle(accent)}>
        {body}
      </Link>
    );
  }
  return (
    <div className={classes} style={accentStyle(accent)}>
      {body}
    </div>
  );
}
