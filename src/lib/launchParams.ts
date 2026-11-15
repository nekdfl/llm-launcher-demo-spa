import type { ExtensionSelection, Inference, Profile } from "../api/types";

/** Поля, которые inference получает из профиля и хранит всегда: совпадение
 * значения с профилем показывается как «из профиля», расхождение — как
 * переопределение. Отдельного флага нет — состояние выводится из значений. */
export const PROFILE_PARITY_KEYS = [
  "gpu_ids",
  "structural_fields",
  "cli_options",
  "system_prompt",
  "extensions",
] as const;
export type ProfileParityKey = (typeof PROFILE_PARITY_KEYS)[number];

export type ProfileParityValues = Pick<Profile, ProfileParityKey>;

/** Сравнение без учёта порядка ключей объектов: `{a,b}` и `{b,a}` — одно
 * значение. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** Карты — множество: порядок выбора не делает их разными. */
function sameSet<T>(a: T[], b: T[]): boolean {
  return sameValue([...a].sort(), [...b].sort());
}

/** Значение поля отличается от профильного. `structural_fields` и
 * `extensions` целиком — для отдельного поля схемы или расширения есть
 * `structuralFieldOverridden` / `extensionOverridden`. */
export function isOverridden<K extends ProfileParityKey>(key: K, value: ProfileParityValues[K], profileValue: ProfileParityValues[K]): boolean {
  if (key === "gpu_ids") return !sameSet(value as unknown[], profileValue as unknown[]);
  return !sameValue(value, profileValue);
}

export function structuralFieldOverridden(fields: Record<string, unknown>, profileFields: Record<string, unknown>, name: string): boolean {
  return !sameValue(fields[name], profileFields[name]);
}

export function extensionOverridden(selection: ExtensionSelection, profileSelection: ExtensionSelection, name: string): boolean {
  return !sameValue(selection[name], profileSelection[name]);
}

/** Копия значений профиля — то, что получает новый inference и что
 * записывает «Сбросить к профилю». */
export function profileParityValues(profile: Profile): ProfileParityValues {
  return structuredClone({
    gpu_ids: profile.gpu_ids,
    structural_fields: profile.structural_fields,
    cli_options: profile.cli_options,
    system_prompt: profile.system_prompt,
    extensions: profile.extensions,
  });
}

/** Хоть одно поле inference разошлось с профилем. */
export function anyOverridden(inference: Inference, profile: Profile): boolean {
  const reference = profileParityValues(profile);
  return PROFILE_PARITY_KEYS.some((key) => isOverridden(key, inference[key], reference[key]));
}
