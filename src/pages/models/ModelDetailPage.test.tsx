import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelDetailPage } from "./ModelDetailPage";
import { orchestratorApi } from "../../api/orchestrator";

vi.mock("../../api/orchestrator", () => ({
  orchestratorApi: {
    getModel: vi.fn(),
    setModelFavorite: vi.fn(),
    setModelFilePath: vi.fn(),
    detachModel: vi.fn(),
    restoreModel: vi.fn(),
    listProviders: vi.fn(),
    getModelDetail: vi.fn(),
    getModelDeletionPreview: vi.fn(),
    deleteModel: vi.fn(),
    getRepoSync: vi.fn(),
    updateRepo: vi.fn(),
    updateRepoFile: vi.fn(),
    listDownloads: vi.fn(),
    createDownload: vi.fn(),
  },
}));

const mockedGetModel = vi.mocked(orchestratorApi.getModel);
const mockedListProviders = vi.mocked(orchestratorApi.listProviders);
const mockedModelDetail = vi.mocked(orchestratorApi.getModelDetail);
const mockedRepoSync = vi.mocked(orchestratorApi.getRepoSync);
const mockedUpdateRepo = vi.mocked(orchestratorApi.updateRepo);
const mockedUpdateRepoFile = vi.mocked(orchestratorApi.updateRepoFile);
const mockedListDownloads = vi.mocked(orchestratorApi.listDownloads);

function syncReport(files: { filename: string; state: string; local_size?: number | null }[]) {
  const typed = files.map((f) => ({
    filename: f.filename,
    state: f.state as never,
    remote_size: f.state === "extra" ? null : 1000,
    local_size: f.local_size ?? (f.state === "missing" ? null : 1000),
    content_verified: true,
  }));
  return {
    has_updates: typed.some((f) => f.state !== "same"),
    content_verified: true,
    missing_count: typed.filter((f) => f.state === "missing").length,
    changed_count: typed.filter((f) => f.state === "changed").length,
    extra_count: typed.filter((f) => f.state === "extra").length,
    files: typed,
  };
}

const MODEL = { id: 1, provider_id: 1, ref: "org/model", file_path: "/m/model.gguf", format: "gguf", metadata: {}, favorite: false, validity: { usable: true, reason: null } };

const DETAIL = {
  description: "описание",
  source_url: null,
  total_bytes: 1000,
  total_disk_sufficient: true,
  features: [],
  variants: [
    {
      filename: "model.gguf",
      quant_label: "Q4_K_M",
      size: 1000,
      downloaded: true,
      local_size: 1000,
      disk_sufficient: true,
      estimated_vram_bytes: 2000,
    },
  ],
  files: [{ filename: "model.gguf", size: 1000, downloaded: true, local_size: 1000, disk_sufficient: true }],
  local_bytes: 1000,
  repo_format: "gguf" as const,
  supporting_engines: [{ id: 3, name: "llama-cpp-main" }],
};

beforeEach(() => {
  mockedGetModel.mockReset().mockResolvedValue(MODEL);
  mockedListProviders.mockReset().mockResolvedValue([{ id: 1, name: "huggingface", plugin_id: 1, config: {} }]);
  mockedModelDetail.mockReset().mockResolvedValue(DETAIL);
  mockedRepoSync.mockReset().mockResolvedValue(syncReport([{ filename: "model.gguf", state: "same" }]) as never);
  mockedUpdateRepo.mockReset().mockResolvedValue({ started: true, deleted: [], kept_extra: [] } as never);
  mockedUpdateRepoFile.mockReset().mockResolvedValue({ started: true } as never);
  mockedListDownloads.mockReset().mockResolvedValue([]);
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/models/1"]}>
      <Routes>
        <Route path="/models/:id" element={<ModelDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ModelDetailPage — карточка модели сверху", () => {
  it("показывает разделы «Метаданные» и «Карточка модели»; отдельного раздела метаданных нет", async () => {
    renderPage();

    expect(await screen.findByTestId("model-card")).toBeInTheDocument();
    await waitFor(() => expect(mockedModelDetail).toHaveBeenCalledWith(1, "org/model"));
    await waitFor(() => expect(within(screen.getByTestId("files-table-scroll")).getByText("model.gguf")).toBeInTheDocument());
    const meta = screen.getByTestId("model-meta-info");
    expect(screen.getAllByText("Метаданные")).toHaveLength(1);
    expect(within(meta).getByTestId("meta-status")).toHaveTextContent("скачано");
    expect(within(meta).getByTestId("meta-support")).toHaveTextContent("llama-cpp-main");
    // Сведения записи и файлы на диске — внутри того же раздела.
    expect(meta).toHaveTextContent("huggingface");
    expect(meta).toHaveTextContent("/m/model.gguf");
    expect(meta).toHaveTextContent("1 из 1");
    expect(screen.getByText("Удалить вместе с файлами")).toBeInTheDocument();
  });

  it("при неудаче getModelDetail страница не падает, карточка — состояние недоступности", async () => {
    mockedModelDetail.mockRejectedValue(new Error("no detail"));
    renderPage();

    // wait for the page to finish loading the model first, then the card
    // settles into its unavailable state
    expect(await screen.findByText("Метаданные")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId("detail-unavailable")).toHaveLength(2));
  });

  it("пока детали не получены, разделы крутят спиннер, а не пишут «Нет данных»", async () => {
    let resolveDetail: (value: typeof DETAIL) => void = () => {};
    mockedModelDetail.mockReturnValue(new Promise((resolve) => (resolveDetail = resolve)));
    renderPage();

    await screen.findByTestId("model-card");
    expect(screen.getAllByTestId("detail-loading")).toHaveLength(2);
    expect(screen.queryByText("Нет данных")).not.toBeInTheDocument();

    resolveDetail(DETAIL);
    await waitFor(() => expect(screen.queryByTestId("detail-loading")).not.toBeInTheDocument());
    expect(screen.getByTestId("file-row-model.gguf")).toBeInTheDocument();
  });

  it("«Повторить» после ошибки перезапрашивает детали и показывает данные", async () => {
    mockedModelDetail.mockRejectedValueOnce(new Error("429")).mockResolvedValue(DETAIL);
    renderPage();

    await waitFor(() => expect(screen.getAllByTestId("detail-retry")).toHaveLength(2));
    await userEvent.setup().click(screen.getAllByTestId("detail-retry")[0]);

    expect(await screen.findByTestId("file-row-model.gguf")).toBeInTheDocument();
    expect(mockedModelDetail).toHaveBeenCalledTimes(2);
  });
});


describe("ModelDetailPage — обновление вместо закачки", () => {
  it("без расхождений «Обновить всё» и «Обновить» выключены", async () => {
    render(<MemoryRouter initialEntries={["/models/1"]}><Routes><Route path="/models/:id" element={<ModelDetailPage />} /></Routes></MemoryRouter>);

    await waitFor(() => expect(screen.getByTestId("update-all")).toBeDisabled());
    expect(screen.queryByTestId("update-file-model.gguf")).not.toBeInTheDocument();
    expect(screen.getByTestId("file-row-model.gguf")).toHaveTextContent("скачано");
    expect(screen.getByTestId("update-all")).toHaveAttribute("title", expect.stringContaining("обновлять нечего"));
  });

  it("изменённый файл можно обновить, и это видно в таблице", async () => {
    mockedRepoSync.mockResolvedValue(syncReport([{ filename: "model.gguf", state: "changed" }]) as never);
    render(<MemoryRouter initialEntries={["/models/1"]}><Routes><Route path="/models/:id" element={<ModelDetailPage />} /></Routes></MemoryRouter>);

    await waitFor(() => expect(screen.getByTestId("update-file-model.gguf")).toBeEnabled());
    expect(screen.getByTestId("sync-state-model.gguf")).toHaveTextContent("изменён");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("update-file-model.gguf"));
    await waitFor(() => expect(mockedUpdateRepoFile).toHaveBeenCalledWith(1, "org/model", "model.gguf"));
  });

  it("лишний локально файл виден в таблице", async () => {
    mockedRepoSync.mockResolvedValue(
      syncReport([
        { filename: "model.gguf", state: "same" },
        { filename: "old-build.fxb", state: "extra", local_size: 2048 },
      ]) as never
    );
    render(<MemoryRouter initialEntries={["/models/1"]}><Routes><Route path="/models/:id" element={<ModelDetailPage />} /></Routes></MemoryRouter>);

    const row = await screen.findByTestId("extra-file-old-build.fxb");
    expect(row).toHaveTextContent("лишний локально");
  });

  it("«Обновить всё» без лишних файлов обновляет сразу, без подтверждения", async () => {
    mockedRepoSync.mockResolvedValue(syncReport([{ filename: "new.safetensors", state: "missing" }]) as never);
    render(<MemoryRouter initialEntries={["/models/1"]}><Routes><Route path="/models/:id" element={<ModelDetailPage />} /></Routes></MemoryRouter>);

    await waitFor(() => expect(screen.getByTestId("update-all")).toBeEnabled());
    const user = userEvent.setup();
    await user.click(screen.getByTestId("update-all"));

    await waitFor(() => expect(mockedUpdateRepo).toHaveBeenCalledWith(1, "org/model", false));
  });

  it("при лишних файлах подтверждение показывает их перечень, и без него удаления нет", async () => {
    mockedRepoSync.mockResolvedValue(
      syncReport([
        { filename: "model.gguf", state: "same" },
        { filename: "old-build.fxb", state: "extra", local_size: 2048 },
      ]) as never
    );
    render(<MemoryRouter initialEntries={["/models/1"]}><Routes><Route path="/models/:id" element={<ModelDetailPage />} /></Routes></MemoryRouter>);

    await waitFor(() => expect(screen.getByTestId("update-all")).toBeEnabled());
    const user = userEvent.setup();
    await user.click(screen.getByTestId("update-all"));

    const confirm = screen.getByTestId("update-confirm");
    expect(confirm).not.toHaveAttribute("hidden");
    expect(confirm).toHaveTextContent("old-build.fxb");
    expect(mockedUpdateRepo).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("update-confirm-keep"));
    await waitFor(() => expect(mockedUpdateRepo).toHaveBeenCalledWith(1, "org/model", false));
  });

  it("подтверждение удаления передаёт delete_extra", async () => {
    mockedRepoSync.mockResolvedValue(
      syncReport([{ filename: "old-build.fxb", state: "extra", local_size: 2048 }]) as never
    );
    render(<MemoryRouter initialEntries={["/models/1"]}><Routes><Route path="/models/:id" element={<ModelDetailPage />} /></Routes></MemoryRouter>);

    await waitFor(() => expect(screen.getByTestId("update-all")).toBeEnabled());
    const user = userEvent.setup();
    await user.click(screen.getByTestId("update-all"));
    await user.click(screen.getByTestId("update-confirm-delete"));

    await waitFor(() => expect(mockedUpdateRepo).toHaveBeenCalledWith(1, "org/model", true));
  });

  it("недоступная сверка не гасит карточку модели", async () => {
    mockedRepoSync.mockRejectedValue(new Error("503"));
    render(<MemoryRouter initialEntries={["/models/1"]}><Routes><Route path="/models/:id" element={<ModelDetailPage />} /></Routes></MemoryRouter>);

    expect(await screen.findByTestId("files-table-scroll")).toBeInTheDocument();
    expect(within(screen.getByTestId("files-table-scroll")).getByText("model.gguf")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("update-all")).toBeDisabled());
  });
});

describe("ModelDetailPage — проверка обновлений в карточке", () => {
  const renderCard = () =>
    render(
      <MemoryRouter initialEntries={["/models/1"]}>
        <Routes>
          <Route path="/models/:id" element={<ModelDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

  it("перечитывает расхождение и включает обновление", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByTestId("update-all")).toBeDisabled());

    mockedRepoSync.mockResolvedValue(syncReport([{ filename: "model.gguf", state: "changed" }]) as never);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("check-this-model"));

    await waitFor(() => expect(screen.getByTestId("update-all")).toBeEnabled());
    expect(screen.getByTestId("sync-state-model.gguf")).toHaveTextContent("изменён");
  });

  it("кнопка недоступна, пока проверка идёт", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByTestId("check-this-model")).toBeEnabled());

    mockedRepoSync.mockReturnValue(new Promise(() => {}) as never);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("check-this-model"));

    await waitFor(() => expect(screen.getByTestId("check-this-model")).toBeDisabled());
    expect(screen.getByTestId("check-this-model")).toHaveTextContent("Проверка…");
  });

  it("ошибка проверки показана сообщением и не гасит карточку", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByTestId("check-this-model")).toBeEnabled());

    mockedRepoSync.mockRejectedValue(new Error("репозиторий недоступен"));
    const user = userEvent.setup();
    await user.click(screen.getByTestId("check-this-model"));

    expect(await screen.findByTestId("sync-error")).toHaveTextContent("репозиторий недоступен");
    expect(within(screen.getByTestId("files-table-scroll")).getByText("model.gguf")).toBeInTheDocument();
    expect(screen.getByText("описание")).toBeInTheDocument();
  });
});

describe("ModelDetailPage — панели и перехода нет", () => {
  it("на странице конкретной модели нет панели статистики и быстрого перехода", async () => {
    render(
      <MemoryRouter initialEntries={["/models/1"]}>
        <Routes>
          <Route path="/models/:id" element={<ModelDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(within(screen.getByTestId("files-table-scroll")).getByText("model.gguf")).toBeInTheDocument());
    expect(screen.queryByTestId("download-stats")).not.toBeInTheDocument();
    expect(screen.queryByTestId("models-quick-switch")).not.toBeInTheDocument();
  });
});

describe("ModelDetailPage — избранное", () => {
  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={["/models/1"]}>
        <Routes>
          <Route path="/models/:id" element={<ModelDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

  it("включает избранное из карточки", async () => {
    vi.mocked(orchestratorApi.setModelFavorite).mockResolvedValue({ ...MODEL, favorite: true, validity: { usable: true, reason: null } } as never);
    renderPage();
    const star = await screen.findByTestId("favorite-toggle");
    expect(star).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(star);

    await waitFor(() => expect(orchestratorApi.setModelFavorite).toHaveBeenCalledWith(1, true));
    await waitFor(() => expect(screen.getByTestId("favorite-toggle")).toHaveAttribute("aria-pressed", "true"));
  });

  it("выключает избранное из карточки", async () => {
    mockedGetModel.mockResolvedValue({ ...MODEL, favorite: true, validity: { usable: true, reason: null } } as never);
    vi.mocked(orchestratorApi.setModelFavorite).mockResolvedValue({ ...MODEL, favorite: false, validity: { usable: true, reason: null } } as never);
    renderPage();
    const star = await screen.findByTestId("favorite-toggle");
    expect(star).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(star);

    await waitFor(() => expect(orchestratorApi.setModelFavorite).toHaveBeenCalledWith(1, false));
    await waitFor(() => expect(screen.getByTestId("favorite-toggle")).toHaveAttribute("aria-pressed", "false"));
  });

  it("ошибка переключения оставляет звёздочку в прежнем состоянии", async () => {
    vi.mocked(orchestratorApi.setModelFavorite).mockRejectedValue(new Error("503"));
    renderPage();

    await userEvent.click(await screen.findByTestId("favorite-toggle"));

    expect(await screen.findByTestId("favorite-error")).toBeInTheDocument();
    expect(screen.getByTestId("favorite-toggle")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("ModelDetailPage — ручное исправление негодной записи", () => {
  const UNUSABLE = { ...MODEL, validity: { usable: false, reason: "файл отсутствует" } };

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={["/models/1"]}>
        <Routes>
          <Route path="/models/:id" element={<ModelDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

  it("показывает причину и три действия", async () => {
    mockedGetModel.mockResolvedValue(UNUSABLE as never);
    renderPage();

    expect(await screen.findByTestId("model-repair")).toHaveTextContent("файл отсутствует");
    expect(screen.getByTestId("repair-apply-path")).toBeInTheDocument();
    expect(screen.getByTestId("repair-redownload")).toBeInTheDocument();
    expect(screen.getByTestId("repair-detach")).toBeInTheDocument();
  });

  it("исправляет путь из карточки", async () => {
    mockedGetModel.mockResolvedValue(UNUSABLE as never);
    vi.mocked(orchestratorApi.setModelFilePath).mockResolvedValue(MODEL as never);
    renderPage();
    await screen.findByTestId("model-repair");

    await userEvent.type(screen.getByTestId("repair-path-input"), "/data/models/model.gguf");
    await userEvent.click(screen.getByTestId("repair-apply-path"));

    await waitFor(() =>
      expect(orchestratorApi.setModelFilePath).toHaveBeenCalledWith(1, "/data/models/model.gguf")
    );
    // Запись стала годной — блок исправления исчез.
    await waitFor(() => expect(screen.queryByTestId("model-repair")).not.toBeInTheDocument());
  });

  it("ошибка исправления показана и путь не меняется", async () => {
    mockedGetModel.mockResolvedValue(UNUSABLE as never);
    vi.mocked(orchestratorApi.setModelFilePath).mockRejectedValue(new Error("метаданные не разбираются"));
    renderPage();
    await screen.findByTestId("model-repair");

    await userEvent.type(screen.getByTestId("repair-path-input"), "/data/broken.gguf");
    await userEvent.click(screen.getByTestId("repair-apply-path"));

    expect(await screen.findByTestId("repair-error")).toHaveTextContent("метаданные не разбираются");
    expect(screen.getByTestId("model-repair")).toBeInTheDocument();
  });

  it("повторная закачка сообщает о начале очереди", async () => {
    mockedGetModel.mockResolvedValue(UNUSABLE as never);
    vi.mocked(orchestratorApi.restoreModel).mockResolvedValue({ started: true } as never);
    renderPage();
    await screen.findByTestId("model-repair");

    await userEvent.click(screen.getByTestId("repair-redownload"));

    await waitFor(() => expect(orchestratorApi.restoreModel).toHaveBeenCalledWith(1));
    expect(await screen.findByTestId("repair-message")).toHaveTextContent("в начало очереди");
  });

  it("снятие записи уходит на отдельный маршрут, не на удаление модели", async () => {
    mockedGetModel.mockResolvedValue(UNUSABLE as never);
    vi.mocked(orchestratorApi.detachModel).mockResolvedValue(undefined as never);
    renderPage();
    await screen.findByTestId("model-repair");

    await userEvent.click(screen.getByTestId("repair-detach"));

    await waitFor(() => expect(orchestratorApi.detachModel).toHaveBeenCalledWith(1));
    expect(orchestratorApi.deleteModel).not.toHaveBeenCalled();
  });

  it("годная запись блока исправления не показывает", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId("model-card")).toBeInTheDocument());
    expect(screen.queryByTestId("model-repair")).not.toBeInTheDocument();
  });
});
