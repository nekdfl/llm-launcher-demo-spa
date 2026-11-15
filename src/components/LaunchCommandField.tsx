import { useEffect, useRef, useState } from "react";
import { useAutosizeTextarea } from "../hooks/useAutosizeTextarea";
import { orchestratorApi } from "../api/orchestrator";
import type { LaunchCommandPreview, LaunchCommandPreviewInput } from "../api/types";
import { CopyButton } from "./CopyButton";
import { FIELD_LABEL, TOOL_BUTTON } from "./ui";

// Правка формы перестраивает команду не на каждый символ, а после паузы ввода.
const PREVIEW_DEBOUNCE_MS = 300;

/** Поле «Команда запуска» только для чтения: полная команда процесса движка
 * (окружение, исполняемый файл варианта движка, argv), как её построит плагин из
 * переданных значений. `input` = `null` — значений для сборки ещё нет. */
export function LaunchCommandField({
  label,
  hint,
  input,
  testId,
}: {
  label: string;
  hint?: string;
  input: LaunchCommandPreviewInput | null;
  testId: string;
}) {
  const [preview, setPreview] = useState<LaunchCommandPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputKey = input ? JSON.stringify(input) : "";
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const shown = error ? `⚠ ${error}` : (preview?.command ?? (input ? "…" : "выберите модель и плагин"));
  useAutosizeTextarea(areaRef, shown);

  useEffect(() => {
    if (!input) {
      setPreview(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      orchestratorApi
        .previewLaunchCommand(input)
        .then((result) => {
          if (cancelled) return;
          setPreview(result);
          setError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setPreview(null);
          setError(err instanceof Error ? err.message : "не удалось построить команду");
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey]);

  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`${FIELD_LABEL} flex flex-wrap items-center gap-2`}>
          {label}
          <span className="text-neutral-700 normal-case font-normal">
            — только чтение{preview ? `; движок «${preview.plugin_name}»` : ""}
            {hint ? `; ${hint}` : ""}
          </span>
        </span>
        {/* Копируется только построенная команда: пока её нет (строится,
            ошибка превью, нет модели) — кнопка недоступна. */}
        <CopyButton
          text={error ? "" : (preview?.command ?? "")}
          className={TOOL_BUTTON}
          testId={`${testId}-copy`}
        />
      </div>
      <textarea
        ref={areaRef}
        readOnly
        spellCheck={false}
        rows={1}
        className="bg-surface-container-lowest border border-neutral-900 px-3 py-2 font-mono text-xs text-neutral-400 leading-relaxed resize-none overflow-y-hidden cursor-text"
        value={shown}
        data-testid={`${testId}-value`}
      />
    </div>
  );
}
