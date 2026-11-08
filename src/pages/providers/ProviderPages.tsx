import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { orchestratorApi } from "../../api/orchestrator";
import type { ModelEntity, Provider } from "../../api/types";
import {
  FIELD_INPUT,
  FIELD_LABEL,
  GHOST_BUTTON,
  ListCard,
  PageHeader,
  PRIMARY_BUTTON,
  SECTION_CARD,
  SECTION_TITLE,
  StatusBadge,
} from "../../components/ui";

/** reference/provider_manager — cards per provider; «локальный каталог» has
 * no settings (spec: "Provider без настроек не кликабелен"), so its card is
 * a plain div via ListCard without `to`. */
export function ProviderManagerPage() {
  const [providers, setProviders] = useState<Provider[] | null>(null);

  useEffect(() => {
    orchestratorApi
      .listProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);

  return (
    <div>
      <PageHeader title="Менеджер провайдеров" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {(providers ?? []).map((provider) => {
          const hasSettings = Object.keys(provider.config).length > 0;
          return (
            <ListCard
              key={provider.id}
              to={hasSettings ? `/providers/${provider.id}` : undefined}
              accent={hasSettings ? "primary" : "neutral"}
              title={provider.name}
              meta={hasSettings ? "type: provider · настройки заданы" : "type: provider · без настроек"}
              badge={{ tone: hasSettings ? "primary" : "neutral", label: hasSettings ? "настроено" : "по умолчанию" }}
            />
          );
        })}
      </div>
    </div>
  );
}

/** reference/provider_edit — provider-specific settings (e.g. the HF token)
 * live in the provider's own card, not in system settings (spec). */
export function ProviderEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [models, setModels] = useState<ModelEntity[]>([]);
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const [providerData, modelList] = await Promise.all([
          orchestratorApi.getProvider(Number(id)),
          orchestratorApi.listModels(),
        ]);
        setProvider(providerData);
        setModels(modelList.filter((m) => m.provider_id === providerData.id));
        const existingToken = providerData.config["token"];
        setToken(typeof existingToken === "string" ? existingToken : "");
      } catch {
        setError("Не удалось загрузить провайдера");
      }
    })();
  }, [id]);

  async function handleSave() {
    if (!provider) return;
    try {
      await orchestratorApi.updateProviderConfig(provider.id, { ...provider.config, token: token });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить настройки");
    }
  }

  if (!provider) return <p className="py-8 text-sm text-neutral-500 font-mono">{error ?? "Загрузка…"}</p>;

  return (
    <div>
      <PageHeader backTo="/providers" backLabel="Провайдеры" icon="cloud" title={provider.name} />

      <section className={SECTION_CARD}>
        <h2 className={SECTION_TITLE}>Настройки</h2>
        <label className="flex flex-col gap-1 text-sm mb-4">
          <span className={FIELD_LABEL}>HF-токен (для gated-репозиториев)</span>
          <input type="password" className={FIELD_INPUT} value={token} onChange={(e) => setToken(e.currentTarget.value)} />
        </label>
        <div className="text-[10px] text-neutral-600 font-mono">
          Специфичные настройки provider'а живут в его карточке, не в общих системных настройках.
        </div>
      </section>

      <section className="bg-surface-container-lowest p-6 mb-6">
        <div className="text-[11px] font-['Space_Grotesk'] uppercase text-neutral-500 mb-2">
          Модели с этого provider'а ({models.length})
        </div>
        <div className="flex flex-col gap-2">
          {models.map((model) => (
            <Link
              key={model.id}
              to={`/models/${model.id}`}
              className="flex justify-between bg-surface-container px-3 py-2 text-xs hover:bg-surface-container-high"
            >
              <span>{model.ref}</span>
              <span className="text-neutral-500 font-mono">{model.format}</span>
            </Link>
          ))}
        </div>
      </section>

      {error && <p className="text-xs text-danger font-mono mb-4">{error}</p>}

      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/providers")} className={GHOST_BUTTON}>
          Отмена
        </button>
        <button onClick={handleSave} className={PRIMARY_BUTTON}>
          Сохранить
        </button>
        {saved && <span className="text-xs text-primary font-mono">Сохранено</span>}
      </div>
    </div>
  );
}

export function ProviderBadge({ name }: { name: string }) {
  return <StatusBadge tone={name === "локальный каталог" ? "neutral" : "primary"}>{name}</StatusBadge>;
}
