import { useEffect, useState } from "react";
import { copyText } from "../lib/clipboard";

const COPIED_FEEDBACK_MS = 1500;

/** «Копировать»: кладёт `text` в буфер обмена и кратко показывает итог. */
export function CopyButton({ text, className, testId }: { text: string; className: string; testId?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <button type="button" className={className} disabled={text === ""} onClick={() => setState(copyText(text) ? "copied" : "failed")} data-testid={testId}>
      {state === "copied" ? "Скопировано" : state === "failed" ? "Не удалось" : "Копировать"}
    </button>
  );
}
