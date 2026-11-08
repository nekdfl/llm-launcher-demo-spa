import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { orchestratorApi } from "../api/orchestrator";
import { groupModelsByRepo, modelOptionLabel } from "../lib/modelOptionLabel";
import type { EngineInstallation, ModelEntity, Profile } from "../api/types";

const FIELD_LABEL = "text-[11px] text-neutral-500 uppercase font-['Space_Grotesk']";
const FIELD_INPUT = "bg-surface-container border border-neutral-800 px-3 py-2 font-mono text-xs";

/** Model → profile → cards, per spec ("выбор модели, профиля... карт").
 * Creating fresh from an engine plugin's schema (no profile) is left for a
 * follow-up — this covers the spec's one required scenario: "Новый
 * inference создаётся из существующего профиля". */
export function CreateInferencePage() {
  const navigate = useNavigate();
  const [models, setModels] = useState<ModelEntity[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [installations, setInstallations] = useState<EngineInstallation[]>([]);

  const [modelId, setModelId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [installationId, setInstallationId] = useState("");
  const [name, setName] = useState("");
  const [gpuIds, setGpuIds] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const [modelsRes, profilesRes, installationsRes] = await Promise.all([
        orchestratorApi.listModels(),
        orchestratorApi.listProfiles(),
        orchestratorApi.listEngineInstallations(),
      ]);
      setModels(modelsRes);
      setProfiles(profilesRes);
      setInstallations(installationsRes);
    })();
  }, []);

  const profilesForModel = profiles.filter((p) => String(p.model_id) === modelId);

  useEffect(() => {
    const profile = profiles.find((p) => String(p.id) === profileId);
    if (profile) setGpuIds(profile.gpu_ids.join(","));
  }, [profileId, profiles]);

  const handleSubmit = async () => {
    setError(null);
    if (!modelId || !profileId || !installationId || !name.trim()) {
      setError("Заполните все поля");
      return;
    }
    const profile = profiles.find((p) => String(p.id) === profileId);
    if (!profile) return;

    setSubmitting(true);
    try {
      const inference = await orchestratorApi.createInference({
        name: name.trim(),
        profile_id: profile.id,
        model_id: Number(modelId),
        engine_installation_id: Number(installationId),
        gpu_ids: gpuIds.split(",").map((s) => s.trim()).filter(Boolean).map(Number),
        structural_fields: profile.structural_fields,
        cli_options: profile.cli_options,
        system_prompt: profile.system_prompt,
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

      <section className="bg-surface-container-lowest tactical-accent p-6 max-w-2xl">
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

          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Установка движка</span>
            <select className={FIELD_INPUT} value={installationId} onChange={(e) => setInstallationId(e.currentTarget.value)} required>
              <option value="" disabled>
                Выберите установку
              </option>
              {installations.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className={`${FIELD_LABEL} flex flex-wrap items-center gap-2`}>
              Карты
              <span className="text-neutral-700 normal-case font-normal">— номера GPU через запятую, например 0,1</span>
            </span>
            <input className={FIELD_INPUT} value={gpuIds} onChange={(e) => setGpuIds(e.currentTarget.value)} />
          </label>

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
