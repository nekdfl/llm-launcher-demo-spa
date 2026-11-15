import { FIELD_LABEL, INHERITED_FIELD } from "./ui";

/** Служебные поля профиля и inference: версия плагина и хэш схемы, на
 * которых записаны параметры, и признак «требует проверки». Ведёт их
 * система — только для чтения. */
export function PluginStampFields({
  pluginVersion,
  schemaHash,
  needsReview,
}: {
  pluginVersion: string;
  schemaHash: string;
  needsReview: boolean;
}) {
  const items: [string, string, string][] = [
    ["Версия плагина", pluginVersion || "—", "stamp-plugin-version"],
    ["Хэш схемы", schemaHash || "—", "stamp-schema-hash"],
    ["Требует проверки", needsReview ? "да" : "нет", "stamp-needs-review"],
  ];
  return (
    <>
      {items.map(([label, value, testId]) => (
        <label key={testId} className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>{label}</span>
          <input className={INHERITED_FIELD} value={value} readOnly data-testid={testId} />
        </label>
      ))}
    </>
  );
}
