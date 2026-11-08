import { Link } from "react-router-dom";
import { FIELD_LABEL } from "./ui";

const LINK_BOX =
  "bg-surface-container border border-neutral-800 px-3 py-2 font-mono text-xs text-primary truncate hover:border-primary block";
const MISSING_BOX = "bg-surface-container border border-neutral-800 px-3 py-2 font-mono text-xs text-neutral-500 truncate block";

/** Строка связи с другой сущностью: подпись, название и ссылка на её
 * страницу — цепочка модель → профиль → inference должна проходиться, а
 * не выясняться сопоставлением названий между разделами.
 *
 * Без `to` (сущность не найдена по своему идентификатору) строка
 * остаётся видимой с пометкой: ссылка в никуда хуже отсутствия ссылки,
 * а исчезнувшая строка скрывает сам факт связи. */
export function EntityLink({
  label,
  name,
  to,
  missingNote = "не найдена",
  testId,
}: {
  label: string;
  /** Название связанной сущности; пусто, когда её нет. */
  name: string | null | undefined;
  /** Адрес страницы сущности; пусто, когда её нет. */
  to: string | null | undefined;
  missingNote?: string;
  testId?: string;
}) {
  const resolved = Boolean(name && to);
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <span className={FIELD_LABEL}>{label}</span>
      {resolved ? (
        <Link to={to!} className={LINK_BOX}>
          {name}
        </Link>
      ) : (
        <span className={MISSING_BOX} data-testid={testId ? `${testId}-missing` : undefined}>
          {missingNote}
        </span>
      )}
    </div>
  );
}
