import { useEffect, useState } from "react";
import { orchestratorApi } from "../../api/orchestrator";
import type { AssistantSuggestion, AssistantSuggestionsResponse } from "../../api/types";

/** reference/profile_create/profile_edit, section «Подсказки LLM-помощника».
 * Each suggestion is its own row with its README quote as evidence and is
 * applied by its own button — one click applies one suggestion, never the
 * batch (spec: "Применение одного предложения не затрагивает другие поля").
 * Unavailable assistant renders nothing blocking — the formula section above
 * keeps working (spec: "Профиль создаётся без запущенного помощника"). */
export function AssistantHintsSection({
  modelId,
  onApply,
}: {
  modelId: number | null;
  onApply: (field: string, value: string) => void;
}) {
  const [response, setResponse] = useState<AssistantSuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  useEffect(() => {
    setResponse(null);
    setApplied(new Set());
    if (modelId === null) return;
    let cancelled = false;
    setLoading(true);
    orchestratorApi
      .getAssistantSuggestions(modelId)
      .then((result) => {
        if (!cancelled) setResponse(result);
      })
      .catch(() => {
        // Network-level failure — same degradation as available:false.
        if (!cancelled) setResponse({ available: false, reason: null, suggestions: [], warnings: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  if (modelId === null || loading) return null;

  // Assistant not configured / not running / README missing → the section
  // shows a single quiet line, never an error banner, never a blocker.
  if (!response || !response.available) {
    return (
      <section className="bg-surface-container-lowest p-6 mb-6" data-testid="assistant-hints-unavailable">
        <div className="text-[11px] font-['Space_Grotesk'] uppercase text-neutral-500 mb-2">
          Подсказки LLM-помощника <span className="text-neutral-700">(необязательно)</span>
        </div>
        <div className="text-[10px] text-neutral-600 font-mono">
          Помощник не запущен или не настроен — профиль создаётся с параметрами формулы.
        </div>
      </section>
    );
  }

  function applyOne(suggestion: AssistantSuggestion) {
    onApply(suggestion.field, suggestion.value);
    setApplied((prev) => new Set(prev).add(suggestion.field + "=" + suggestion.value));
  }

  return (
    <section className="bg-surface-container-lowest p-6 mb-6" data-testid="assistant-hints">
      <div className="text-[11px] font-['Space_Grotesk'] uppercase text-neutral-500 mb-2">
        Подсказки LLM-помощника <span className="text-neutral-700">(необязательно)</span>
      </div>
      <div className="flex flex-col gap-2">
        {response.suggestions.map((suggestion) => {
          const key = suggestion.field + "=" + suggestion.value;
          return (
            <div key={key} className="flex items-center justify-between bg-surface-container px-4 py-3">
              <div>
                <div className="text-xs">
                  <span className="text-neutral-400">{suggestion.field}:</span>{" "}
                  <span className="text-primary font-mono">{suggestion.value}</span>
                </div>
                <div className="text-[10px] text-neutral-600 mt-1">
                  {suggestion.reason} · «{suggestion.quote}»
                </div>
              </div>
              <button
                onClick={() => applyOne(suggestion)}
                disabled={applied.has(key)}
                data-testid={`apply-${suggestion.field}`}
                className="px-3 py-1 border border-primary text-primary font-['Space_Grotesk'] text-[10px] font-bold uppercase disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {applied.has(key) ? "Применено" : "Применить"}
              </button>
            </div>
          );
        })}
      </div>

      {response.warnings.length > 0 && (
        <div className="text-[10px] text-warn font-mono px-4 mt-3" data-testid="assistant-warnings">
          {response.warnings.map((warning) => (
            <div key={warning}>⚠ {warning}</div>
          ))}
        </div>
      )}
    </section>
  );
}
