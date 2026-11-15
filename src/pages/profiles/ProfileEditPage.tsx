import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { orchestratorApi } from "../../api/orchestrator";
import { ArgvEditor } from "../../components/ArgvEditor";
import { PluginStampFields } from "../../components/PluginStampFields";
import { EngineBadge } from "../../components/EngineBadge";
import { EntityLink } from "../../components/EntityLink";
import { GpuChecklist, toggleGpuId, useGpuChecklistItems } from "../../components/GpuChecklist";
import { LaunchCommandField } from "../../components/LaunchCommandField";
import { groupModelsByRepo, modelOptionLabel } from "../../lib/modelOptionLabel";
import { AssistantHintsSection } from "./AssistantHintsSection";
import { ProfileExtensionsSection } from "./ProfileExtensionsSection";
import { SchemaField } from "../../components/SchemaField";
import type { FieldDescriptor } from "../../api/orchestrator";
import { apiErrorField, apiErrorMessage } from "../../api/client";
import type {
  ExtensionSelection,
  Inference,
  ModelEntity,
  Profile,
  ProfileFormulaSuggestion,
  PluginRecord,
} from "../../api/types";
import { Modal } from "../../components/Modal";
import { FIELD_HINT, FIELD_INPUT, FIELD_LABEL, GHOST_BUTTON, PRIMARY_BUTTON, PageHeader, SECTION_CARD, SECTION_TITLE } from "../../components/ui";

const CLI_HINT = "-m, --alias, --host и --port ядро подставляет само из модели, названия профиля и поля «Порт» выше — остальное передаётся в argv как записано.";

interface ProfileFormState {
  name: string;
  modelId: string;
  pluginId: string;
  gpuIds: string;
  port: string;
  cliOptions: string;
  systemPrompt: string;
}

const EMPTY_FORM: ProfileFormState = {
  name: "",
  modelId: "",
  pluginId: "",
  gpuIds: "",
  port: "",
  cliOptions: "",
  systemPrompt: "",
};

/** Replaces (or appends) a flag's value in the free-form cli options text —
 * the single-suggestion apply path: one click changes exactly one thing. */
function replaceFlag(form: ProfileFormState, flag: string, value: string): ProfileFormState {
  const pattern = new RegExp(`(^|\\s)${flag.replace("-", "\\-")}\\s+\\S+`, "i");
  if (pattern.test(form.cliOptions)) {
    return { ...form, cliOptions: form.cliOptions.replace(pattern, `$1${flag} ${value}`) };
  }
  return { ...form, cliOptions: appendCliOption(form.cliOptions, `${flag} ${value}`) };
}

function appendCliOption(current: string, addition: string): string {
  const trimmed = current.trimEnd();
  return trimmed ? `${trimmed}\n${addition}` : addition;
}

function toForm(profile: Profile): ProfileFormState {
  return {
    name: profile.name,
    modelId: String(profile.model_id),
    pluginId: String(profile.plugin_id),
    gpuIds: profile.gpu_ids.join(","),
    port: profile.port === null ? "" : String(profile.port),
    cliOptions: profile.cli_options,
    systemPrompt: profile.system_prompt,
  };
}

/** Create and edit share one form component (reference/profile_create,
 * reference/profile_edit): «Источник» + «Параметры запуска» sections, the
 * formula pre-fill for cli_options, the «Сохранить как» copy modal on edit,
 * and the LLM-assistant hints section (llm-profile-assistant — applied per
 * suggestion by click; its unavailability never blocks saving). */
export function ProfileEditPage({ mode }: { mode: "create" | "edit" }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = mode === "edit";

  const [models, setModels] = useState<ModelEntity[]>([]);
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  const [referencingInferences, setReferencingInferences] = useState<Inference[]>([]);
  const [form, setForm] = useState<ProfileFormState>(EMPTY_FORM);
  const [loadedProfile, setLoadedProfile] = useState<Profile | null>(null);
  const [formula, setFormula] = useState<ProfileFormulaSuggestion | null>(null);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [saveAsError, setSaveAsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extensions, setExtensions] = useState<ExtensionSelection>({});
  const [structural, setStructural] = useState<Record<string, unknown>>({});
  const [profileSchema, setProfileSchema] = useState<FieldDescriptor[]>([]);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  /** Field name → form key mapping for assistant suggestions. The assistant
   * proposes llama.cpp-style flags; suggestions that don't map to a form
   * field are applied into cli_options as extra text (the free passthrough
   * field, UI-BEHAVIOR §4). */
  function applySuggestion(field: string, value: string) {
    setForm((f) => {
      if (field === "ctx-size" || field === "--ctx-size") {
        return replaceFlag(f, "--ctx-size", value);
      }
      if (field === "ngl" || field === "n-gpu-layers" || field === "--n-gpu-layers" || field === "gpu-layers") {
        return replaceFlag(f, "-ngl", value);
      }
      return { ...f, cliOptions: appendCliOption(f.cliOptions, `--${field.replace(/^-+/, "")} ${value}`) };
    });
  }

  useEffect(() => {
    (async () => {
      try {
        const [modelList, pluginList] = await Promise.all([orchestratorApi.listModels(), orchestratorApi.listPlugins()]);
        setModels(modelList);
        // Only engine-type plugins define a profile schema — provider plugins
        // don't accept a profile (domain model, DESIGN.md §4).
        setPlugins(pluginList.filter((p) => p.plugin_type === "engine"));
        if (isEdit && id) {
          const [profile, inferences] = await Promise.all([
            orchestratorApi.getProfile(Number(id)),
            orchestratorApi.listInferences(),
          ]);
          setForm(toForm(profile));
          setLoadedProfile(profile);
          setExtensions(profile.extensions);
          setStructural(profile.structural_fields ?? {});
          setReferencingInferences(inferences.filter((inf) => inf.profile_id === Number(id)));
        }
      } catch {
        setError("Не удалось загрузить данные");
      } finally {
        setLoading(false);
      }
    })();
  }, [isEdit, id]);

  const selectedModel = models.find((m) => String(m.id) === form.modelId);
  // Подбор движка по модели (model-task-matching): формат среди форматов
  // плагина и задача модели, если известна, среди задач плагина.
  const suitablePlugins = selectedModel
    ? plugins.filter(
        (p) =>
          (p.model_formats ?? []).includes(selectedModel.format) &&
          (!selectedModel.pipeline_tag || (p.tasks ?? []).includes(selectedModel.pipeline_tag))
      )
    : plugins;

  useEffect(() => {
    if (!form.pluginId) {
      setProfileSchema([]);
      return;
    }
    let cancelled = false;
    Promise.resolve()
      .then(() => orchestratorApi.getPluginSchema(Number(form.pluginId)))
      .then((schema) => {
        if (!cancelled) setProfileSchema(schema?.profile_schema ?? []);
      })
      .catch(() => {
        if (!cancelled) setProfileSchema([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.pluginId]);
  const gpuIdList = useMemo(
    () =>
      form.gpuIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number),
    [form.gpuIds]
  );

  async function applyFormula() {
    if (!selectedModel) return;
    try {
      const suggestion = await orchestratorApi.getProfileFormula(selectedModel.id, gpuIdList);
      setFormula(suggestion);
      setForm((f) => ({ ...f, cliOptions: suggestion.cli_options }));
    } catch {
      setError("Формула недоступна для этой модели");
    }
  }

  async function handleSubmit() {
    setError(null);
    const payload = {
      name: form.name,
      model_id: Number(form.modelId),
      plugin_id: Number(form.pluginId),
      plugin_version: plugins.find((p) => String(p.id) === form.pluginId)?.plugin_version ?? "",
      schema_fields: [],
      gpu_ids: gpuIdList,
      port: form.port === "" ? null : Number(form.port),
      structural_fields: structural,
      cli_options: form.cliOptions,
      system_prompt: form.systemPrompt,
      extensions,
    };
    setFieldError(null);
    try {
      if (isEdit && id) {
        await orchestratorApi.updateProfile?.(Number(id), payload);
      } else {
        await orchestratorApi.createProfile(payload);
      }
      setSaved(true);
      navigate("/profiles");
    } catch (err) {
      const message = apiErrorMessage(err, err instanceof Error ? err.message : "Не удалось сохранить профиль");
      const field = apiErrorField(err);
      // Ошибка опции расширения показывается у поля; введённое не теряется.
      if (field && field.startsWith("extensions")) setFieldError({ field, message });
      else setError(message);
    }
  }

  async function handleSaveAs() {
    setSaveAsError(null);
    try {
      const profiles = await orchestratorApi.listProfiles();
      if (profiles.some((p) => p.name === saveAsName.trim())) {
        setSaveAsError("Профиль с таким именем уже существует");
        return;
      }
      if (!id) return;
      await orchestratorApi.copyProfile(Number(id), saveAsName.trim());
      setSaveAsOpen(false);
      navigate(`/profiles`);
    } catch (err) {
      setSaveAsError(err instanceof Error ? err.message : "Не удалось скопировать профиль");
    }
  }

  async function handleDelete() {
    if (!id) return;
    setError(null);
    try {
      await orchestratorApi.deleteProfile(Number(id));
      navigate("/profiles");
    } catch (err) {
      setError(err instanceof Error ? err.message : "нельзя удалить профиль: есть ссылающиеся inferences");
    }
  }

  const gpuPicker = useGpuChecklistItems(gpuIdList);
  // Драйвер — поле схемы плагина (сейчас только у llama.cpp): показывается
  // в «Параметры запуска», а не среди прочих полей движка.
  const driverField = profileSchema.find((field) => field.name === "driver") ?? null;
  const engineFields = profileSchema.filter((field) => field.name !== "driver");
  const renderSchemaField = (field: FieldDescriptor) => (
    <SchemaField
      key={field.name}
      field={field}
      value={structural[field.name] ?? field.default ?? ""}
      testId={`profile-field-${field.name}`}
      onChange={(value) => setStructural((current) => ({ ...current, [field.name]: value }))}
    />
  );

  if (loading) return <p className="py-8 text-sm text-neutral-500 font-mono">Загрузка…</p>;

  return (
    <div>
      <PageHeader backTo="/profiles" backLabel="Профили" title={isEdit ? "Редактирование профиля" : "Создание профиля"} />

      <section className={SECTION_CARD}>
        <h2 className={SECTION_TITLE}>Источник</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Название профиля</span>
            <input className={FIELD_INPUT} value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Модель</span>
            <select className={FIELD_INPUT} value={form.modelId} onChange={(e) => setForm({ ...form, modelId: e.currentTarget.value })}>
              <option value="" disabled>Выберите модель</option>
              {/* Варианты репозитория подряд; порядок репозиториев — из
                  ответа оркестратора, избранные первыми. */}
              {groupModelsByRepo(models).map((m) => (
                <option key={m.id} value={m.id}>{modelOptionLabel(m)}</option>
              ))}
            </select>
          </label>
          {/* Выбранная модель — ещё и ссылка: негодность чинится в её
              карточке, и ходить туда через раздел моделей незачем. */}
          <EntityLink
            label="Выбранная модель"
            name={models.find((m) => String(m.id) === form.modelId)?.ref}
            to={form.modelId ? `/models/${form.modelId}` : null}
            missingNote="модель не выбрана"
            testId="profile-model-link"
          />
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Движок (engine-плагин)</span>
            <select
              className={FIELD_INPUT}
              value={form.pluginId}
              onChange={(e) => {
                setForm({ ...form, pluginId: e.currentTarget.value });
                // Расширения и поля схемы принадлежат плагину: выбор другого плагина их сбрасывает.
                setExtensions({});
                setStructural({});
              }}
            >
              <option value="" disabled>Выберите плагин</option>
              {suitablePlugins.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <PluginStampFields
            pluginVersion={loadedProfile?.plugin_version ?? plugins.find((p) => String(p.id) === form.pluginId)?.plugin_version ?? ""}
            schemaHash={loadedProfile?.schema_hash ?? ""}
            needsReview={loadedProfile?.needs_review ?? false}
          />
        </div>
      </section>

      <section className={SECTION_CARD}>
        <h2 className={SECTION_TITLE}>
          Параметры запуска
          <EngineBadge pluginId={form.pluginId ? Number(form.pluginId) : null} />
        </h2>
        <div className="mb-5">
          <span className={FIELD_LABEL}>Карты (по умолчанию)</span>
          <div className="mt-2">
            <GpuChecklist
              items={gpuPicker.items}
              selected={new Set(gpuIdList)}
              onToggle={(gpuId) => setForm((f) => ({ ...f, gpuIds: toggleGpuId(gpuIdList, gpuId).join(",") }))}
              nvmlError={gpuPicker.nvmlError}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-5">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Порт (TCP)</span>
            <input className={FIELD_INPUT} value={form.port} onChange={(e) => setForm({ ...form, port: e.currentTarget.value })} />
          </label>
          {driverField && renderSchemaField(driverField)}
        </div>

        <div className="mb-2">
          <ArgvEditor
            value={form.cliOptions}
            onChange={(value) => setForm((f) => ({ ...f, cliOptions: value }))}
            testId="profile-argv"
            label={
              <>
                Опции командной строки
                <span className="text-neutral-700 normal-case font-normal">— стартовое содержимое предложено формулой (§8.1)</span>
              </>
            }
          />
        </div>
        <div className={`${FIELD_HINT} mb-3`}>{CLI_HINT}</div>

        <button onClick={applyFormula} disabled={!selectedModel} className="mb-5 px-4 py-2 border border-neutral-700 text-neutral-300 font-['Space_Grotesk'] text-xs font-bold uppercase hover:border-primary hover:text-primary disabled:opacity-40">
          Предложить параметры формулой
        </button>
        {formula && formula.warnings.length > 0 && (
          <div className="text-[10px] text-warn font-mono mb-3">
            {formula.warnings.map((w) => (
              <div key={w}>⚠ {w}</div>
            ))}
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>
            System prompt <span className="text-neutral-700 normal-case font-normal">— вставляется роутером в начало каждого запроса</span>
          </span>
          <textarea
            className={`${FIELD_INPUT} h-20`}
            value={form.systemPrompt}
            onChange={(e) => setForm({ ...form, systemPrompt: e.currentTarget.value })}
          />
        </label>

        <div className="mt-5">
          <LaunchCommandField
            label="Команда запуска"
            hint="имя inference и порт подставляются при создании inference"
            input={
              form.modelId && form.pluginId
                ? {
                    plugin_id: Number(form.pluginId),
                    model_id: Number(form.modelId),
                    port: form.port === "" ? null : Number(form.port),
                    gpu_ids: gpuIdList,
                    structural_fields: structural,
                    cli_options: form.cliOptions,
                  }
                : null
            }
            testId="profile-launch-command"
          />
        </div>
      </section>

      {engineFields.length > 0 && (
        <section className={SECTION_CARD} data-testid="profile-schema-fields">
          <h2 className={SECTION_TITLE}>Параметры движка</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">{engineFields.map(renderSchemaField)}</div>
        </section>
      )}

      <ProfileExtensionsSection
        pluginId={form.pluginId ? Number(form.pluginId) : null}
        value={extensions}
        onChange={setExtensions}
        fieldError={fieldError}
      />

      <AssistantHintsSection modelId={selectedModel ? selectedModel.id : null} onApply={applySuggestion} />

      {error && <p className="text-xs text-danger font-mono mb-4">{error}</p>}

      <div className="flex items-center gap-3">
        <Link to="/profiles" className={GHOST_BUTTON}>
          Отмена
        </Link>
        {isEdit && (
          <button onClick={() => setSaveAsOpen(true)} className={`${GHOST_BUTTON} hover:border-primary hover:text-primary`}>
            Сохранить как
          </button>
        )}
        <button onClick={handleSubmit} className={PRIMARY_BUTTON}>
          {isEdit ? "Сохранить" : "Создать профиль"}
        </button>
        {saved && <span className="text-xs text-primary font-mono">Сохранено</span>}
        {isEdit && (
          <button
            onClick={handleDelete}
            disabled={referencingInferences.length > 0}
            title={
              referencingInferences.length > 0
                ? "нельзя удалить: есть inferences, ссылающиеся на профиль"
                : undefined
            }
            className="ml-auto px-4 py-2 border border-danger/30 text-danger/40 font-['Space_Grotesk'] text-xs font-bold uppercase disabled:cursor-not-allowed enabled:hover:bg-danger enabled:hover:text-black enabled:hover:border-danger"
          >
            Удалить профиль
          </button>
        )}
      </div>

      <Modal open={saveAsOpen} onClose={() => setSaveAsOpen(false)} title="Сохранить как" testId="save-as-modal">
        <label className="flex flex-col gap-1 mb-4">
          <span className={FIELD_LABEL}>Название копии</span>
          <input className={FIELD_INPUT} value={saveAsName} onChange={(e) => setSaveAsName(e.currentTarget.value)} data-testid="save-as-name" />
        </label>
        {saveAsError && <p className="text-xs text-danger font-mono mb-3">{saveAsError}</p>}
        <div className="flex justify-end gap-3">
          <button onClick={() => setSaveAsOpen(false)} className={GHOST_BUTTON}>
            Отмена
          </button>
          <button onClick={handleSaveAs} className={PRIMARY_BUTTON}>
            Создать копию
          </button>
        </div>
      </Modal>
    </div>
  );
}
