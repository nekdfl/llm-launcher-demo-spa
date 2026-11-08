import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { orchestratorApi } from "../../api/orchestrator";
import type { Inference, ModelEntity, Profile, PluginRecord } from "../../api/types";
import { ListCard, PageHeader, PRIMARY_BUTTON, type AccentTone } from "../../components/ui";

interface ProfileCardData {
  profile: Profile;
  modelName: string;
  engineName: string;
  inferenceCount: number;
  needsReview: boolean;
  modelUnusableReason: string | null;
}

/** reference/profile_manager — grid of cards, each with the left accent
 * stripe (warn + warning icon when the plugin schema changed), metadata line
 * "model · engine", and an inference-count badge. */
export function ProfilesList() {
  const [cards, setCards] = useState<ProfileCardData[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [profiles, models, inferences, plugins] = await Promise.all([
          orchestratorApi.listProfiles(),
          orchestratorApi.listModels(),
          orchestratorApi.listInferences(),
          orchestratorApi.listPlugins(),
        ]);
        setCards(buildCards(profiles, models, inferences, plugins));
      } catch {
        setError("Не удалось загрузить профили");
      }
    })();
  }, []);

  return (
    <div>
      <PageHeader title="Менеджер профилей">
        <Link to="/profiles/new" className={PRIMARY_BUTTON}>
          Создать профиль
        </Link>
      </PageHeader>

      {error && <p className="text-xs text-danger font-mono">{error}</p>}
      {!cards && !error && <p className="text-sm text-neutral-500 font-mono">Загрузка…</p>}

      {cards && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map((card) => (
            <ProfileCard key={card.profile.id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileCard({ card }: { card: ProfileCardData }) {
  const accent: AccentTone = card.modelUnusableReason ? "danger" : card.needsReview ? "warn" : "primary";
  const badgeTone = card.needsReview ? "warn" : card.inferenceCount > 0 ? "primary" : "neutral";
  return (
    <ListCard
      to={`/profiles/${card.profile.id}`}
      accent={accent}
      title={
        <>
          {card.profile.name}{" "}
          {card.needsReview && (
            <span className="material-symbols-outlined text-warn text-xs" title="схема плагина изменилась">
              warning
            </span>
          )}
        </>
      }
      meta={
        <>
          {/* Негодность модели видна и здесь, а чинится в одном месте —
              в карточке самой модели, куда и ведёт ссылка. */}
          {card.modelUnusableReason && (
            <span className="block text-danger" data-testid={`profile-model-unusable-${card.profile.id}`}>
              модель негодна: {card.modelUnusableReason} —{" "}
              <Link to={`/models/${card.profile.model_id}`} className="underline">
                открыть модель
              </Link>
            </span>
          )}
          {card.modelName} · {card.engineName}
        </>
      }
      badge={{ tone: badgeTone, label: `${card.inferenceCount} inferences` }}
    />
  );
}

function buildCards(
  profiles: Profile[],
  models: ModelEntity[],
  inferences: Inference[],
  plugins: PluginRecord[]
): ProfileCardData[] {
  return profiles.map((profile) => ({
    profile,
    modelName: models.find((m) => m.id === profile.model_id)?.ref ?? `model ${profile.model_id}`,
    engineName: plugins.find((p) => p.id === profile.engine_plugin_id)?.name ?? `plugin ${profile.engine_plugin_id}`,
    inferenceCount: inferences.filter((inf) => inf.profile_id === profile.id).length,
    needsReview: profile.needs_review,
    modelUnusableReason: profile.model_validity?.usable === false ? profile.model_validity.reason : null,
  }));
}
