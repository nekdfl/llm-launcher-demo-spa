import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { orchestratorApi } from "../../api/orchestrator";
import type { DownloadRecord, RepoSyncState } from "../../api/types";
import { DownloadStatsPanel } from "../../components/DownloadStatsPanel";
import { ModelTile } from "../../components/ModelTile";
import { ModelsQuickSwitch } from "../../components/ModelsQuickSwitch";
import { PageHeader, type AccentTone } from "../../components/ui";
import { formatBytes } from "../../lib/formatBytes";

// Опрос хода проверки — того же порядка, что остальные опросы интерфейса.
const CHECK_POLL_INTERVAL_MS = 1500;

/** reference/model_list — hub with two big category cards (UI-BEHAVIOR §7:
 * "Загрузка" и "Скачанные" — разные экраны, разные задачи). */
/** Три состояния, а не два: модель с расхождением, непроверенная и та,
 * которую проверить не удалось. Показывать непроверенную как совпадающую
 * с репозиторием нельзя — это утверждение, которого никто не проверял. */
function syncBadge(state: RepoSyncState | undefined): { tone: "primary" | "warn" | "danger"; label: string } {
  if (state?.checking) return { tone: "warn", label: "проверка обновлений" };
  if (!state || state.checked_at === null) return { tone: "warn", label: "не проверялась" };
  if (state.check_error) return { tone: "danger", label: "проверить не удалось" };
  if (state.has_updates) return { tone: "warn", label: "есть обновления" };
  return { tone: "primary", label: state.content_verified ? "совпадает" : "совпадает по размеру" };
}

/** reference/model_downloaded — models already on disk, grouped by provider. */
export function DownloadedModelsPage() {
  const [models, setModels] = useState<Awaited<ReturnType<typeof orchestratorApi.listModels>> | null>(null);
  const [providers, setProviders] = useState<Awaited<ReturnType<typeof orchestratorApi.listProviders>> | null>(null);
  const [syncStates, setSyncStates] = useState<RepoSyncState[]>([]);
  const [checking, setChecking] = useState(false);
  const [updatingRef, setUpdatingRef] = useState<string | null>(null);
  const [tileMessages, setTileMessages] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [modelList, providerList] = await Promise.all([
          orchestratorApi.listModels(),
          orchestratorApi.listProviders(),
        ]);
        setModels(modelList);
        setProviders(providerList);
      } catch {
        setError("Не удалось загрузить модели");
      }
    })();
  }, []);

  // Состояния проверки грузятся отдельно: сверка зависит от сети и
  // provider'а, и её недоступность (а равно оркестратор без этого
  // маршрута) не должна гасить список моделей — он сам по себе в порядке.
  useEffect(() => {
    (async () => {
      try {
        setSyncStates(await orchestratorApi.listRepoSyncStates());
      } catch {
        setSyncStates([]);
      }
    })();
  }, []);

  // Кнопка недоступна, пока хоть одна модель проверяется: одна правда о
  // том, идёт ли проверка — те же состояния, что рисуют спиннеры.
  const anyChecking = syncStates.some((state) => state.checking);

  const handleCheckUpdates = async () => {
    setError(null);
    setChecking(true);
    try {
      const result = await orchestratorApi.checkModelUpdates();
      setSyncStates(result.states);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось проверить обновления");
    } finally {
      setChecking(false);
    }
  };

  // Опрос идёт только пока есть проверяемые модели и прекращается сам,
  // когда признак снят у всех: пометки обновляются по мере готовности
  // результатов, а не все сразу в конце обхода.
  useEffect(() => {
    if (!anyChecking) return;
    const timer = setInterval(async () => {
      try {
        setSyncStates(await orchestratorApi.listRepoSyncStates());
      } catch {
        // пропущенный такт опроса — пометки останутся прежними
      }
    }, CHECK_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [anyChecking]);

  /** Обновление всей модели с плитки. Лишние файлы не удаляются: в списке
   * не видно, что именно удалилось бы, а удаление необратимо — оно
   * остаётся действием карточки, где показывается перечень. */
  const handleUpdateModel = async (model: { provider_id: number; ref: string }) => {
    const state = syncStates.find((s) => s.provider_id === model.provider_id && s.model_ref === model.ref);
    setError(null);
    setUpdatingRef(model.ref);
    try {
      const result = await orchestratorApi.updateRepo(model.provider_id, model.ref, false);
      const parts: string[] = [];
      parts.push(result.started ? "обновление поставлено в очередь" : "копия уже полная");
      if (result.kept_extra.length > 0 || (state?.extra_count ?? 0) > 0) {
        const count = result.kept_extra.length || state?.extra_count || 0;
        parts.push(`лишних файлов оставлено: ${count} — удалить можно в карточке модели`);
      }
      setTileMessages((previous) => ({ ...previous, [model.ref]: parts.join("; ") }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось запустить обновление");
    } finally {
      setUpdatingRef(null);
    }
  };

  const stateFor = (model: { provider_id: number; ref: string }) =>
    syncStates.find((state) => state.provider_id === model.provider_id && state.model_ref === model.ref);

  const lastCheckedAt = syncStates.reduce<string | null>(
    (latest, state) =>
      state.checked_at !== null && (latest === null || state.checked_at > latest) ? state.checked_at : latest,
    null
  );

  /** Плитка — репозиторий, а не запись: записи создаются на каждый квант,
   * и плитка на запись давала четыре плитки с одним названием. Внутри
   * группы различаются кванты — они и показываются строкой вариантов. */
  const repoGroups = (models ?? []).reduce<
    { key: string; provider_id: number; ref: string; entries: typeof models }[]
  >((groups, model) => {
    const key = `${model.provider_id}:${model.ref}`;
    const existing = groups.find((group) => group.key === key);
    if (existing) {
      existing.entries!.push(model);
      return groups;
    }
    groups.push({ key, provider_id: model.provider_id, ref: model.ref, entries: [model] });
    return groups;
  }, []);

  return (
    <div>
      <PageHeader title="Скачанные модели">
        <button
          type="button"
          data-testid="check-updates"
          onClick={handleCheckUpdates}
          disabled={checking || anyChecking}
          className="flex items-center gap-2 border border-neutral-700 text-neutral-300 font-['Space_Grotesk'] text-xs font-bold uppercase tracking-widest px-5 py-3 enabled:hover:border-primary enabled:hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className={`material-symbols-outlined text-lg ${checking || anyChecking ? "animate-spin" : ""}`}>
            sync
          </span>
          {checking || anyChecking ? "Проверка…" : "Проверить обновления"}
        </button>
      </PageHeader>

      {lastCheckedAt && (
        <p className="text-[10px] font-mono text-neutral-600 mb-4" data-testid="last-checked-at">
          последняя проверка: {new Date(`${lastCheckedAt}Z`).toLocaleString("ru-RU")}
        </p>
      )}

      <DownloadStatsPanel />
      <ModelsQuickSwitch />

      {error && <p className="text-xs text-danger font-mono">{error}</p>}
      {models && providers && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {repoGroups.map((group) => {
            const provider = providers.find((p) => p.id === group.provider_id);
            const state = stateFor(group);
            const badge = syncBadge(state);
            const unusable = group.entries!.some((model) => !model.validity.usable);
            const accent: AccentTone = unusable
              ? "danger"
              : state?.has_updates && !state.checking
                ? "warn"
                : "primary";
            // Переход — карточка записи-представителя группы: маршрут
            // карточки пока по `id`, и вести нужно в одну определённую
            // запись, а не в произвольную.
            const representative = group.entries!.reduce((lowest, model) => (model.id < lowest.id ? model : lowest));
            const quants = group.entries!
              .map((model) => String(model.metadata?.quantization ?? ""))
              .filter((label) => label.length > 0);
            return (
              <ModelTile
                key={group.key}
                repoId={group.ref}
                to={`/models/${representative.id}`}
                accent={accent}
                quants={quants}
                // Плитка — репозиторий, а записей у него несколько:
                // избранной достаточно одной, чтобы репозиторий был
                // помечен и шёл первым.
                favorite={group.entries!.some((model) => model.favorite)}
                // Негодна хотя бы одна запись — это видно на плитке
                // репозитория, а чинится в карточке конкретной записи.
                unusableReason={
                  group.entries!.find((model) => !model.validity.usable)?.validity.reason ?? null
                }
                testId={`model-tile-${representative.id}`}
                icons={
                  <>
                    {state?.checking && (
                      <span
                        className="material-symbols-outlined text-warn text-base animate-spin"
                        data-testid={`checking-${representative.id}`}
                        title="проверка обновлений"
                      >
                        progress_activity
                      </span>
                    )}
                    {!state?.checking && state?.has_updates && !state.check_error && (
                      <span
                        className="material-symbols-outlined text-warn text-base"
                        data-testid={`has-updates-${representative.id}`}
                        title={`есть обновления: отсутствует ${state.missing_count}, изменено ${state.changed_count}, лишних ${state.extra_count}`}
                      >
                        sync_problem
                      </span>
                    )}
                    {!state?.checking && state?.check_error && (
                      <span
                        className="material-symbols-outlined text-danger text-base"
                        data-testid={`check-failed-${representative.id}`}
                        title={state.check_error}
                      >
                        error
                      </span>
                    )}
                  </>
                }
                meta={
                  <>
                    {representative.format} · {provider?.name ?? "unknown"}
                    {group.entries!.length > 1 && ` · вариантов: ${group.entries!.length}`}
                    {tileMessages[group.ref] && (
                      <span className="block text-primary mt-1" data-testid={`update-message-${representative.id}`}>
                        {tileMessages[group.ref]}
                      </span>
                    )}
                  </>
                }
                badge={badge ? { tone: badge.tone, label: badge.label } : undefined}
                action={
                  state?.has_updates && !state.checking && !state.check_error ? (
                    <button
                      type="button"
                      data-testid={`update-model-${representative.id}`}
                      onClick={() => handleUpdateModel(group)}
                      disabled={updatingRef === group.ref}
                      className="px-3 py-1 border border-neutral-700 text-neutral-300 font-['Space_Grotesk'] text-[10px] font-bold uppercase enabled:hover:border-primary enabled:hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {updatingRef === group.ref ? "Обновление…" : "Обновить"}
                    </button>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}
      {models && models.length === 0 && <p className="text-sm text-neutral-500 font-mono">Нет скачанных моделей.</p>}
    </div>
  );
}

export function formatSize(bytes: number | null): string {
  return formatBytes(bytes);
}
