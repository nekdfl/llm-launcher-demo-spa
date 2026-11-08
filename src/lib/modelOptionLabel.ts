import type { ModelEntity } from "../api/types";

type ModelOption = Pick<ModelEntity, "id" | "provider_id" | "ref" | "favorite" | "metadata" | "file_path">;

/** Подпись модели в нативном `<option>`: внутрь опции значок шрифта не
 * вставить, поэтому избранное помечается символом `★` в начале текста.
 * Это осознанное отличие от плитки, где звёздочка — значок
 * `material-symbols`; замена нативного списка своим компонентом к задаче
 * не относится и тянет доступность с клавиатурой.
 *
 * Квант в подписи обязателен: записи создаются на каждый квант
 * репозитория, и без метки варианты одного репозитория становятся
 * неотличимыми строками с одним названием. */
export function modelOptionLabel(model: ModelOption): string {
  const name = [model.ref, variantSuffix(model)].filter((part) => part !== "").join(" ");
  return model.favorite ? `★ ${name}` : name;
}

/** Чем отличать варианты одного репозитория: меткой кванта, а если её
 * нет — именем файла. `file_path` у моделей уникален по построению,
 * поэтому две записи одного репозитория не окажутся подписаны
 * одинаково. */
function variantSuffix(model: ModelOption): string {
  const quant = model.metadata?.quantization;
  if (typeof quant === "string" && quant !== "") return quant;
  const fileName = model.file_path.split("/").pop() ?? "";
  return fileName;
}

/** Перечень моделей для выбора: варианты одного репозитория идут подряд,
 * одной группой, затем следующий репозиторий.
 *
 * Приоритет избранного сохраняется сам: оркестратор отдаёт избранные
 * первыми, поэтому репозиторий с избранным вариантом встречается раньше
 * и его группа оказывается выше. Своей сортировки по избранному здесь
 * нет и быть не должно — порядок задаётся в одном месте.
 *
 * Скрывать записи функция не умеет: негодные остаются в перечне, иначе
 * спрятанной оказалась бы причина, по которой профиль не создаётся. */
export function groupModelsByRepo<T extends Pick<ModelEntity, "provider_id" | "ref">>(models: T[]): T[] {
  const groups: { key: string; items: T[] }[] = [];
  for (const model of models) {
    const key = `${model.provider_id}:${model.ref}`;
    const existing = groups.find((group) => group.key === key);
    if (existing) existing.items.push(model);
    else groups.push({ key, items: [model] });
  }
  return groups.flatMap((group) => group.items);
}
