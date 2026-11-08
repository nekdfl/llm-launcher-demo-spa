import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelDownloadsPage } from "./ModelDownloadsPage";
import { orchestratorApi } from "../../api/orchestrator";
import { fileDetail, modelDetail } from "../../testing/modelDetail";
import userEvent from "@testing-library/user-event";

vi.mock("../../api/orchestrator", () => ({
  orchestratorApi: {
    getDownloadStats: vi.fn(),
    listDownloads: vi.fn(),
    getDownloadProgress: vi.fn().mockResolvedValue({ downloaded_bytes: 0, total_bytes: 1000, percent: 0 }),
    getModelDetail: vi.fn(),
    pauseDownload: vi.fn(),
    resumeDownload: vi.fn(),
    cancelDownload: vi.fn(),
    deleteDownload: vi.fn(),
    reorderDownloads: vi.fn(),
    createDownload: vi.fn(),
    refreshModelVariant: vi.fn(),
    listModels: vi.fn(),
    getRepoSync: vi.fn(),
  },
}));

const TASK = {
  id: "dl-1",
  provider_id: 1,
  model_ref: "org/model",
  target_dir: "/models/org/model",
  status: "active",
  downloaded_bytes: 500,
  total_bytes: 1000,
  error_message: null,
  file_names: ["model.gguf"],
  kind: "download" as const,
};

const FILE = "IQ3_XXS/model-IQ3_XXS.gguf";

const REGISTERED_MODEL = {
  id: 7,
  provider_id: 1,
  ref: "org/model",
  file_path: "/models/org/model/model.gguf",
  format: "gguf",
  metadata: {},
  favorite: false, validity: { usable: true, reason: null },
};

const STATS = {
  active_count: 1,
  completed_count: 0,
  models_count: 3,
  free_bytes: 1000,
  remaining_bytes: 500,
  speed_bytes_per_sec: 100,
  eta_active_seconds: 5,
  eta_all_seconds: 5,
  active_etas: { "dl-1": 5 },
};

beforeEach(() => {
  vi.mocked(orchestratorApi.getDownloadStats).mockReset().mockResolvedValue(STATS as never);
  vi.mocked(orchestratorApi.listDownloads).mockReset().mockResolvedValue([TASK] as never);
  vi.mocked(orchestratorApi.getModelDetail)
    .mockReset()
    .mockResolvedValue(modelDetail({ description: "описание", files: [], variants: [] }));
  vi.mocked(orchestratorApi.refreshModelVariant).mockReset().mockResolvedValue({ started: true } as never);
  vi.mocked(orchestratorApi.listModels).mockReset().mockResolvedValue([] as never);
  vi.mocked(orchestratorApi.getRepoSync).mockReset().mockResolvedValue({
    has_updates: false,
    content_verified: true,
    missing_count: 0,
    changed_count: 0,
    extra_count: 0,
    files: [{ filename: "model.gguf", state: "same", local_size: 1000, remote_size: 1000, content_verified: true }],
  } as never);
});

/** Карточка завершённой задачи у скачанной модели: файл на диске, модель
 * зарегистрирована, сверка отвечает (или нет — `null`). */
function arrangeDownloadedModel(syncFiles: unknown[] | null) {
  vi.mocked(orchestratorApi.listDownloads).mockResolvedValue([{ ...TASK, status: "completed" }] as never);
  vi.mocked(orchestratorApi.listModels).mockResolvedValue([REGISTERED_MODEL] as never);
  vi.mocked(orchestratorApi.getModelDetail).mockResolvedValue(
    modelDetail({ description: "описание", files: [fileDetail(FILE, 1000, { downloaded: true, local_size: 1000 })] })
  );
  if (syncFiles === null) {
    vi.mocked(orchestratorApi.getRepoSync).mockRejectedValue(new Error("сверка недоступна"));
  } else {
    vi.mocked(orchestratorApi.getRepoSync).mockResolvedValue({
      has_updates: false,
      content_verified: true,
      missing_count: 0,
      changed_count: 0,
      extra_count: 0,
      files: syncFiles,
    } as never);
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/models/downloads"]}>
      <ModelDownloadsPage />
    </MemoryRouter>
  );
}

describe("ModelDownloadsPage", () => {
  it("показывает очередь, панель статистики и быстрый переход", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Загрузки")).toBeInTheDocument());
    expect(screen.getByTestId("download-stats")).toBeInTheDocument();
    expect(screen.getByTestId("models-quick-switch")).toBeInTheDocument();
  });

  it("поиска на странице нет", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Загрузки")).toBeInTheDocument());
    expect(screen.queryByPlaceholderText("Название модели или репозитория")).not.toBeInTheDocument();
    expect(screen.queryByText("Результаты поиска")).not.toBeInTheDocument();
  });

  it("ETA задачи приходит из той же сводки, что опрашивает страница", async () => {
    renderPage();

    expect(await screen.findByTestId("download-eta")).toHaveTextContent("ETA");
  });

  it("раскрытие плитки открывает карточку модели", async () => {
    renderPage();
    const row = await screen.findByTestId("download-row-toggle");

    row.click();

    expect(await screen.findByText("описание")).toBeInTheDocument();
  });

  it("раскрытая плитка показывает оба раздела: «Метаданные» и «Карточка модели»", async () => {
    renderPage();
    (await screen.findByTestId("download-row-toggle")).click();

    expect(await screen.findByTestId("model-meta-info")).toBeInTheDocument();
    expect(screen.getByTestId("model-card")).toBeInTheDocument();
  });

  it("у скачанной модели совпадающий файл — «скачано», без «Обновить» и «Скачать»", async () => {
    arrangeDownloadedModel([{ filename: FILE, state: "same", local_size: 1000, remote_size: 1000, content_verified: true }]);
    renderPage();
    (await screen.findByTestId("download-row-toggle")).click();

    const row = await screen.findByTestId(`file-row-${FILE}`);
    await waitFor(() => expect(screen.getByTestId("meta-updates")).toHaveTextContent("актуально"));

    expect(row).toHaveTextContent("скачано");
    expect(screen.queryByTestId(`update-file-${FILE}`)).not.toBeInTheDocument();
    expect(screen.queryByText("Скачать")).not.toBeInTheDocument();
  });

  it("изменённый в репозитории файл обновляется кнопкой «Обновить»", async () => {
    arrangeDownloadedModel([{ filename: FILE, state: "changed", local_size: 1000, remote_size: 1200, content_verified: true }]);
    renderPage();
    (await screen.findByTestId("download-row-toggle")).click();

    const action = await screen.findByTestId(`update-file-${FILE}`);
    await userEvent.click(action);

    await waitFor(() => expect(orchestratorApi.refreshModelVariant).toHaveBeenCalledWith(1, "org/model", FILE));
  });

  it("идущая закачка: вместо «Скачать» — её состояние", async () => {
    vi.mocked(orchestratorApi.getModelDetail).mockResolvedValue(
      modelDetail({ description: "описание", files: [fileDetail(FILE, 1000)] })
    );
    renderPage();
    (await screen.findByTestId("download-row-toggle")).click();

    expect(await screen.findByTestId("repo-task-state")).toHaveTextContent("качается");
    expect(screen.queryByTestId("download-full-repo")).not.toBeInTheDocument();
    expect(screen.getByTestId("meta-status")).toHaveTextContent("качается 50%");
  });

  it("после отменённой закачки карточка предлагает «Скачать», статус — «не скачано»", async () => {
    vi.mocked(orchestratorApi.listDownloads).mockResolvedValue([{ ...TASK, status: "cancelled" }] as never);
    vi.mocked(orchestratorApi.getModelDetail).mockResolvedValue(
      modelDetail({ description: "описание", files: [fileDetail(FILE, 1000)] })
    );
    renderPage();
    (await screen.findByTestId("download-row-toggle")).click();

    expect(await screen.findByTestId("download-full-repo")).toBeInTheDocument();
    expect(screen.getByTestId(`download-file-${FILE}`)).toBeInTheDocument();
    expect(screen.getByTestId("meta-status")).toHaveTextContent("не скачано");
  });

  it("недоступная сверка не гасит карточку и не включает «Обновить»", async () => {
    arrangeDownloadedModel(null);
    renderPage();
    (await screen.findByTestId("download-row-toggle")).click();

    expect(await screen.findByTestId(`file-row-${FILE}`)).toHaveTextContent("скачано");
    await waitFor(() => expect(screen.getByTestId("meta-updates")).toHaveTextContent("не удалось проверить"));
    expect(screen.queryByTestId(`update-file-${FILE}`)).not.toBeInTheDocument();
  });
});
