import { useCallback, useEffect, useState } from "react";
import { apiErrorMessage } from "../../api/client";
import { orchestratorApi } from "../../api/orchestrator";
import type { EngineExtension, PluginRecord, Profile } from "../../api/types";
import { Modal } from "../../components/Modal";
import { FIELD_INPUT, FIELD_LABEL, GHOST_BUTTON, PRIMARY_BUTTON, SECTION_CARD, SECTION_TITLE, SMALL_BUTTON } from "../../components/ui";

const STATUS_LABEL: Record<string, string> = {
  ok: "готово",
  invalid_manifest: "ошибка манифеста",
  incompatible: "несовместимо",
  missing: "нет на диске",
};

/** Раздел «Расширения» страницы engine-плагина (engine-tasks-and-extensions):
 * список, установка модальным окном (только admin) и удаление, заблокированное,
 * пока расширение включено в профиле. Плагин без поддержки расширений
 * показывает причину вместо действия установки. */
export function ExtensionsSection({ plugin, isAdmin }: { plugin: PluginRecord; isAdmin: boolean }) {
  const [extensions, setExtensions] = useState<EngineExtension[]>([]);
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [installOpen, setInstallOpen] = useState(false);
  const [archive, setArchive] = useState<File | null>(null);
  const [sha256, setSha256] = useState("");
  const [installError, setInstallError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [schema, profileList] = await Promise.all([
        orchestratorApi.getPluginSchema(plugin.id),
        orchestratorApi.listProfiles(),
      ]);
      setExtensions(schema.extensions ?? []);
      setUnsupportedReason(schema.extensions_unsupported_reason ?? null);
      setProfiles(profileList.filter((p) => p.engine_plugin_id === plugin.id));
    } catch {
      setError("Не удалось загрузить расширения плагина");
    }
  }, [plugin.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  function referencingProfiles(extension: EngineExtension): string[] {
    return profiles.filter((p) => p.extensions && extension.name in p.extensions).map((p) => p.name);
  }

  async function handleInstall() {
    if (!archive) return;
    setInstallError(null);
    try {
      await orchestratorApi.installPluginExtension(plugin.id, archive, sha256);
      setInstallOpen(false);
      setArchive(null);
      setSha256("");
      await reload();
    } catch (err) {
      // Окно не закрывается: причина отказа видна там, где её вызвали.
      setInstallError(apiErrorMessage(err, "Не удалось установить расширение"));
    }
  }

  async function handleDelete(extension: EngineExtension) {
    setError(null);
    try {
      await orchestratorApi.deletePluginExtension(plugin.id, extension.id);
      await reload();
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось удалить расширение"));
    }
  }

  return (
    <section className={SECTION_CARD} data-testid="extensions-section">
      <div className="flex items-center justify-between mb-3">
        <h2 className={SECTION_TITLE}>Расширения</h2>
        {isAdmin && !unsupportedReason && (
          <button onClick={() => setInstallOpen(true)} className={SMALL_BUTTON} data-testid="extension-install-open">
            Установить расширение
          </button>
        )}
      </div>
      {unsupportedReason && (
        <p className="text-[11px] text-neutral-500 font-mono mb-3" data-testid="extensions-unsupported">
          {unsupportedReason}
        </p>
      )}
      {!isAdmin && !unsupportedReason && (
        <div className="text-[10px] text-neutral-600 font-mono uppercase mb-3">установка доступна только роли admin</div>
      )}
      {extensions.length === 0 && !unsupportedReason && (
        <p className="text-[11px] text-neutral-500 font-mono">Расширений нет</p>
      )}
      <div className="flex flex-col gap-2">
        {extensions.map((extension) => {
          const usedBy = referencingProfiles(extension);
          const failed = extension.status !== "ok";
          return (
            <div key={extension.id} className="bg-surface-container-low p-3 flex items-start justify-between gap-3">
              <div>
                <div className="font-['Space_Grotesk'] font-bold text-sm">{extension.name}</div>
                <div className="text-[11px] text-neutral-500 font-mono">
                  v{extension.version || "—"} · {extension.task || "—"}
                </div>
                {failed && extension.error_detail && (
                  <div className="text-[10px] text-danger font-mono mt-1">{extension.error_detail}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-['Space_Grotesk'] font-bold uppercase px-2 py-1 ${
                    failed ? "text-danger bg-danger/10" : "text-primary bg-primary/10"
                  }`}
                >
                  {STATUS_LABEL[extension.status] ?? extension.status}
                </span>
                {isAdmin && (
                  <button
                    onClick={() => handleDelete(extension)}
                    disabled={usedBy.length > 0}
                    title={usedBy.length > 0 ? `нельзя удалить: включено в профилях ${usedBy.join(", ")}` : undefined}
                    className="text-[10px] font-['Space_Grotesk'] uppercase text-neutral-300 border border-neutral-700 px-3 py-1.5 enabled:hover:border-danger enabled:hover:text-danger disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Удалить
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="text-xs text-danger font-mono mt-3">{error}</p>}

      <Modal open={installOpen} onClose={() => setInstallOpen(false)} title="Установить расширение" testId="install-extension-modal">
        <label className="flex flex-col gap-1 mb-3">
          <span className={FIELD_LABEL}>Архив расширения (.tar.gz)</span>
          <input
            type="file"
            accept=".tar.gz,.tgz"
            data-testid="extension-archive"
            className="bg-surface-container border border-neutral-800 px-3 py-2 font-mono text-xs file:mr-3 file:bg-surface-container-high file:border-0 file:px-2 file:py-1 file:text-neutral-300"
            onChange={(e) => setArchive(e.currentTarget.files?.[0] ?? null)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Контрольная сумма SHA-256</span>
          <input className={FIELD_INPUT} value={sha256} onChange={(e) => setSha256(e.currentTarget.value)} data-testid="extension-sha256" />
        </label>
        <div className="text-[10px] text-neutral-600 font-mono mt-3">
          Задача расширения должна входить в задачи движка ({plugin.tasks.join(", ")}); несовместимое расширение не устанавливается.
        </div>
        {installError && (
          <p className="text-xs text-danger font-mono mt-3" data-testid="extension-install-error">
            {installError}
          </p>
        )}
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={() => setInstallOpen(false)} className={GHOST_BUTTON}>
            Отмена
          </button>
          <button onClick={handleInstall} disabled={!archive || !sha256} className={PRIMARY_BUTTON}>
            Установить
          </button>
        </div>
      </Modal>
    </section>
  );
}
