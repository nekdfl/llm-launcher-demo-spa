import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { accountsApi } from "../../api/accounts";
import { apiErrorMessage } from "../../api/client";
import { orchestratorApi } from "../../api/orchestrator";
import type { EngineInstallation, PluginRecord } from "../../api/types";
import { Modal } from "../../components/Modal";
import { ExtensionsSection } from "./ExtensionsSection";
import {
  FIELD_INPUT,
  FIELD_LABEL,
  GHOST_BUTTON,
  ListCard,
  PageHeader,
  PRIMARY_BUTTON,
  SECTION_CARD,
  SECTION_TITLE,
  SMALL_BUTTON,
  type AccentTone,
} from "../../components/ui";

/** reference/plugins — code-only screen (spec: "Экран плагинов — только
 * код"), install from tar.gz is a modal and admin-only. */
export function PluginsPage() {
  const navigate = useNavigate();
  const [plugins, setPlugins] = useState<PluginRecord[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [archive, setArchive] = useState<File | null>(null);
  const [pluginName, setPluginName] = useState("");
  const [sha256, setSha256] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await orchestratorApi.listPlugins();
        setPlugins(list);
      } catch {
        setPlugins([]);
      }
      setIsAdmin(await accountsApi.isAdmin());
    })();
  }, []);

  async function handleInstall() {
    if (!archive) return;
    setError(null);
    try {
      await orchestratorApi.installPlugin(archive, sha256, pluginName);
      setInstallOpen(false);
      setPlugins(await orchestratorApi.listPlugins());
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось установить плагин"));
    }
  }

  async function tryDelete(plugin: PluginRecord) {
    try {
      await orchestratorApi.deletePlugin(plugin.id);
      setPlugins(await orchestratorApi.listPlugins());
    } catch (err) {
      setError(err instanceof Error ? err.message : "нельзя удалить плагин: есть ссылающиеся установки");
    }
  }

  async function toggleEnabled(plugin: PluginRecord) {
    setError(null);
    try {
      const updated = plugin.enabled
        ? await orchestratorApi.disablePlugin(plugin.id)
        : await orchestratorApi.enablePlugin(plugin.id);
      setPlugins((prev) => (prev ?? []).map((p) => (p.id === updated.id ? updated : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "не удалось изменить состояние плагина");
    }
  }

  return (
    <div>
      <PageHeader
        title="Плагины"
        // Install button is visible only for admins (spec scenario).
      >
        {isAdmin && (
          <button onClick={() => setInstallOpen(true)} className={PRIMARY_BUTTON}>
            Установить из tar.gz
          </button>
        )}
      </PageHeader>

      {!isAdmin && <div className="text-[10px] text-neutral-600 font-mono uppercase mb-6">установка доступна только роли admin</div>}

      {error && <p className="text-xs text-danger font-mono mb-4">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(plugins ?? []).map((plugin) => {
          const failed = plugin.status !== "ok";
          const accent: AccentTone = failed ? "danger" : "primary";
          return (
            <div
              key={plugin.id}
              onClick={() => navigate(`/plugins/${plugin.id}`)}
              className="bg-surface-container-low p-5 cursor-pointer hover:bg-surface-container"
              style={{ boxShadow: `inset 4px 0 0 0 ${failed ? "#ff5c5c" : "#3ce36a"}` }}
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className={`font-['Space_Grotesk'] font-bold ${failed ? "text-neutral-400" : ""}`}>{plugin.name}</div>
                  <div className="text-[11px] text-neutral-500 font-mono mt-1">
                    type: {plugin.plugin_type} · plugin v{plugin.plugin_version} · contract {plugin.contract_version}
                  </div>
                  {plugin.plugin_type === "engine" && (plugin.tasks ?? []).length > 0 && (
                    <div className="text-[11px] text-neutral-400 font-mono mt-1" data-testid={`plugin-tasks-${plugin.id}`}>
                      задачи: {plugin.tasks.join(", ")}
                    </div>
                  )}
                  {failed && plugin.error_detail && <div className="text-[10px] text-danger font-mono mt-2">{plugin.error_detail}</div>}
                </div>
                <span
                  className={`text-[10px] font-['Space_Grotesk'] font-bold uppercase px-2 py-1 ${
                    failed ? "text-danger bg-danger/10" : plugin.enabled ? "text-primary bg-primary/10" : "text-neutral-500 bg-neutral-800"
                  }`}
                >
                  {failed ? "ошибка" : plugin.enabled ? "загружен" : "отключён"}
                </span>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleEnabled(plugin);
                  }}
                  className={SMALL_BUTTON}
                  disabled={failed}
                  title={failed ? "плагин не загружен — отключать нечего" : undefined}
                >
                  {plugin.enabled ? "Отключить" : "Включить"}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    tryDelete(plugin);
                  }}
                  className="text-[10px] font-['Space_Grotesk'] uppercase text-neutral-300 border border-neutral-700 px-3 py-1.5 hover:border-danger hover:text-danger"
                >
                  Удалить
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={installOpen} onClose={() => setInstallOpen(false)} title="Установить плагин" testId="install-plugin-modal">
        <label className="flex flex-col gap-1 mb-3">
          <span className={FIELD_LABEL}>Название плагина</span>
          <input className={FIELD_INPUT} value={pluginName} onChange={(e) => setPluginName(e.currentTarget.value)} />
        </label>
        <label className="flex flex-col gap-1 mb-3">
          <span className={FIELD_LABEL}>Архив плагина (.tar.gz)</span>
          <input
            type="file"
            accept=".tar.gz,.tgz"
            className="bg-surface-container border border-neutral-800 px-3 py-2 font-mono text-xs file:mr-3 file:bg-surface-container-high file:border-0 file:px-2 file:py-1 file:text-neutral-300"
            onChange={(e) => setArchive(e.currentTarget.files?.[0] ?? null)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Контрольная сумма SHA-256</span>
          <input className={FIELD_INPUT} placeholder="a1c9…f04e" value={sha256} onChange={(e) => setSha256(e.currentTarget.value)} />
        </label>
        <div className="text-[10px] text-neutral-600 font-mono mt-3">
          Пути внутри архива проверяются на выход за пределы каталога установки; лимит на распакованный размер применяется по ходу распаковки.
        </div>
        {error && <p className="text-xs text-danger font-mono mt-3">{error}</p>}
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={() => setInstallOpen(false)} className={GHOST_BUTTON}>
            Отмена
          </button>
          <button onClick={handleInstall} disabled={!archive || !sha256 || !pluginName} className={PRIMARY_BUTTON}>
            Установить
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** reference/plugin_detail — manifest grid, this plugin's installations. */
export function PluginDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [plugin, setPlugin] = useState<PluginRecord | null>(null);
  const [installations, setInstallations] = useState<EngineInstallation[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const [pluginList, installationList] = await Promise.all([
          orchestratorApi.listPlugins(),
          orchestratorApi.listEngineInstallations(),
        ]);
        const found = pluginList.find((p) => p.id === Number(id)) ?? null;
        setPlugin(found);
        setInstallations(installationList.filter((i) => i.plugin_id === Number(id)));
        if (!found) setError("Плагин не найден");
      } catch {
        setError("Не удалось загрузить плагин");
      }
      setIsAdmin(await accountsApi.isAdmin());
    })();
  }, [id]);

  if (!plugin) return <p className="py-8 text-sm text-neutral-500 font-mono">{error ?? "Загрузка…"}</p>;

  return (
    <div>
      <PageHeader backTo="/plugins" backLabel="Плагины" title={plugin.name}>
        <span
          className={`text-[10px] font-['Space_Grotesk'] font-bold uppercase px-2 py-1 ${
            plugin.status !== "ok" ? "text-danger bg-danger/10" : plugin.enabled ? "text-primary bg-primary/10" : "text-neutral-500 bg-neutral-800"
          }`}
        >
          {plugin.status !== "ok" ? "ошибка" : plugin.enabled ? "загружен" : "отключён"}
        </span>
      </PageHeader>

      <section className={SECTION_CARD}>
        <h2 className={SECTION_TITLE}>Манифест</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-y-2 text-[11px] font-mono">
          <div className="text-neutral-500 uppercase">тип</div>
          <div>{plugin.plugin_type}</div>
          <div className="text-neutral-500 uppercase">версия плагина</div>
          <div>{plugin.plugin_version}</div>
          <div className="text-neutral-500 uppercase">версия контракта</div>
          <div>{plugin.contract_version}</div>
          <div className="text-neutral-500 uppercase">статус</div>
          <div>{plugin.status}</div>
          {plugin.plugin_type === "engine" && (
            <>
              <div className="text-neutral-500 uppercase">задачи</div>
              <div className="col-span-1 md:col-span-3">{(plugin.tasks ?? []).join(", ") || "—"}</div>
            </>
          )}
          <div className="text-neutral-500 uppercase col-span-2 md:col-span-1">каталог</div>
          <div className="col-span-3 md:col-span-3 text-neutral-400 break-all">{plugin.path}</div>
        </div>
        {plugin.error_detail && <div className="text-[10px] text-danger font-mono mt-3">{plugin.error_detail}</div>}
      </section>

      <section className="bg-surface-container-lowest p-6 mb-6">
        <div className="text-[11px] font-['Space_Grotesk'] uppercase text-neutral-500 mb-2">
          Установки этого плагина ({installations.length})
        </div>
        <div className="flex flex-col gap-2">
          {installations.map((installation) => (
            <ListCard
              key={installation.id}
              to={`/engines/${installation.id}`}
              accent={installation.available ? "primary" : "danger"}
              title={installation.name}
              badge={{ tone: installation.available ? "primary" : "danger", label: installation.available ? "доступна" : "недоступна" }}
            />
          ))}
        </div>
      </section>

      {plugin.plugin_type === "engine" && <ExtensionsSection plugin={plugin} isAdmin={isAdmin} />}

      {error && <p className="text-xs text-danger font-mono mb-4">{error}</p>}

      <div className="flex items-center justify-between">
        <button onClick={() => navigate("/plugins")} className={GHOST_BUTTON}>
          Назад
        </button>
        <button
          onClick={async () => {
            try {
              await orchestratorApi.deletePlugin(plugin.id);
              navigate("/plugins");
            } catch (err) {
              setError(err instanceof Error ? err.message : "нельзя удалить: есть установки, ссылающиеся на плагин");
            }
          }}
          disabled={installations.length > 0}
          title={installations.length > 0 ? "нельзя удалить: есть установки, ссылающиеся на плагин" : undefined}
          className="px-4 py-2 border border-danger/30 text-danger/40 font-['Space_Grotesk'] text-xs font-bold uppercase disabled:cursor-not-allowed enabled:hover:bg-danger enabled:hover:text-black"
        >
          Удалить плагин
        </button>
      </div>
    </div>
  );
}

export function PluginListLink() {
  return <Link to="/plugins">Плагины</Link>;
}
