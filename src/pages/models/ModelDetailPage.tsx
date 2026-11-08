import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { orchestratorApi } from "../../api/orchestrator";
import type {
  DownloadRecord,
  ModelDeletionPreview,
  ModelDetailResponse,
  ModelEntity,
  ModelFileDetail,
  Provider,
  RepoSyncReport,
} from "../../api/types";
import { Modal } from "../../components/Modal";
import { ModelCard } from "../../components/ModelCard";
import { type MetaRow, ModelMetaInfo } from "../../components/ModelMetaInfo";
import {
  FIELD_INPUT,
  DANGER_BUTTON,
  GHOST_BUTTON,
  ListCard,
  PageHeader,
} from "../../components/ui";
import { formatBytes } from "../../lib/formatBytes";
import { modelTasks } from "../../lib/modelMeta";

/** reference/model_detail — metadata grid, model's profiles, run history, and
 * the deletion modal with the non-destructive preview (path + freed space +
 * dependent-profiles warning, spec: "подтверждающего вызова"). */
export function ModelDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [model, setModel] = useState<ModelEntity | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [preview, setPreview] = useState<ModelDeletionPreview | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardDetail, setCardDetail] = useState<ModelDetailResponse | null>(null);
  // Взведён с первого кадра: до ответа карточка показывает спиннер, а не
  // «нет данных» — запрос деталей стартует только после записи модели.
  const [cardLoading, setCardLoading] = useState(true);
  // Номер попытки: «Повторить» после ошибки перезапускает загрузку деталей.
  const [cardAttempt, setCardAttempt] = useState(0);
  // Расхождение считается живьём на каждое открытие карточки: листинг тут
  // и так делается, поэтому кнопки включаются сразу, без требования
  // «сначала нажмите проверить».
  // `undefined` — сверка ещё идёт, `null` — не удалась.
  const [sync, setSync] = useState<RepoSyncReport | null | undefined>(undefined);
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [updateConfirmOpen, setUpdateConfirmOpen] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [syncChecking, setSyncChecking] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  // Ручное исправление негодной записи: три действия — указать путь,
  // скачать заново, снять запись. Снятие файлов не удаляет.
  const [repairPath, setRepairPath] = useState("");
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [repairMessage, setRepairMessage] = useState<string | null>(null);

  async function applyNewFilePath() {
    if (!model) return;
    setRepairError(null);
    setRepairMessage(null);
    setRepairBusy(true);
    try {
      setModel(await orchestratorApi.setModelFilePath(model.id, repairPath.trim()));
      setRepairPath("");
      setRepairMessage("путь исправлен, метаданные перечитаны");
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : "Не удалось изменить путь");
    } finally {
      setRepairBusy(false);
    }
  }

  async function restoreByDownload() {
    if (!model) return;
    setRepairError(null);
    setRepairMessage(null);
    setRepairBusy(true);
    try {
      await orchestratorApi.restoreModel(model.id);
      setRepairMessage("задача восстановления поставлена в начало очереди");
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : "Не удалось запустить восстановление");
    } finally {
      setRepairBusy(false);
    }
  }

  async function detachRecord() {
    if (!model) return;
    setRepairError(null);
    setRepairBusy(true);
    try {
      await orchestratorApi.detachModel(model.id);
      navigate("/models/downloaded");
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : "Не удалось снять запись");
    } finally {
      setRepairBusy(false);
    }
  }

  /** Состояние показывается изменённым только после успешного ответа:
   * иначе звёздочка утверждала бы то, чего в базе нет. */
  async function toggleFavorite(next: boolean) {
    if (!model) return;
    setFavoriteError(null);
    setFavoriteBusy(true);
    try {
      setModel(await orchestratorApi.setModelFavorite(model.id, next));
    } catch {
      setFavoriteError("Не удалось изменить избранное");
    } finally {
      setFavoriteBusy(false);
    }
  }

  // The shared model card on top of the page — details come from the same
  // getModelDetail endpoint used in search. If it fails (local provider, or
  // the repo no longer resolves), the card shows "unavailable" and the rest
  // of the page keeps working (extract-model-card-component).
  useEffect(() => {
    if (!model) return;
    let cancelled = false;
    (async () => {
      setCardLoading(true);
      try {
        const [detail, tasks] = await Promise.all([
          orchestratorApi.getModelDetail(model.provider_id, model.ref),
          orchestratorApi.listDownloads().catch(() => [] as DownloadRecord[]),
        ]);
        if (!cancelled) {
          setCardDetail(detail);
          setDownloads(tasks);
        }
      } catch {
        if (!cancelled) setCardDetail(null);
      } finally {
        if (!cancelled) setCardLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [model, cardAttempt]);

  const retryCard = () => {
    setCardAttempt((attempt) => attempt + 1);
    if (model) reloadSync(model);
  };

  const reloadCard = async (current: ModelEntity) => {
    const [detail, tasks] = await Promise.all([
      orchestratorApi.getModelDetail(current.provider_id, current.ref).catch(() => null),
      orchestratorApi.listDownloads().catch(() => [] as DownloadRecord[]),
    ]);
    setCardDetail(detail);
    setDownloads(tasks);
  };

  /** «Скачать» у суммарного объёма или у файла: недостающие файлы
   * скачанной модели (например добавленные в репозитории). */
  const downloadFiles = async (files: ModelFileDetail[]) => {
    if (!model) return;
    setUpdateMessage(null);
    setUpdateBusy(true);
    try {
      await orchestratorApi.createDownload({
        provider_id: model.provider_id,
        model_ref: model.ref,
        variant_label: "",
        files: files.map(({ filename, size }) => ({ filename, size })),
      });
      setUpdateMessage("закачка поставлена в очередь");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось начать загрузку");
    } finally {
      await reloadCard(model);
      setUpdateBusy(false);
    }
  };

  const reloadSync = async (current: ModelEntity) => {
    try {
      setSync(await orchestratorApi.getRepoSync(current.provider_id, current.ref));
    } catch {
      setSync(null);
    }
  };

  /** Проверка этой одной модели: перечитывает расхождение и, на стороне
   * оркестратора, обновляет сохранённое состояние — чтобы пометка в
   * разделе «Скачанные модели» совпадала с показанным здесь. */
  const checkThisModel = async () => {
    if (!model) return;
    setSyncError(null);
    setSyncChecking(true);
    try {
      setSync(await orchestratorApi.getRepoSync(model.provider_id, model.ref));
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Не удалось проверить обновления");
    } finally {
      setSyncChecking(false);
    }
  };

  const runUpdate = async (deleteExtra: boolean) => {
    if (!model) return;
    setUpdateConfirmOpen(false);
    setUpdateMessage(null);
    setUpdateBusy(true);
    try {
      const result = await orchestratorApi.updateRepo(model.provider_id, model.ref, deleteExtra);
      const parts = [];
      if (result.started) parts.push("закачка обновления поставлена в очередь");
      if (result.deleted.length > 0) parts.push(`удалено лишних: ${result.deleted.length}`);
      if (result.kept_extra.length > 0) parts.push(`лишние оставлены: ${result.kept_extra.length}`);
      if (parts.length === 0) parts.push("копия уже полная — обновлять нечего");
      setUpdateMessage(parts.join("; "));
      await reloadSync(model);
      await reloadCard(model);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обновить модель");
    } finally {
      setUpdateBusy(false);
    }
  };

  const runFileUpdate = async (filename: string) => {
    if (!model) return;
    setUpdateMessage(null);
    setUpdateBusy(true);
    try {
      const result = await orchestratorApi.updateRepoFile(model.provider_id, model.ref, filename);
      setUpdateMessage(
        result.started ? `закачка обновления ${filename} поставлена в очередь` : `${filename} уже совпадает`
      );
      await reloadSync(model);
      await reloadCard(model);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обновить файл");
    } finally {
      setUpdateBusy(false);
    }
  };

  // Сверка грузится отдельно от деталей: её недоступность (локальный
  // provider, закрытый репозиторий) не должна гасить карточку модели.
  useEffect(() => {
    if (!model) return;
    let cancelled = false;
    (async () => {
      try {
        const report = await orchestratorApi.getRepoSync(model.provider_id, model.ref);
        if (!cancelled) setSync(report);
      } catch {
        if (!cancelled) setSync(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [model]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const [modelData, providerList] = await Promise.all([
          orchestratorApi.getModel(Number(id)),
          orchestratorApi.listProviders(),
        ]);
        setModel(modelData);
        setProviders(providerList);
      } catch {
        setError("Не удалось загрузить модель");
      }
    })();
  }, [id]);

  async function openDeleteModal() {
    if (!id) return;
    try {
      setPreview(await orchestratorApi.getModelDeletionPreview(Number(id)));
      setModalOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Модель нельзя удалить");
    }
  }

  async function confirmDelete() {
    if (!id) return;
    try {
      await orchestratorApi.deleteModel(Number(id));
      navigate("/models/downloaded");
    } catch (err) {
      setModalOpen(false);
      setError(err instanceof Error ? err.message : "Не удалось удалить модель");
    }
  }

  if (!model) return <p className="py-8 text-sm text-neutral-500 font-mono">{error ?? "Загрузка…"}</p>;

  const providerName = providers.find((p) => p.id === model.provider_id)?.name ?? "";
  const tasks = modelTasks(downloads, model.provider_id, model.ref);
  // Сведения записи и файлы на диске — часть раздела «Метаданные»:
  // отдельного раздела метаданных у страницы нет.
  const recordRows: MetaRow[] = [
    ["provider", providerName],
    ["формат", model.format],
    ["задача", model.pipeline_tag ?? "—"],
    ...(["architecture", "dtype", "block_count", "context_length"] as const)
      .filter((key) => model.metadata[key] !== undefined && model.metadata[key] !== null)
      .map((key): MetaRow => [key, String(model.metadata[key])]),
  ];
  const diskRows: MetaRow[] = cardDetail
    ? [
        ["на диске", formatBytes(cardDetail.local_bytes)],
        [
          "файлов",
          `${cardDetail.files.filter((file) => file.downloaded).length} из ${cardDetail.files.length}` +
            (sync && sync.extra_count > 0 ? ` · лишних ${sync.extra_count}` : ""),
        ],
        ["путь", <span className="text-neutral-400 break-all">{model.file_path}</span>],
      ]
    : [["путь", <span className="text-neutral-400 break-all">{model.file_path}</span>]];

  return (
    <div>
      <PageHeader backTo="/models/downloaded" backLabel="Модели" title={model.ref}>
        <button onClick={openDeleteModal} className={DANGER_BUTTON}>
          <span className="material-symbols-outlined text-lg">delete</span> Удалить вместе с файлами
        </button>
      </PageHeader>

      {error && <p className="text-xs text-danger font-mono mb-4">{error}</p>}

      {!model.validity.usable && (
        <section className="border border-danger p-4 mb-4" data-testid="model-repair">
          <p className="text-xs text-danger font-mono mb-3">
            Запись негодна: {model.validity.reason} ({model.file_path})
          </p>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <input
              className={`${FIELD_INPUT} flex-grow min-w-[16rem]`}
              placeholder="Новый путь к файлу модели"
              data-testid="repair-path-input"
              value={repairPath}
              onChange={(event) => setRepairPath(event.currentTarget.value)}
            />
            <button
              type="button"
              data-testid="repair-apply-path"
              disabled={repairBusy || repairPath.trim() === ""}
              onClick={applyNewFilePath}
              className="px-3 py-2 border border-neutral-700 text-neutral-300 font-['Space_Grotesk'] text-[10px] font-bold uppercase enabled:hover:border-primary enabled:hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Указать путь
            </button>
            <button
              type="button"
              data-testid="repair-redownload"
              disabled={repairBusy}
              onClick={restoreByDownload}
              className="px-3 py-2 border border-neutral-700 text-neutral-300 font-['Space_Grotesk'] text-[10px] font-bold uppercase enabled:hover:border-primary enabled:hover:text-primary disabled:opacity-40"
            >
              Скачать заново
            </button>
            <button
              type="button"
              data-testid="repair-detach"
              disabled={repairBusy}
              title="Запись исчезнет из списка, файлы на диске останутся"
              onClick={detachRecord}
              className="px-3 py-2 border border-neutral-700 text-neutral-400 font-['Space_Grotesk'] text-[10px] font-bold uppercase enabled:hover:border-danger enabled:hover:text-danger disabled:opacity-40"
            >
              Снять запись
            </button>
          </div>
          {repairError && (
            <p className="text-xs text-danger font-mono" data-testid="repair-error">
              {repairError}
            </p>
          )}
          {repairMessage && (
            <p className="text-xs text-primary font-mono" data-testid="repair-message">
              {repairMessage}
            </p>
          )}
        </section>
      )}

      <ModelMetaInfo
        detail={cardDetail}
        loading={cardLoading}
        tasks={tasks}
        sync={sync}
        recordRows={recordRows}
        diskRows={diskRows}
        onRetry={retryCard}
      />

      <ModelCard
        detail={cardDetail}
        loading={cardLoading}
        tasks={tasks}
        sync={sync}
        showSyncColumn
        busy={updateBusy}
        onDownloadFiles={downloadFiles}
        onUpdateFile={runFileUpdate}
        onRetry={retryCard}
        favorite={model.favorite}
        onToggleFavorite={toggleFavorite}
        favoriteBusy={favoriteBusy}
        favoriteError={favoriteError}
        headerAction={
          <span className="flex items-center gap-2">
          <button
            type="button"
            data-testid="check-this-model"
            onClick={checkThisModel}
            disabled={syncChecking}
            className="px-3 py-1 border border-neutral-700 text-neutral-300 font-['Space_Grotesk'] text-[10px] font-bold uppercase enabled:hover:border-primary enabled:hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {syncChecking ? "Проверка…" : "Проверить обновления"}
          </button>
          <button
            type="button"
            data-testid="update-all"
            onClick={() => (sync && sync.extra_count > 0 ? setUpdateConfirmOpen(true) : runUpdate(false))}
            disabled={!sync?.has_updates || updateBusy}
            title={
              sync?.has_updates
                ? undefined
                : "Расхождения с репозиторием нет — обновлять нечего"
            }
            className="px-3 py-1 border border-neutral-700 text-neutral-300 font-['Space_Grotesk'] text-[10px] font-bold uppercase enabled:hover:border-primary enabled:hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {updateBusy ? "Обновление…" : "Обновить всё"}
          </button>
          </span>
        }
      />

      {syncError && (
        <p className="text-xs text-danger font-mono mb-4" data-testid="sync-error">
          {syncError}
        </p>
      )}

      {updateMessage && (
        <p className="text-xs text-primary font-mono mb-4" data-testid="update-message">
          {updateMessage}
        </p>
      )}

      <Modal
        open={updateConfirmOpen}
        onClose={() => setUpdateConfirmOpen(false)}
        title="Удалить лишние файлы"
        tone="danger"
        testId="update-confirm"
      >
        <p className="text-xs text-neutral-300 mb-3">
          Этих файлов нет в репозитории. Обновление до полной копии удалит их с диска:
        </p>
        <ul className="text-[11px] font-mono text-neutral-400 mb-4 max-h-40 overflow-auto">
          {(sync?.files ?? [])
            .filter((entry) => entry.state === "extra")
            .map((entry) => (
              <li key={entry.filename}>
                {entry.filename} — {formatBytes(entry.local_size)}
              </li>
            ))}
        </ul>
        <div className="flex gap-3">
          <button
            type="button"
            data-testid="update-confirm-delete"
            onClick={() => runUpdate(true)}
            className="flex-1 py-2 bg-danger/20 border border-danger/50 text-danger font-['Space_Grotesk'] text-xs font-bold uppercase hover:bg-danger hover:text-black"
          >
            Удалить и обновить
          </button>
          <button
            type="button"
            data-testid="update-confirm-keep"
            onClick={() => runUpdate(false)}
            className="flex-1 py-2 border border-neutral-700 text-neutral-300 font-['Space_Grotesk'] text-xs font-bold uppercase hover:border-primary hover:text-primary"
          >
            Оставить лишние
          </button>
        </div>
      </Modal>


      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Удалить модель вместе с файлами?" tone="danger" testId="delete-model-modal">
        <div className="text-xs text-neutral-300 mb-3">
          Будут безвозвратно удалены файлы модели <span className="font-mono text-neutral-100">{model.ref}</span>:
        </div>
        {preview && (
          <div className="grid grid-cols-[140px_1fr] gap-y-1 text-[11px] font-mono bg-surface-container p-3 mb-4">
            <div className="text-neutral-500 uppercase">Путь</div>
            <div className="text-neutral-300 break-all">{preview.file_path}</div>
            <div className="text-neutral-500 uppercase">Освободится</div>
            <div className="text-primary font-bold">{formatBytes(preview.size_bytes)}</div>
          </div>
        )}
        <div className="text-[10px] text-warn font-mono mb-5">⚠ Профили и inferences, ссылающиеся на модель, тоже станут недействительны.</div>
        <div className="flex justify-end gap-3">
          <button onClick={() => setModalOpen(false)} className={GHOST_BUTTON}>
            Отмена
          </button>
          <button onClick={confirmDelete} className="px-4 py-2 bg-danger text-black font-['Space_Grotesk'] text-xs font-bold uppercase">
            Удалить безвозвратно
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** Small inline list reused by provider/engine/plugin detail pages. */
export function RefList({ items }: { items: { label: string; hint?: string; to?: string }[] }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <ListCard key={item.label} accent="primary" title={item.label} meta={item.hint} to={item.to} />
      ))}
    </div>
  );
}
