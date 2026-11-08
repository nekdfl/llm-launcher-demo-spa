import { useEffect, useState } from "react";
import { orchestratorApi } from "../../api/orchestrator";
import { FIELD_INPUT, FIELD_LABEL, PRIMARY_BUTTON } from "../../components/ui";

/** reference/settings, «Хранение и помощник» — the assistant is an ordinary
 * inference behind the router, so configuring it means pointing at the
 * router's OpenAI-compatible base URL, a model name (kept on CPU by the
 * operator's own choice), and an API key. Empty model/key = not configured =
 * every profile form silently renders formula-only (spec: profile creation
 * never depends on the assistant). */
export function AssistantSettingsSection() {
  const [routerBaseUrl, setRouterBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    orchestratorApi
      .getAssistantSettings()
      .then((settings) => {
        setRouterBaseUrl(settings.router_base_url);
        setModel(settings.model);
        setHasApiKey(settings.has_api_key);
        setConfigured(settings.configured);
      })
      .catch(() => setError("Не удалось загрузить настройки помощника"));
  }, []);

  async function handleSave() {
    setError(null);
    try {
      const result = await orchestratorApi.updateAssistantSettings({
        router_base_url: routerBaseUrl,
        // Empty key input keeps the stored key (the raw key is never sent back
        // to the UI) — only overwrite when the operator typed a new one.
        api_key: apiKey || (hasApiKey ? "__KEEP__" : ""),
        model,
      });
      setConfigured(result.configured);
      setHasApiKey(hasApiKey || apiKey !== "");
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить настройки помощника");
    }
  }

  return (
    <section id="assistant" className="bg-surface-container-lowest p-6 mb-6 scroll-mt-20" data-testid="assistant-settings">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-['Space_Grotesk'] text-xs font-bold uppercase tracking-widest text-primary">
          Помощник профилей <span className="text-neutral-600 normal-case font-normal">(необязательно)</span>
        </h2>
        <span
          className={`text-[10px] font-['Space_Grotesk'] font-bold uppercase px-2 py-1 ${
            configured ? "text-primary bg-primary/10" : "text-neutral-300 bg-neutral-700/30"
          }`}
          data-testid="assistant-configured-badge"
        >
          {configured ? "настроен" : "не настроен"}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mb-3">
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Base URL роутера</span>
          <input
            className={FIELD_INPUT}
            placeholder="http://127.0.0.1:8899/v1"
            value={routerBaseUrl}
            onChange={(e) => setRouterBaseUrl(e.currentTarget.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Модель-помощник</span>
          <input
            className={FIELD_INPUT}
            placeholder="gemma-3-12b-cpu"
            value={model}
            onChange={(e) => setModel(e.currentTarget.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>
            API-ключ {hasApiKey && <span className="text-neutral-700 normal-case font-normal">— задан, оставьте пустым чтобы сохранить</span>}
          </span>
          <input
            type="password"
            className={FIELD_INPUT}
            placeholder={hasApiKey ? "••••••••" : "sk-llm-…"}
            value={apiKey}
            onChange={(e) => setApiKey(e.currentTarget.value)}
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handleSave} className={PRIMARY_BUTTON}>
          Сохранить
        </button>
        {saved && <span className="text-xs text-primary font-mono">Сохранено</span>}
        {error && <span className="text-xs text-danger font-mono">{error}</span>}
      </div>
      <div className="text-[10px] text-neutral-600 font-mono mt-3">
        Помощник — обычный inference за роутером, разумно держать его на CPU. Пока он не настроен или не запущен, формы профилей работают только с формулой.
      </div>
    </section>
  );
}
