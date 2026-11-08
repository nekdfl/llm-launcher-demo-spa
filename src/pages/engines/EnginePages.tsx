import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { orchestratorApi } from "../../api/orchestrator";
import type { FieldDescriptor } from "../../api/orchestrator";
import type { EngineInstallation, Profile, PluginRecord } from "../../api/types";
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
  StatusBadge,
  type AccentTone,
  type BadgeTone,
} from "../../components/ui";

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
          {field.description && <span className="text-[10px] text-neutral-600 font-mono">{field.description}</span>}
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

/** reference/engine_manager — installation cards with availability state and
 * an inline «Проверить» button (recheck), plus «Регистрация установки». */
export function EngineManagerPage() {
  const navigate = useNavigate();
  const [installations, setInstallations] = useState<EngineInstallation[] | null>(null);
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [list, pluginList] = await Promise.all([
          orchestratorApi.listEngineInstallations(),
          orchestratorApi.listPlugins(),
        ]);
        setInstallations(list);
        setPlugins(pluginList.filter((p) => p.plugin_type === "engine"));
      } catch {
        setInstallations([]);
      }
    })();
  }, []);

  async function recheck(installation: EngineInstallation) {
    try {
      await orchestratorApi.recheckEngineInstallation(installation.id);
      const list = await orchestratorApi.listEngineInstallations();
      setInstallations(list);
    } catch {
      /* card state refreshes on next visit; recheck errors surface server-side */
    }
  }

  return (
    <div>
      <PageHeader title="Менеджер движков">
        <button onClick={() => navigate("/engines/new")} className={PRIMARY_BUTTON}>
          Зарегистрировать установку
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(installations ?? []).map((installation) => {
          const accent: AccentTone = installation.available ? "primary" : "danger";
          const badgeTone: BadgeTone = installation.available ? "primary" : "danger";
          const pluginName = plugins.find((p) => p.id === installation.plugin_id)?.name ?? "";
          return (
            <div
              key={installation.id}
              onClick={() => navigate(`/engines/${installation.id}`)}
              className="bg-surface-container-low p-5 cursor-pointer hover:bg-surface-container"
              style={{ boxShadow: `inset 4px 0 0 0 ${installation.available ? "#3ce36a" : "#ff5c5c"}` }}
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className={`font-['Space_Grotesk'] font-bold text-lg ${installation.available ? "" : "text-neutral-400"}`}>
                    {installation.name}
                  </div>
                  <div className="text-[11px] text-neutral-500 font-mono">
                    {pluginName} {installation.version ? `· ${installation.version}` : ""}
                  </div>
                  {!installation.available && installation.unavailable_reason && (
                    <div className="text-[10px] text-danger font-mono mt-1">{installation.unavailable_reason}</div>
                  )}
                </div>
                <StatusBadge tone={badgeTone}>{installation.available ? "доступна" : "недоступна"}</StatusBadge>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  recheck(installation);
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

/** reference/engine_install_create — plugin, name, install-схема плагина. */
export function EngineInstallCreatePage() {
  const navigate = useNavigate();
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  const [pluginId, setPluginId] = useState("");
  const [installSchema, setInstallSchema] = useState<FieldDescriptor[]>([]);
  const [name, setName] = useState("");
  const [installFields, setInstallFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    orchestratorApi
      .listPlugins()
      .then((list) => setPlugins(list.filter((p) => p.plugin_type === "engine")))
      .catch(() => setError("Не удалось загрузить engine-плагины"));
  }, []);

  useEffect(() => {
    if (!pluginId) {
      setInstallSchema([]);
      setInstallFields({});
      return;
    }
    orchestratorApi
      .getPluginSchema(Number(pluginId))
      .then((schema) => {
        setInstallSchema(schema.install_schema);
        setInstallFields({});
      })
      .catch(() => setError("Не удалось загрузить схему плагина"));
  }, [pluginId]);

  async function handleSubmit() {
    try {
      await orchestratorApi.createEngineInstallation({
        name,
        plugin_id: Number(pluginId),
        install_fields: installFields,
      });
      navigate("/engines");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось зарегистрировать установку");
    }
  }

  const canSubmit = Boolean(pluginId) && Boolean(name) && schemaIsSatisfied(installSchema, installFields);

  return (
    <div>
      <PageHeader backTo="/engines" backLabel="Движки" title="Регистрация установки" />

      <section className={SECTION_CARD}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Engine-плагин</span>
            <select className={FIELD_INPUT} value={pluginId} onChange={(e) => setPluginId(e.currentTarget.value)}>
              <option value="" disabled>
                Выберите плагин
              </option>
              {plugins.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Название установки</span>
            <input className={FIELD_INPUT} placeholder="b4210-cuda" value={name} onChange={(e) => setName(e.currentTarget.value)} />
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
        <div className="text-[10px] text-neutral-600 font-mono">
          Версия определяется выполнением команды, объявленной плагином — заодно проверка, что путь рабочий (§4.5).
        </div>
      </section>

      {error && <p className="text-xs text-danger font-mono mb-4">{error}</p>}

      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/engines")} className={GHOST_BUTTON}>
          Отмена
        </button>
        <button onClick={handleSubmit} disabled={!canSubmit} className={PRIMARY_BUTTON}>
          Зарегистрировать
        </button>
      </div>
    </div>
  );
}

/** reference/engine_install_detail — installation card with «Проверить» and
 * the integrity-locked delete button (visible reason, UI-BEHAVIOR §6). */
export function EngineInstallDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [installation, setInstallation] = useState<EngineInstallation | null>(null);
  const [installSchema, setInstallSchema] = useState<FieldDescriptor[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [name, setName] = useState("");
  const [installFields, setInstallFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const [data, profileList] = await Promise.all([
          orchestratorApi.getEngineInstallation(Number(id)),
          orchestratorApi.listProfiles(),
        ]);
        setInstallation(data);
        setName(data.name);
        setInstallFields(installFieldsToStrings(data.install_fields));
        setProfiles(profileList);
        const schema = await orchestratorApi.getPluginSchema(data.plugin_id);
        setInstallSchema(schema.install_schema);
      } catch {
        setError("Не удалось загрузить установку");
      }
    })();
  }, [id]);

  if (!installation) return <p className="py-8 text-sm text-neutral-500 font-mono">{error ?? "Загрузка…"}</p>;

  const referencingProfiles = profiles.filter((p) => p.engine_plugin_id === installation.plugin_id);
  const originalInstallFields = installFieldsToStrings(installation.install_fields);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await orchestratorApi.updateEngineInstallation(installation!.id, {
        name,
        install_fields: installFields,
      });
      setInstallation(updated);
      setName(updated.name);
      setInstallFields(installFieldsToStrings(updated.install_fields));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Не удалось сохранить изменения");
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    name !== installation.name ||
    Object.keys(installFields).some((key) => installFields[key] !== (originalInstallFields[key] ?? ""));
  const canSave = dirty && !saving && Boolean(name) && schemaIsSatisfied(installSchema, installFields);

  return (
    <div>
      <PageHeader backTo="/engines" backLabel="Движки" title={installation.name}>
        <StatusBadge tone={installation.available ? "primary" : "danger"}>
          {installation.available ? "доступна" : "недоступна"}
        </StatusBadge>
      </PageHeader>

      <section className={SECTION_CARD}>
        <h2 className={SECTION_TITLE}>Установка</h2>
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
                await orchestratorApi.recheckEngineInstallation(installation.id);
                setInstallation(await orchestratorApi.getEngineInstallation(installation.id));
              } catch {
                setError("Проверка не прошла");
              }
            }}
            className={SMALL_BUTTON}
          >
            Проверить
          </button>
          <div className="text-[11px] font-mono text-neutral-500">
            версия: <span className="text-on-surface">{installation.version ?? "не определена"}</span>
            {installation.unavailable_reason && <span className="text-danger"> · {installation.unavailable_reason}</span>}
          </div>
        </div>
        {saveError && <p className="text-xs text-danger font-mono mt-3">{saveError}</p>}
      </section>

      <section className="bg-surface-container-lowest p-6 mb-6">
        <div className="text-[11px] font-['Space_Grotesk'] uppercase text-neutral-500 mb-2">
          Профили этого engine-плагина ({referencingProfiles.length})
        </div>
        <ListCard
          accent="neutral"
          title={referencingProfiles.length > 0 ? `${referencingProfiles.length} профилей могут запускаться на этой установке` : "Профилей пока нет"}
        />
        <div className="text-[10px] text-neutral-600 font-mono mt-2">
          Совместимость определяется тем же плагином — эти профили запустятся на любой установке этого плагина.
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
              await orchestratorApi.deleteEngineInstallation(installation.id);
              navigate("/engines");
            } catch (err) {
              setError(err instanceof Error ? err.message : "нельзя удалить установку: есть ссылающиеся профили");
            }
          }}
          disabled={referencingProfiles.length > 0}
          title={referencingProfiles.length > 0 ? "нельзя удалить: есть профили, ссылающиеся на установку" : undefined}
          className="px-4 py-2 border border-danger/30 text-danger/40 font-['Space_Grotesk'] text-xs font-bold uppercase cursor-not-allowed disabled:opacity-100 enabled:hover:bg-danger enabled:hover:text-black enabled:hover:border-danger"
        >
          Удалить установку
        </button>
      </div>
    </div>
  );
}
