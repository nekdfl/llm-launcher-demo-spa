import { AssistantSettingsSection } from "./AssistantSettingsSection";
import { RetentionSettingsSection } from "./RetentionSettingsSection";
import { PageHeader } from "../../components/ui";

/** /settings/assistant — «Хранение и помощник» as its own §1 page. */
export function AssistantSettingsPage() {
  return (
    <div>
      <PageHeader backTo="/settings" backLabel="Настройки" title="Хранение и помощник" />
      <RetentionSettingsSection />
      <AssistantSettingsSection />
    </div>
  );
}
