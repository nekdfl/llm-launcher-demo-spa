import { describe, expect, it } from "vitest";
import { groupModelsByRepo, modelOptionLabel } from "./modelOptionLabel";

function model(overrides: Partial<Parameters<typeof modelOptionLabel>[0]> = {}) {
  return {
    id: 1,
    provider_id: 1,
    ref: "org/model",
    file_path: "/models/org/model/model-Q4_K_M.gguf",
    favorite: false,
    metadata: { quantization: "Q4_K_M" } as Record<string, unknown>,
    ...overrides,
  };
}

describe("modelOptionLabel", () => {
  it("называет квант рядом с репозиторием", () => {
    expect(modelOptionLabel(model())).toBe("org/model Q4_K_M");
  });

  it("помечает избранную модель звёздочкой", () => {
    expect(modelOptionLabel(model({ favorite: true }))).toBe("★ org/model Q4_K_M");
  });

  it("записи одного репозитория без метки кванта различимы", () => {
    const first = modelOptionLabel(
      model({ metadata: {}, file_path: "/models/org/model/first.gguf" })
    );
    const second = modelOptionLabel(
      model({ metadata: {}, file_path: "/models/org/model/second.gguf" })
    );

    expect(first).not.toBe(second);
    expect(first).toContain("first.gguf");
  });
});

describe("groupModelsByRepo", () => {
  it("варианты одного репозитория идут подряд", () => {
    const grouped = groupModelsByRepo([
      { id: 1, provider_id: 1, ref: "org/a" },
      { id: 2, provider_id: 1, ref: "org/b" },
      { id: 3, provider_id: 1, ref: "org/a" },
      { id: 4, provider_id: 1, ref: "org/b" },
    ]);

    expect(grouped.map((m) => m.id)).toEqual([1, 3, 2, 4]);
  });

  it("избранное поднимает репозиторий целиком, порядок групп — из ответа", () => {
    // Оркестратор отдаёт избранные первыми: вариант org/b избран, поэтому
    // его репозиторий встречается раньше — и вся группа идёт впереди.
    const grouped = groupModelsByRepo([
      { id: 9, provider_id: 1, ref: "org/b" },
      { id: 1, provider_id: 1, ref: "org/a" },
      { id: 5, provider_id: 1, ref: "org/b" },
      { id: 2, provider_id: 1, ref: "org/a" },
    ]);

    expect(grouped.map((m) => m.id)).toEqual([9, 5, 1, 2]);
  });

  it("одинаковые ref у разных провайдеров не смешиваются", () => {
    const grouped = groupModelsByRepo([
      { id: 1, provider_id: 1, ref: "org/a" },
      { id: 2, provider_id: 2, ref: "org/a" },
      { id: 3, provider_id: 1, ref: "org/a" },
    ]);

    expect(grouped.map((m) => m.id)).toEqual([1, 3, 2]);
  });

  it("ни одна запись не теряется", () => {
    const input = [
      { id: 1, provider_id: 1, ref: "org/a" },
      { id: 2, provider_id: 1, ref: "org/b" },
    ];

    expect(groupModelsByRepo(input)).toHaveLength(input.length);
  });
});
