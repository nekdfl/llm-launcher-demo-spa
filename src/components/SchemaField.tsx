import type { ReactNode } from "react";
import type { FieldDescriptor } from "../api/orchestrator";
import { INHERITED_BLOCK } from "./InheritanceMark";
import { FIELD_HINT, FIELD_INPUT, FIELD_LABEL } from "./ui";

/** Поле формы по дескриптору (`FieldDescriptor`) — схемы плагинов и опции
 * расширений рендерятся одним способом: ни одно имя или подпись поля не
 * зашиты в страницу. Значение хранится в своём типе (boolean, number,
 * string), потому что сервер проверяет опции расширений по типу. */
export function SchemaField({
  field,
  value,
  onChange,
  error,
  testId,
  labelExtra,
  dimmed = false,
}: {
  field: FieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string | null;
  testId?: string;
  /** Пометка рядом с подписью — у inference это сравнение с профилем. */
  labelExtra?: ReactNode;
  /** Значение совпадает с профилем: поле приглушено, ввод доступен. */
  dimmed?: boolean;
}) {
  const label = (
    <span className={`${FIELD_LABEL} flex flex-wrap items-center gap-2`}>
      <span>
        {field.label}
        {field.required ? " *" : ""}
      </span>
      {labelExtra}
    </span>
  );
  const dim = dimmed ? INHERITED_BLOCK : "";
  let control;
  if (field.type === "boolean") {
    return (
      <label className={`flex flex-col gap-1 ${dim}`}>
        <span className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.currentTarget.checked)} data-testid={testId} />
          {label}
        </span>
        {field.description && <span className={FIELD_HINT}>{field.description}</span>}
        {error && <span className="text-[10px] text-danger font-mono">{error}</span>}
      </label>
    );
  }
  if (field.type === "choice") {
    control = (
      <select className={FIELD_INPUT} value={value == null ? "" : String(value)} onChange={(e) => onChange(e.currentTarget.value)} data-testid={testId}>
        <option value="" disabled>
          Выберите…
        </option>
        {(field.choices ?? []).map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    );
  } else if (field.type === "integer") {
    control = (
      <input
        type="number"
        className={FIELD_INPUT}
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.currentTarget.value === "" ? null : Number(e.currentTarget.value))}
        data-testid={testId}
      />
    );
  } else {
    control = (
      <input className={FIELD_INPUT} value={value == null ? "" : String(value)} onChange={(e) => onChange(e.currentTarget.value)} data-testid={testId} />
    );
  }
  return (
    <label className={`flex flex-col gap-1 ${dim}`}>
      {label}
      {control}
      {field.description && <span className={FIELD_HINT}>{field.description}</span>}
      {error && <span className="text-[10px] text-danger font-mono">{error}</span>}
    </label>
  );
}
