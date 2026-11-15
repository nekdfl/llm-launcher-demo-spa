import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type FieldDescriptor, orchestratorApi } from "../api/orchestrator";
import { ArgvEditor } from "../components/ArgvEditor";
import { EngineBadge } from "../components/EngineBadge";
import { GpuChecklist, toggleGpuId, useGpuChecklistItems } from "../components/GpuChecklist";
import { SchemaField } from "../components/SchemaField";
import { groupModelsByRepo, modelOptionLabel } from "../lib/modelOptionLabel";
import type { ModelEntity, Profile } from "../api/types";
import { FIELD_HINT, FIELD_INPUT, FIELD_LABEL, SECTION_TITLE } from "../components/ui";


/** Параметры запуска в мастере: стартуют значениями профиля и уходят при
 * создании значениями — совпадение с профилем карточка inference покажет
 * как «из профиля». Остальные поля профиля inference получает копией. */
interface LaunchDraft {
  gpuIds: number[];
  structural: Record<string, unknown>;
  cliOptions: string;
  systemPrompt: string;
}

const EMPTY_LAUNCH: LaunchDraft = { gpuIds: [], structural: {}, cliOptions: "", systemPrompt: "" };

function launchFromProfile(profile: Profile): LaunchDraft {
  return {
    gpuIds: [...profile.gpu_ids],
    structural: { ...profile.structural_fields },
    cliOptions: profile.cli_options,
    systemPrompt: profile.system_prompt,
  };
}

/** Model → profile → параметры запуска (карты, драйвер, опции, system
 * prompt), per spec ("выбор модели, профиля... карт").
 * Creating fresh from an engine plugin's schema (no profile) is left for a
 * follow-up — this covers the spec's one required scenario: "Новый
 * inference создаётся из существующего профиля". */
export function CreateInferencePage() {
  const navigate = useNavigate();
  const [models, setModels] = useState<ModelEntity[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  const [modelId, setModelId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [name, setName] = useState("");
  const [launch, setLaunch] = useState<LaunchDraft>(EMPTY_LAUNCH);
  const [driverField, setDriverField] = useState<FieldDescriptor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const [modelsRes, profilesRes] = await Promise.all([orchestratorApi.listModels(), orchestratorApi.listProfiles()]);
      setModels(modelsRes);
      setProfiles(profilesRes);
    })();
  }, []);

  const profilesForModel = profiles.filter((p) => String(p.model_id) === modelId);

  const selectedProfile = profiles.find((p) => String(p.id) === profileId) ?? null;
  useEffect(() => {
    setLaunch(selectedProfile ? launchFromProfile(selectedProfile) : EMPTY_LAUNCH);
  }, [selectedProfile]);

  // Драйвер — поле схемы плагина профиля (как в карточке профиля).
  useEffect(() => {
    setDriverField(null);
    if (!selectedProfile) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => orchestratorApi.getPluginSchema(selectedProfile.plugin_id))
      .then((schema) => {
        if (!cancelled) setDriverField(schema?.profile_schema.find((field) => field.name === "driver") ?? null);
      })
      .catch(() => {
        if (!cancelled) setDriverField(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProfile]);

  const gpuPicker = useGpuChecklistItems(launch.gpuIds);

  const handleSubmit = async () => {
    setError(null);
    if (!modelId || !profileId || !name.trim()) {
      setError("Заполните все поля");
      return;
    }
    const profile = selectedProfile;
    if (!profile) return;

    setSubmitting(true);
    try {
      const inference = await orchestratorApi.createInference({
        name: name.trim(),
        profile_id: profile.id,
        gpu_ids: launch.gpuIds,
        structural_fields: launch.structural,
        cli_options: launch.cliOptions,
        system_prompt: launch.systemPrompt,
      });
      navigate(`/inferences/${inference.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать inference");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <header className="py-8">
        <h1 className="font-['Space_Grotesk'] text-3xl font-extrabold tracking-tighter uppercase">Новый inference</h1>
      </header>

      <section className="bg-surface-container-lowest tactical-accent p-6 max-w-5xl">
        <div className="flex flex-col gap-4 text-sm">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Имя</span>
            <input className={FIELD_INPUT} value={name} onChange={(e) => setName(e.currentTarget.value)} required />
          </label>

          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Модель</span>
            <select
              className={FIELD_INPUT}
              value={modelId}
              onChange={(e) => {
                setModelId(e.currentTarget.value);
                setProfileId("");
              }}
              required
            >
              <option value="" disabled>
                Выберите модель
              </option>
              {/* Варианты одного репозитория идут подряд; порядок самих
                  репозиториев — из ответа оркестратора, где избранные
                  приходят первыми. Своя сортировка здесь разошлась бы с
                  остальными экранами. */}
              {groupModelsByRepo(models).map((m) => (
                <option key={m.id} value={m.id}>
                  {modelOptionLabel(m)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Профиль</span>
            <select
              className={FIELD_INPUT}
              value={profileId}
              onChange={(e) => setProfileId(e.currentTarget.value)}
              disabled={!modelId}
              required
            >
              <option value="" disabled>
                Выберите профиль
              </option>
              {profilesForModel.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          {selectedProfile && (
            <div className="flex flex-col gap-4 pt-4 border-t border-neutral-900" data-testid="create-launch-params">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className={`${SECTION_TITLE} !mb-0`}>
                  Параметры запуска
                  <EngineBadge pluginId={selectedProfile.plugin_id} />
                </span>
                <span className={FIELD_HINT}>из профиля «{selectedProfile.name}», движок — его же; изменённое станет переопределением</span>
              </div>
              <GpuChecklist
                items={gpuPicker.items}
                selected={new Set(launch.gpuIds)}
                onToggle={(gpuId) => setLaunch((l) => ({ ...l, gpuIds: toggleGpuId(l.gpuIds, gpuId) }))}
                nvmlError={gpuPicker.nvmlError}
              />
              {driverField && (
                <div className="max-w-sm">
                  <SchemaField
                    field={driverField}
                    value={launch.structural.driver ?? driverField.default ?? ""}
                    testId="create-field-driver"
                    onChange={(value) => setLaunch((l) => ({ ...l, structural: { ...l.structural, driver: value } }))}
                  />
                </div>
              )}
              <ArgvEditor value={launch.cliOptions} onChange={(value) => setLaunch((l) => ({ ...l, cliOptions: value }))} testId="create-argv" />
              <label className="flex flex-col gap-1">
                <span className={FIELD_LABEL}>
                  System prompt <span className="text-neutral-700 normal-case font-normal">— вставляется роутером в начало каждого запроса</span>
                </span>
                <textarea
                  aria-label="System prompt"
                  className={`${FIELD_INPUT} h-16`}
                  value={launch.systemPrompt}
                  onChange={(e) => setLaunch((l) => ({ ...l, systemPrompt: e.currentTarget.value }))}
                />
              </label>
            </div>
          )}

          {error && <div className="text-xs text-danger font-mono">{error}</div>}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="mt-2 px-4 py-3 bg-primary text-black text-xs font-['Space_Grotesk'] font-bold uppercase hover:bg-primary/80 disabled:opacity-50 self-start"
          >
            {submitting ? "Создание…" : "Создать"}
          </button>
        </div>
      </section>
    </div>
  );
}
