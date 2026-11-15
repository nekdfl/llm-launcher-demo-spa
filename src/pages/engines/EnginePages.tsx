import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { orchestratorApi } from "../../api/orchestrator";
import type { FieldDescriptor } from "../../api/orchestrator";
import type { Inference, Profile, PluginRecord } from "../../api/types";
import { FIELD_HINT, FIELD_INPUT, FIELD_LABEL, GHOST_BUTTON, ListCard, PRIMARY_BUTTON, PageHeader, SECTION_CARD, SECTION_TITLE, SMALL_BUTTON, StatusBadge, type AccentTone, type BadgeTone } from "../../components/ui";

/** Renders install_fields as a form from a plugin's install_schema — no
 * engine-specific field name/label is hardcoded here (engine-plugin-vllm:
 * "Форма регистрации рендерится по install-схеме плагина"). Values are
 * kept as strings; what they mean (a binary path, a venv path, ...) is
 * entirely up to the plugin that declared the field. */
function InstallFieldsForm({
  schema,
  values,
  onChange,
}: {
  schema: FieldDescriptor[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  return (
    <>
      {schema.map((field) => (
        <label key={field.name} className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>{field.label}</span>
          {field.type === "choice" ? (
            <select
              className={FIELD_INPUT}
              value={values[field.name] ?? ""}
              onChange={(e) => onChange(field.name, e.currentTarget.value)}
            >
              <option value="" disabled>
                Выберите…
              </option>
              {(field.choices ?? []).map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={FIELD_INPUT}
              value={values[field.name] ?? ""}
              onChange={(e) => onChange(field.name, e.currentTarget.value)}
            />
          )}
          {field.description && <span className={FIELD_HINT}>{field.description}</span>}
        </label>
      ))}
    </>
  );
}

function installFieldsToStrings(installFields: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(installFields).map(([key, value]) => [key, String(value ?? "")]));
}

function schemaIsSatisfied(schema: FieldDescriptor[], values: Record<string, string>): boolean {
  return schema.every((field) => !field.required || (values[field.name] ?? "").trim() !== "");
}

/** reference/engine_manager — варианты движка (engine-плагины) карточками
 * с доступностью и «Проверить», плюс «Новый вариант». */
export function EngineManagerPage() {
  const navigate = useNavigate();
  const [variants, setVariants] = useState<PluginRecord[] | null>(null);

  const load = async () => {
    const list = await orchestratorApi.listPlugins();
    setVariants(list.filter((p) => p.plugin_type === "engine"));
  };

  useEffect(() => {
    load().catch(() => setVariants([]));
  }, []);

  async function recheck(variant: PluginRecord) {
    try {
      await orchestratorApi.recheckPlugin(variant.id);
      await load();
    } catch {
      /* card state refreshes on next visit; recheck errors surface server-side */
    }
  }

  return (
    <div>
      <PageHeader title="Менеджер движков">
        <button onClick={() => navigate("/engines/new")} className={PRIMARY_BUTTON}>
          Новый вариант движка
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(variants ?? []).map((variant) => {
          const badgeTone: BadgeTone = variant.available ? "primary" : "danger";
          return (
            <div
              key={variant.id}
              onClick={() => navigate(`/engines/${variant.id}`)}
              className="bg-surface-container-low p-5 cursor-pointer hover:bg-surface-container"
              style={{ boxShadow: `inset 4px 0 0 0 ${variant.available ? "#3ce36a" : "#ff5c5c"}` }}
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className={`font-['Space_Grotesk'] font-bold text-lg ${variant.available ? "" : "text-neutral-400"}`}>
                    {variant.name}
                  </div>
                  <div className="text-[11px] text-neutral-500 font-mono">
                    plugin v{variant.plugin_version} {variant.engine_version ? `· ${variant.engine_version}` : ""}
                  </div>
                  {!variant.available && variant.unavailable_reason && (
                    <div className="text-[10px] text-danger font-mono mt-1">{variant.unavailable_reason}</div>
                  )}
                </div>
                <StatusBadge tone={badgeTone}>{variant.available ? "доступен" : "недоступен"}</StatusBadge>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  recheck(variant);
                }}
                className={SMALL_BUTTON}
              >
                Проверить
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** reference/engine_install_create — новый вариант движка: образец (его код,
 * схема и расширения), имя и install-поля по install-схеме образца. */
export function EngineVariantCreatePage() {
  const navigate = useNavigate();
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [installSchema, setInstallSchema] = useState<FieldDescriptor[]>([]);
  const [name, setName] = useState("");
  const [installFields, setInstallFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    orchestratorApi
      .listPlugins()
      .then((list) => setPlugins(list.filter((p) => p.plugin_type === "engine")))
      .catch(() => setError("Не удалось загрузить движки"));
  }, []);

  useEffect(() => {
    if (!sourceId) {
      setInstallSchema([]);
      setInstallFields({});
      return;
    }
    orchestratorApi
      .getPluginSchema(Number(sourceId))
      .then((schema) => {
        setInstallSchema(schema.install_schema);
        setInstallFields({});
      })
      .catch(() => setError("Не удалось загрузить схему плагина"));
  }, [sourceId]);

  async function handleSubmit() {
    try {
      const variant = await orchestratorApi.createPluginVariant(Number(sourceId), { name, install_fields: installFields });
      navigate(`/engines/${variant.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать вариант движка");
    }
  }

  const canSubmit = Boolean(sourceId) && Boolean(name) && schemaIsSatisfied(installSchema, installFields);

  return (
    <div>
      <PageHeader backTo="/engines" backLabel="Движки" title="Новый вариант движка" />

      <section className={SECTION_CARD}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>На основе движка</span>
            <select className={FIELD_INPUT} value={sourceId} onChange={(e) => setSourceId(e.currentTarget.value)}>
              <option value="" disabled>
                Выберите движок
              </option>
              {plugins.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Название варианта</span>
            <input className={FIELD_INPUT} placeholder="llama.cpp b4210-cuda" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          </label>
        </div>
        {installSchema.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
            <InstallFieldsForm
              schema={installSchema}
              values={installFields}
              onChange={(field, value) => setInstallFields((prev) => ({ ...prev, [field]: value }))}
            />
          </div>
        )}
        <div className={FIELD_HINT}>
          Вариант берёт код, схему и расширения образца; версия движка определяется командой, объявленной плагином — заодно
          проверка, что путь рабочий (§4.5).
        </div>
      </section>

      {error && <p className="text-xs text-danger font-mono mb-4">{error}</p>}

      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/engines")} className={GHOST_BUTTON}>
          Отмена
        </button>
        <button onClick={handleSubmit} disabled={!canSubmit} className={PRIMARY_BUTTON}>
          Создать вариант
        </button>
      </div>
    </div>
  );
}

/** reference/engine_install_detail — вариант движка с «Проверить» и
 * удалением, заблокированным ссылками (visible reason, UI-BEHAVIOR §6). */
export function EngineVariantDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [variant, setVariant] = useState<PluginRecord | null>(null);
  const [installSchema, setInstallSchema] = useState<FieldDescriptor[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [inferences, setInferences] = useState<Inference[]>([]);
  const [name, setName] = useState("");
  const [installFields, setInstallFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadVariant = async (variantId: number) => {
    const found = (await orchestratorApi.listPlugins()).find((p) => p.id === variantId && p.plugin_type === "engine");
    if (!found) throw new Error("движок не найден");
    return found;
  };

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const [data, profileList, inferenceList, schema] = await Promise.all([
          loadVariant(Number(id)),
          orchestratorApi.listProfiles(),
          orchestratorApi.listInferences(),
          orchestratorApi.getPluginSchema(Number(id)),
        ]);
        setVariant(data);
        setName(data.name);
        setInstallFields(installFieldsToStrings(data.install_fields));
        setProfiles(profileList);
        setInferences(inferenceList);
        setInstallSchema(schema.install_schema);
      } catch {
        setError("Не удалось загрузить движок");
      }
    })();
  }, [id]);

  if (!variant) return <p className="py-8 text-sm text-neutral-500 font-mono">{error ?? "Загрузка…"}</p>;

  const referencingProfiles = profiles.filter((p) => p.plugin_id === variant.id);
  const referencingInferences = inferences.filter((i) => i.plugin_id === variant.id);
  const referenced = referencingProfiles.length + referencingInferences.length > 0;
  const originalInstallFields = installFieldsToStrings(variant.install_fields);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await orchestratorApi.updatePlugin(variant!.id, { name, install_fields: installFields });
      setVariant(updated);
      setName(updated.name);
      setInstallFields(installFieldsToStrings(updated.install_fields));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Не удалось сохранить изменения");
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    name !== variant.name ||
    Object.keys(installFields).some((key) => installFields[key] !== (originalInstallFields[key] ?? ""));
  const canSave = dirty && !saving && Boolean(name) && schemaIsSatisfied(installSchema, installFields);

  return (
    <div>
      <PageHeader backTo="/engines" backLabel="Движки" title={variant.name}>
        <StatusBadge tone={variant.available ? "primary" : "danger"}>{variant.available ? "доступен" : "недоступен"}</StatusBadge>
      </PageHeader>

      <section className={SECTION_CARD}>
        <h2 className={SECTION_TITLE}>Вариант движка</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Название</span>
            <input className={FIELD_INPUT} value={name} onChange={(e) => setName(e.currentTarget.value)} />
          </label>
          <InstallFieldsForm
            schema={installSchema}
            values={installFields}
            onChange={(field, value) => setInstallFields((prev) => ({ ...prev, [field]: value }))}
          />
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <button onClick={handleSave} disabled={!canSave} className={PRIMARY_BUTTON}>
            Сохранить
          </button>
          <button
            onClick={async () => {
              try {
                setVariant(await orchestratorApi.recheckPlugin(variant.id));
              } catch {
                setError("Проверка не прошла");
              }
            }}
            className={SMALL_BUTTON}
          >
            Проверить
          </button>
          <div className="text-[11px] font-mono text-neutral-500">
            версия движка: <span className="text-on-surface">{variant.engine_version ?? "не определена"}</span> · plugin v
            {variant.plugin_version}
            {variant.unavailable_reason && <span className="text-danger"> · {variant.unavailable_reason}</span>}
          </div>
        </div>
        {saveError && <p className="text-xs text-danger font-mono mt-3">{saveError}</p>}
      </section>

      <section className="bg-surface-container-lowest p-6 mb-6">
        <div className={`${FIELD_LABEL} mb-2`}>
          Ссылаются на этот вариант ({referencingProfiles.length + referencingInferences.length})
        </div>
        <div className="flex flex-col gap-2">
          {referencingProfiles.map((p) => (
            <ListCard key={`p-${p.id}`} to={`/profiles/${p.id}`} accent="neutral" title={`профиль ${p.name}`} />
          ))}
          {referencingInferences.map((i) => (
            <ListCard key={`i-${i.id}`} to={`/inferences/${i.id}`} accent="neutral" title={`inference ${i.name}`} />
          ))}
          {!referenced && <ListCard accent="neutral" title="Профилей и inference пока нет" />}
        </div>
      </section>

      {error && <p className="text-xs text-danger font-mono mb-4">{error}</p>}

      <div className="flex items-center justify-between">
        <button onClick={() => navigate("/engines")} className={GHOST_BUTTON}>
          Назад
        </button>
        <button
          onClick={async () => {
            try {
              await orchestratorApi.deletePlugin(variant.id);
              navigate("/engines");
            } catch (err) {
              setError(err instanceof Error ? err.message : "нельзя удалить вариант: на него ссылаются");
            }
          }}
          disabled={referenced}
          title={referenced ? "нельзя удалить: на вариант ссылаются профили или inference" : undefined}
          className="px-4 py-2 border border-danger/30 text-danger/40 font-['Space_Grotesk'] text-xs font-bold uppercase cursor-not-allowed disabled:opacity-100 enabled:hover:bg-danger enabled:hover:text-black enabled:hover:border-danger"
        >
          Удалить вариант
        </button>
      </div>
    </div>
  );
}
