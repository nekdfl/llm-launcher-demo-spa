import { type ReactNode, useEffect, useRef, useState } from "react";
import { useAutosizeTextarea } from "../hooks/useAutosizeTextarea";
import { type ArgvRow, parseArgv, rowError, serializeArgv, valueTokenCount } from "../lib/argv";
import { CopyButton } from "./CopyButton";
import { FIELD_HINT, FIELD_INPUT, FIELD_INPUT_ACCENT, FIELD_LABEL, PANEL, SECTION_TITLE, SELECT_TILE, TOOL_BUTTON } from "./ui";

interface EditorRow extends ArgvRow {
  id: number;
}


function pluralParams(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} параметр`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} параметра`;
  return `${count} параметров`;
}

/** «Менеджер аргументов» (макет `reference/parametres`): сырая строка
 * `cli_options` ↔ список `ключ = значение`. Источник истины — строка; список
 * хранит исходный текст ключей и значений, поэтому правка одной строки не
 * переписывает запись остальных (`--k=v`, кавычки JSON). */
export function ArgvEditor({
  value,
  onChange,
  label,
  inherited = false,
  testId = "argv-editor",
}: {
  value: string;
  onChange: (value: string) => void;
  /** Заголовок поля; по умолчанию «Опции командной строки». */
  label?: ReactNode;
  /** Значение унаследовано от профиля — блок приглушён до первой правки. */
  inherited?: boolean;
  testId?: string;
}) {
  const nextId = useRef(0);
  const withIds = (rows: ArgvRow[]): EditorRow[] => rows.map((row) => ({ ...row, id: nextId.current++ }));
  const parse = (text: string): { rows: EditorRow[] | null; error: string | null } => {
    try {
      return { rows: withIds(parseArgv(text)), error: null };
    } catch (err) {
      return { rows: null, error: (err as Error).message };
    }
  };

  const [rows, setRows] = useState<EditorRow[]>(() => parse(value).rows ?? []);
  const [rawError, setRawError] = useState<string | null>(() => parse(value).error);
  const [dragHandleId, setDragHandleId] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);
  const rawRef = useRef<HTMLTextAreaElement>(null);
  useAutosizeTextarea(rawRef, value);
  /** Последняя строка, отданная наружу самим редактором: её возврат через
   * `value` не пересобирает список (иначе пропали бы недописанные строки). */
  const emitted = useRef(value);

  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    const parsed = parse(value);
    setRawError(parsed.error);
    if (parsed.rows) setRows(parsed.rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const errors = rows.map(rowError);
  const hasRowErrors = errors.some((error) => error !== null);
  const paramCount = rows.filter((row) => row.key !== "" || row.value !== "").length;

  const emit = (text: string) => {
    emitted.current = text;
    onChange(text);
  };

  const updateRows = (next: EditorRow[]) => {
    setRows(next);
    if (next.map(rowError).every((error) => error === null)) emit(serializeArgv(next));
  };

  const editRaw = (text: string) => {
    const parsed = parse(text);
    setRawError(parsed.error);
    if (parsed.rows) setRows(parsed.rows);
    emit(text);
  };

  const patchRow = (id: number, patch: Partial<ArgvRow>) => updateRows(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const moveRow = (from: number, to: number) => {
    if (from === to) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    updateRows(next);
  };

  const status = rawError
    ? { text: `Ошибка разбора: ${rawError}`, className: "text-danger" }
    : hasRowErrors
      ? { text: "Есть ошибки в строках — командная строка не обновлена", className: "text-warn" }
      : { text: "Синхронизировано с визуальным редактором ✓", className: "text-primary" };

  return (
    <div className={`border border-neutral-800 p-4 flex flex-col gap-4 ${inherited ? "opacity-70" : ""}`} data-testid={testId}>
      <div className={`${PANEL} flex flex-col gap-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`${FIELD_LABEL} flex flex-wrap items-center gap-2`}>{label ?? "Опции командной строки"}</span>
          <div className="flex items-center gap-2">
            <CopyButton text={value} className={TOOL_BUTTON} testId={`${testId}-copy`} />
            <button type="button" className={`${TOOL_BUTTON} hover:!border-danger hover:!text-danger`} onClick={() => editRaw("")} disabled={value === ""}>
              Очистить
            </button>
          </div>
        </div>
        <textarea
          ref={rawRef}
          aria-label="Опции командной строки"
          className="w-full bg-surface-container-lowest border border-neutral-800 p-3 font-mono text-xs text-primary leading-relaxed resize-none overflow-y-hidden focus:outline-none focus:border-primary"
          spellCheck={false}
          rows={1}
          value={value}
          onChange={(e) => editRaw(e.currentTarget.value)}
          data-testid={`${testId}-raw`}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-neutral-600">
          <span>
            Форма записи сохраняется как есть: <code className="text-neutral-400">--flag value</code>, <code className="text-neutral-400">--key=val</code>,{" "}
            <code className="text-neutral-400">-ngl 99</code>, JSON в кавычках
          </span>
          <span className={status.className} data-testid={`${testId}-status`}>
            {status.text}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className={`${SECTION_TITLE} !mb-0 !text-neutral-300`}>Разобранные параметры</span>
          <span className="px-2 py-0.5 text-[11px] font-mono border border-neutral-800 text-primary" data-testid={`${testId}-count`}>
            {pluralParams(paramCount)}
          </span>
        </div>
        <span className={FIELD_HINT}>
          Перетаскивайте за <span className="text-primary">⋮⋮</span> для смены порядка
        </span>
      </div>

      <fieldset disabled={rawError !== null} className="flex flex-col gap-2 disabled:opacity-50">
        {rows.map((row, index) => {
          const error = errors[index];
          const multiValue = valueTokenCount(row.value) > 1;
          return (
            <div
              key={row.id}
              draggable={dragHandleId === row.id}
              onDragStart={(e) => {
                dragFrom.current = index;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(row.id));
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom.current !== null) moveRow(dragFrom.current, index);
                dragFrom.current = null;
              }}
              onDragEnd={() => {
                dragFrom.current = null;
                setDragHandleId(null);
              }}
              className={`group flex flex-col gap-1 p-2.5 ${error ? "border border-danger/60 bg-surface-container/60" : SELECT_TILE}`}
              data-testid={`${testId}-row-${index}`}
            >
              <div className="flex items-center gap-2 sm:gap-3">
                <span
                  className="cursor-grab active:cursor-grabbing text-neutral-600 group-hover:text-primary px-1 select-none font-bold leading-none"
                  title="Перетащить строку"
                  onMouseDown={() => setDragHandleId(row.id)}
                  onMouseUp={() => setDragHandleId(null)}
                >
                  ⋮⋮
                </span>
                <span className="w-8 text-[11px] font-mono text-neutral-500 text-center select-none">#{index + 1}</span>
                <input
                  aria-label={`Ключ #${index + 1}`}
                  className={`${FIELD_INPUT_ACCENT} w-full !py-1.5 flex-1 min-w-[120px] max-w-xs`}
                  placeholder={index === 0 ? "позиционный" : "--ключ"}
                  spellCheck={false}
                  value={row.key}
                  onChange={(e) => patchRow(row.id, { key: e.currentTarget.value })}
                />
                <button
                  type="button"
                  aria-label={`Разделитель #${index + 1}`}
                  title={row.separator === "=" ? "Записано как --ключ=значение; нажмите для --ключ значение" : "Записано как --ключ значение; нажмите для --ключ=значение"}
                  className="w-6 text-xs font-mono font-bold text-neutral-500 hover:text-primary disabled:opacity-40 disabled:hover:text-neutral-500"
                  disabled={row.key === "" || (row.separator === " " && multiValue)}
                  onClick={() => patchRow(row.id, { separator: row.separator === "=" ? " " : "=" })}
                >
                  {row.separator === "=" ? "=" : "␣"}
                </button>
                <input
                  aria-label={`Значение #${index + 1}`}
                  className={`${FIELD_INPUT} w-full !py-1.5 flex-[1.5] min-w-[120px]`}
                  placeholder={row.key === "" ? "" : "булев флаг (без значения)"}
                  spellCheck={false}
                  value={row.value}
                  onChange={(e) => patchRow(row.id, { value: e.currentTarget.value })}
                />
                <button
                  type="button"
                  aria-label={`Удалить #${index + 1}`}
                  title="Удалить параметр"
                  className="p-1.5 text-neutral-500 hover:text-danger"
                  onClick={() => updateRows(rows.filter((r) => r.id !== row.id))}
                >
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
              {error && (
                <div className="pl-14 text-[10px] font-mono text-danger" data-testid={`${testId}-row-${index}-error`}>
                  {error}
                </div>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="w-full py-2.5 border border-dashed border-neutral-800 text-[11px] font-mono text-neutral-500 hover:text-primary hover:border-primary"
          onClick={() => updateRows([...rows, { id: nextId.current++, key: "", separator: " ", value: "" }])}
        >
          + Добавить новый параметр (ключ = значение)
        </button>
      </fieldset>
    </div>
  );
}
