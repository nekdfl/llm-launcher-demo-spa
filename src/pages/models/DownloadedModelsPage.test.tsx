import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadedModelsPage } from "./ModelsPages";
import { orchestratorApi } from "../../api/orchestrator";

vi.mock("../../api/orchestrator", () => ({
  orchestratorApi: {
    getDownloadStats: vi.fn().mockResolvedValue({
      active_count: 0,
      completed_count: 0,
      models_count: 0,
      free_bytes: 0,
      remaining_bytes: 0,
      speed_bytes_per_sec: null,
      eta_active_seconds: null,
      eta_all_seconds: null,
      active_etas: {},
    }),
    listModels: vi.fn(),
    listProviders: vi.fn(),
    listRepoSyncStates: vi.fn(),
    checkModelUpdates: vi.fn(),
    updateRepo: vi.fn(),
  },
}));

const mockedListModels = vi.mocked(orchestratorApi.listModels);
const mockedListProviders = vi.mocked(orchestratorApi.listProviders);
const mockedStates = vi.mocked(orchestratorApi.listRepoSyncStates);
const mockedCheck = vi.mocked(orchestratorApi.checkModelUpdates);
const mockedUpdateRepo = vi.mocked(orchestratorApi.updateRepo);

const MODELS = [
  { id: 1, provider_id: 1, ref: "org/with-updates", file_path: "/m/a", format: "gguf", metadata: {}, favorite: false, validity: { usable: true, reason: null } },
  { id: 2, provider_id: 1, ref: "org/clean", file_path: "/m/b", format: "gguf", metadata: {}, favorite: false, validity: { usable: true, reason: null } },
  { id: 3, provider_id: 1, ref: "org/unchecked", file_path: "/m/c", format: "gguf", metadata: {}, favorite: false, validity: { usable: true, reason: null } },
  { id: 4, provider_id: 1, ref: "org/unreachable", file_path: "/m/d", format: "gguf", metadata: {}, favorite: false, validity: { usable: true, reason: null } },
];

function state(modelRef: string, overrides: Record<string, unknown> = {}) {
  return {
    provider_id: 1,
    model_ref: modelRef,
    checked_at: "2026-10-14T12:00:00",
    missing_count: 0,
    changed_count: 0,
    extra_count: 0,
    content_verified: true,
    check_error: null,
    has_updates: false,
    checking: false,
    ...overrides,
  };
}

const STATES = [
  state("org/with-updates", { missing_count: 2, has_updates: true }),
  state("org/clean"),
  state("org/unreachable", { check_error: "401 Unauthorized" }),
];

beforeEach(() => {
  mockedListModels.mockReset().mockResolvedValue(MODELS as never);
  mockedListProviders.mockReset().mockResolvedValue([{ id: 1, name: "huggingface", plugin_id: 1, config: {} }] as never);
  mockedStates.mockReset().mockResolvedValue(STATES as never);
  mockedCheck.mockReset().mockResolvedValue({ started: true, states: STATES } as never);
  mockedUpdateRepo.mockReset().mockResolvedValue({ started: true, deleted: [], kept_extra: [] } as never);
});

function renderPage() {
  return render(
    <MemoryRouter>
      <DownloadedModelsPage />
    </MemoryRouter>
  );
}

describe("DownloadedModelsPage — проверка обновлений", () => {
  it("пометки строятся по сохранённому состоянию, без новой сверки", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId("has-updates-1")).toBeInTheDocument());
    expect(mockedCheck).not.toHaveBeenCalled();
    expect(screen.getByTestId("last-checked-at")).toHaveTextContent("последняя проверка");
  });

  it("клик по «Проверить обновления» запускает сверку всех моделей", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("check-updates")).toBeEnabled());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("check-updates"));

    await waitFor(() => expect(mockedCheck).toHaveBeenCalledTimes(1));
  });

  it("кнопка недоступна во время запроса запуска", async () => {
    mockedCheck.mockReturnValue(new Promise(() => {}) as never);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("check-updates")).toBeEnabled());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("check-updates"));

    await waitFor(() => expect(screen.getByTestId("check-updates")).toBeDisabled());
    expect(screen.getByTestId("check-updates")).toHaveTextContent("Проверка…");
  });

  it("модель без расхождений не помечена", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("has-updates-1")).toBeInTheDocument());

    expect(screen.queryByTestId("has-updates-2")).not.toBeInTheDocument();
  });

  it("непроверенная модель не выглядит совпадающей с репозиторием", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("не проверялась")).toBeInTheDocument());
    expect(screen.queryByTestId("has-updates-3")).not.toBeInTheDocument();
  });

  it("недоступный репозиторий помечен отдельно от «есть обновления»", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId("check-failed-4")).toBeInTheDocument());
    expect(screen.getByTestId("check-failed-4")).toHaveAttribute("title", "401 Unauthorized");
    expect(screen.queryByTestId("has-updates-4")).not.toBeInTheDocument();
  });
});

describe("DownloadedModelsPage — недоступная сверка не гасит список", () => {
  it("список моделей рисуется, даже если состояния проверки недоступны", async () => {
    // Так ведёт себя оркестратор без маршрута сверки (404) — список
    // моделей от этого зависеть не должен.
    mockedStates.mockRejectedValue(new Error("404 Not Found"));
    renderPage();

    expect(await screen.findByText("org/with-updates")).toBeInTheDocument();
    expect(screen.getByText("org/clean")).toBeInTheDocument();
    expect(screen.queryByText("Не удалось загрузить модели")).not.toBeInTheDocument();
  });

  it("при недоступной сверке модели показаны как непроверенные", async () => {
    mockedStates.mockRejectedValue(new Error("404 Not Found"));
    renderPage();

    await screen.findByText("org/with-updates");
    expect(screen.getAllByText("не проверялась")).toHaveLength(4);
    expect(screen.queryByTestId("last-checked-at")).not.toBeInTheDocument();
  });

  it("ошибка списка моделей по-прежнему сообщается", async () => {
    mockedListModels.mockRejectedValue(new Error("503"));
    renderPage();

    expect(await screen.findByText("Не удалось загрузить модели")).toBeInTheDocument();
  });
});

describe("DownloadedModelsPage — ход асинхронной проверки", () => {
  const CHECKING = [
    state("org/with-updates", { checked_at: null, checking: true }),
    state("org/clean", { checked_at: null, checking: true }),
    state("org/unchecked", { checked_at: null, checking: true }),
    state("org/unreachable", { checked_at: null, checking: true }),
  ];

  it("у проверяемой модели спиннер и надпись «проверка обновлений» вместо «не проверялась»", async () => {
    mockedCheck.mockResolvedValue({ started: true, states: CHECKING } as never);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("check-updates")).toBeEnabled());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("check-updates"));

    await waitFor(() => expect(screen.getByTestId("checking-1")).toBeInTheDocument());
    expect(screen.getAllByText("проверка обновлений").length).toBeGreaterThan(0);
    expect(screen.queryByText("не проверялась")).not.toBeInTheDocument();
  });

  it("пометки обновляются по мере готовности, опрос прекращается по завершении", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockedCheck.mockResolvedValue({ started: true, states: CHECKING } as never);
      // Первый такт опроса: первая модель готова, остальные ещё в работе.
      mockedStates
        .mockResolvedValueOnce(STATES as never)
        .mockResolvedValueOnce([
          state("org/with-updates", { missing_count: 2, has_updates: true }),
          ...CHECKING.slice(1),
        ] as never)
        .mockResolvedValue(STATES as never);

      renderPage();
      await waitFor(() => expect(screen.getByTestId("check-updates")).toBeEnabled());
      const user = userEvent.setup();
      await user.click(screen.getByTestId("check-updates"));
      await waitFor(() => expect(screen.getByTestId("checking-1")).toBeInTheDocument());

      await vi.advanceTimersByTimeAsync(1600);
      // У первой результат уже есть, у второй спиннер остался.
      await waitFor(() => expect(screen.getByTestId("has-updates-1")).toBeInTheDocument());
      expect(screen.getByTestId("checking-2")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(1600);
      await waitFor(() => expect(screen.queryByTestId("checking-2")).not.toBeInTheDocument());

      const callsAfterFinish = mockedStates.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockedStates.mock.calls.length).toBe(callsAfterFinish);
    } finally {
      vi.useRealTimers();
    }
  });

  it("кнопка недоступна, пока есть проверяемые модели", async () => {
    mockedStates.mockResolvedValue(CHECKING as never);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("check-updates")).toBeDisabled());
    expect(screen.getByTestId("check-updates")).toHaveTextContent("Проверка…");
  });
});

describe("DownloadedModelsPage — кнопка «Обновить» на плитке", () => {
  it("у модели с расхождением кнопка вместо бейджа «есть обновления»", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId("update-model-1")).toBeInTheDocument());
    expect(screen.queryByText("есть обновления")).not.toBeInTheDocument();
  });

  it("нажатие обновляет модель и не открывает её страницу", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("update-model-1")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("update-model-1"));

    // delete_extra = false: удаление лишних необратимо и остаётся в карточке.
    await waitFor(() => expect(mockedUpdateRepo).toHaveBeenCalledWith(1, "org/with-updates", false));
    // Переход по ссылке карточки не произошёл — список всё ещё на месте.
    expect(screen.getByText("org/clean")).toBeInTheDocument();
  });

  it("сообщает, что обновление поставлено в очередь", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("update-model-1")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("update-model-1"));

    expect(await screen.findByTestId("update-message-1")).toHaveTextContent("обновление поставлено в очередь");
  });

  it("сообщает об оставленных лишних файлах", async () => {
    mockedUpdateRepo.mockResolvedValue({ started: true, deleted: [], kept_extra: ["old-build.fxb"] } as never);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("update-model-1")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("update-model-1"));

    expect(await screen.findByTestId("update-message-1")).toHaveTextContent("лишних файлов оставлено: 1");
    expect(screen.getByTestId("update-message-1")).toHaveTextContent("в карточке модели");
  });

  it("кнопка недоступна, пока обновление ставится в очередь", async () => {
    mockedUpdateRepo.mockReturnValue(new Promise(() => {}) as never);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("update-model-1")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("update-model-1"));

    await waitFor(() => expect(screen.getByTestId("update-model-1")).toBeDisabled());
    expect(screen.getByTestId("update-model-1")).toHaveTextContent("Обновление…");
  });

  it("у прочих состояний кнопки нет", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("update-model-1")).toBeInTheDocument());

    expect(screen.queryByTestId("update-model-2")).not.toBeInTheDocument(); // совпадает
    expect(screen.queryByTestId("update-model-3")).not.toBeInTheDocument(); // не проверялась
    expect(screen.queryByTestId("update-model-4")).not.toBeInTheDocument(); // проверить не удалось
  });
});

describe("DownloadedModelsPage — панель и быстрый переход", () => {
  it("показывает панель статистики и быстрый переход", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId("models-quick-switch")).toBeInTheDocument());
    expect(screen.getByTestId("download-stats")).toBeInTheDocument();
  });
});

describe("DownloadedModelsPage — плитка на репозиторий", () => {
  it("четыре записи одного репозитория дают одну плитку с четырьмя метками", async () => {
    vi.mocked(orchestratorApi.listModels).mockResolvedValue([
      { id: 10, provider_id: 1, ref: "org/multi", file_path: "/m/1", format: "gguf", metadata: { quantization: "IQ2_XS" }, favorite: false, validity: { usable: true, reason: null } },
      { id: 11, provider_id: 1, ref: "org/multi", file_path: "/m/2", format: "gguf", metadata: { quantization: "IQ3_S" }, favorite: false, validity: { usable: true, reason: null } },
      { id: 12, provider_id: 1, ref: "org/multi", file_path: "/m/3", format: "gguf", metadata: { quantization: "IQ3_XXS" }, favorite: false, validity: { usable: true, reason: null } },
      { id: 13, provider_id: 1, ref: "org/multi", file_path: "/m/4", format: "gguf", metadata: { quantization: "Q2_0" }, favorite: false, validity: { usable: true, reason: null } },
    ] as never);
    renderPage();

    await waitFor(() => expect(screen.getAllByText("org/multi")).toHaveLength(1));
    expect(screen.getByTestId("launch-variants")).toHaveTextContent("IQ2_XS IQ3_S IQ3_XXS Q2_0");
    // Переход — в запись с наименьшим id как представителя репозитория.
    expect(screen.getByTestId("model-tile-10")).toHaveAttribute("href", "/models/10");
  });

  it("«Обновить» на сгруппированной плитке обновляет репозиторий один раз", async () => {
    vi.mocked(orchestratorApi.listModels).mockResolvedValue([
      { id: 10, provider_id: 1, ref: "org/with-updates", file_path: "/m/1", format: "gguf", metadata: { quantization: "IQ2_XS" }, favorite: false, validity: { usable: true, reason: null } },
      { id: 11, provider_id: 1, ref: "org/with-updates", file_path: "/m/2", format: "gguf", metadata: { quantization: "Q2_0" }, favorite: false, validity: { usable: true, reason: null } },
    ] as never);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("update-model-10")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("update-model-10"));

    await waitFor(() => expect(orchestratorApi.updateRepo).toHaveBeenCalledTimes(1));
    expect(orchestratorApi.updateRepo).toHaveBeenCalledWith(1, "org/with-updates", false);
  });
});

describe("DownloadedModelsPage — избранное", () => {
  it("избранная модель помечена звёздочкой и идёт первой", async () => {
    // Порядок приходит от оркестратора — избранные первыми; экран его
    // не пересортировывает.
    vi.mocked(orchestratorApi.listModels).mockResolvedValue([
      { id: 20, provider_id: 1, ref: "org/favorite", file_path: "/m/f", format: "gguf", metadata: {}, favorite: true, validity: { usable: true, reason: null } },
      { id: 21, provider_id: 1, ref: "org/plain", file_path: "/m/p", format: "gguf", metadata: {}, favorite: false, validity: { usable: true, reason: null } },
    ] as never);
    renderPage();

    await waitFor(() => expect(screen.getByText("org/favorite")).toBeInTheDocument());
    const tiles = screen.getAllByTestId(/^model-tile-/);
    expect(tiles[0]).toHaveTextContent("org/favorite");
    expect(screen.getAllByTestId("favorite-star")).toHaveLength(1);
  });
});

describe("DownloadedModelsPage — негодная запись", () => {
  it("помечает запись с пропавшим файлом причиной", async () => {
    vi.mocked(orchestratorApi.listModels).mockResolvedValue([
      {
        id: 30,
        provider_id: 1,
        ref: "org/broken",
        file_path: "/old/models/model.gguf",
        format: "gguf",
        metadata: {},
        favorite: false,
        validity: { usable: false, reason: "файл отсутствует" },
      },
    ] as never);
    renderPage();

    expect(await screen.findByTestId("model-unusable")).toHaveTextContent("файл отсутствует");
  });
});
