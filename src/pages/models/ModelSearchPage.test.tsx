import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelSearchPage } from "./ModelSearchPage";
import { orchestratorApi } from "../../api/orchestrator";

vi.mock("../../api/orchestrator", () => ({
  orchestratorApi: {
    listProviders: vi.fn(),
    listDownloads: vi.fn(),
    listModels: vi.fn(),
    searchProviderModels: vi.fn(),
    listProviderVariants: vi.fn(),
    createDownload: vi.fn(),
    getModelDetail: vi.fn(),
    refreshModelVariant: vi.fn(),
    getRepoSync: vi.fn(),
    getDownloadStats: vi.fn().mockResolvedValue({
      active_count: 0,
      completed_count: 0,
      free_bytes: 1_000_000_000,
      remaining_bytes: 0,
      speed_bytes_per_sec: null,
      eta_active_seconds: null,
      eta_all_seconds: null,
      active_etas: {},
    }),
    reorderDownloads: vi.fn(),
  },
}));

const mockedListProviders = vi.mocked(orchestratorApi.listProviders);
const mockedListDownloads = vi.mocked(orchestratorApi.listDownloads);
const mockedListModels = vi.mocked(orchestratorApi.listModels);
const mockedSearch = vi.mocked(orchestratorApi.searchProviderModels);
const mockedCreateDownload = vi.mocked(orchestratorApi.createDownload);
const mockedGetModelDetail = vi.mocked(orchestratorApi.getModelDetail);
const mockedRefreshVariant = vi.mocked(orchestratorApi.refreshModelVariant);
const mockedGetRepoSync = vi.mocked(orchestratorApi.getRepoSync);

const HF_PROVIDER = { id: 1, name: "huggingface", plugin_id: 1, created_at: "2026-01-01", config: {} };

const RESULTS = [
  {
    id: "bartowski/Qwen3-32B-GGUF",
    downloads: 1200000,
    likes: 340,
    tags: ["gguf", "text-generation", "license:apache-2.0"],
    pipeline_tag: "text-generation",
    library_name: "gguf",
    last_modified: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "google/gemma-3-2b-it",
    downloads: 421000,
    likes: 187,
    tags: ["safetensors", "license:gemma"],
    pipeline_tag: "text-generation",
    library_name: "safetensors",
    last_modified: "2026-01-01T00:00:00.000Z",
  },
];

const MODEL_DETAIL = {
  description: "A great quantized model for local inference.",
  source_url: null,
  total_bytes: 5 * 1024 ** 3,
  total_disk_sufficient: true,
  features: [] as string[],
  variants: [
    {
      filename: "Qwen3-32B-Q4_K_M.gguf",
      quant_label: "Q4_K_M",
      size: 100,
      downloaded: false,
      local_size: null,
      disk_sufficient: true,
      estimated_vram_bytes: 100,
    },
    {
      filename: "Qwen3-32B-Q8_0.gguf",
      quant_label: "Q8_0",
      size: 200,
      downloaded: true,
      local_size: 200,
      disk_sufficient: true,
      estimated_vram_bytes: 200,
    },
  ],
  files: [
    { filename: "Qwen3-32B-Q4_K_M.gguf", size: 100, downloaded: false, local_size: null, disk_sufficient: true },
    { filename: "Qwen3-32B-Q8_0.gguf", size: 200, downloaded: true, local_size: 200, disk_sufficient: true },
  ],
  local_bytes: 200,
  repo_format: "gguf" as const,
  supporting_engines: [{ id: 1, name: "llama-cpp-main" }],
};

const SYNC_SAME = {
  has_updates: false,
  content_verified: true,
  missing_count: 1,
  changed_count: 0,
  extra_count: 0,
  files: [
    { filename: "Qwen3-32B-Q8_0.gguf", state: "same" as const, remote_size: 200, local_size: 200, content_verified: true },
  ],
};

beforeEach(() => {
  mockedListProviders.mockReset().mockResolvedValue([HF_PROVIDER]);
  mockedListDownloads.mockReset().mockResolvedValue([]);
  mockedListModels.mockReset().mockResolvedValue([]);
  mockedSearch.mockReset().mockResolvedValue(RESULTS);
  mockedCreateDownload.mockReset().mockResolvedValue({} as never);
  mockedGetModelDetail.mockReset().mockResolvedValue(MODEL_DETAIL);
  mockedRefreshVariant.mockReset().mockResolvedValue({ started: false });
  mockedGetRepoSync.mockReset().mockResolvedValue(SYNC_SAME);
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ModelSearchPage />
    </MemoryRouter>
  );
}

describe("ModelSearchPage auto-search (fires on load and on every filter change)", () => {
  it("fires a search automatically as soon as a provider is picked, with no user action", async () => {
    renderPage();

    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(1));
    expect(mockedSearch).toHaveBeenCalledWith(1, "", { tags: [], sort: "downloads" });
    await waitFor(() => expect(screen.getByText("bartowski/Qwen3-32B-GGUF")).toBeInTheDocument());
  });

  it("defaults the sort to Most downloads", async () => {
    renderPage();

    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(1));
    expect(mockedSearch.mock.calls[0][2]?.sort).toBe("downloads");
    expect(screen.getByDisplayValue("Most downloads")).toBeInTheDocument();
  });

  it("renders the facet sidebar once results have loaded", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId("model-browse-filters")).toBeInTheDocument());
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Libraries")).toBeInTheDocument();
    expect(screen.getByText("Parameters")).toBeInTheDocument();
    expect(screen.getByText("License")).toBeInTheDocument();
    expect(screen.getByText("Text Generation")).toBeInTheDocument();
    expect(screen.getByText("GGUF")).toBeInTheDocument();
    expect(screen.getAllByText("apache-2.0").length).toBeGreaterThan(0);
  });

  it("checking a task checkbox immediately re-searches with it included — no apply button", async () => {
    renderPage();
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(1));

    const user = userEvent.setup();
    await user.click(screen.getByText("Text Generation"));

    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(2));
    expect(mockedSearch.mock.calls[1][2]?.tags).toEqual(["text-generation"]);
    expect(screen.queryByText("Применить фильтры")).not.toBeInTheDocument();
  });

  it("checking library and license checkboxes each immediately re-search, combining into tags", async () => {
    renderPage();
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(1));

    const user = userEvent.setup();
    await user.click(screen.getByText("GGUF"));
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(2));

    await user.click(screen.getAllByText("apache-2.0")[0]);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(3));

    expect(new Set(mockedSearch.mock.calls[2][2]?.tags)).toEqual(new Set(["gguf", "license:apache-2.0"]));
  });

  it("changing sort immediately re-searches with the new value", async () => {
    renderPage();
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(1));

    const user = userEvent.setup();
    await user.selectOptions(screen.getByDisplayValue("Most downloads"), "lastModified");

    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(2));
    expect(mockedSearch.mock.calls[1][2]?.sort).toBe("lastModified");
  });

  it("parameter-bucket checkboxes filter already-fetched results client-side, without a new search call", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("bartowski/Qwen3-32B-GGUF")).toBeInTheDocument());
    expect(screen.getByText("google/gemma-3-2b-it")).toBeInTheDocument();
    expect(mockedSearch).toHaveBeenCalledTimes(1);

    const user = userEvent.setup();
    await user.click(screen.getByText("30B – 70B"));

    await waitFor(() => expect(screen.queryByText("google/gemma-3-2b-it")).not.toBeInTheDocument());
    expect(screen.getByText("bartowski/Qwen3-32B-GGUF")).toBeInTheDocument();
    expect(mockedSearch).toHaveBeenCalledTimes(1);
  });

  it("shows task/library/license tag pills and download/like counts on result rows", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("bartowski/Qwen3-32B-GGUF")).toBeInTheDocument());
    expect(screen.getAllByText("text-generation").length).toBeGreaterThan(0);
    expect(screen.getAllByText("apache-2.0").length).toBeGreaterThan(0);
    expect(screen.getByText("1 200 000")).toBeInTheDocument();
  });

  it("typing a query still requires Enter/the button — no request per keystroke", async () => {
    renderPage();
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(1));

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Название модели или репозитория"), "qwen");

    // typing alone must not trigger additional searches
    expect(mockedSearch).toHaveBeenCalledTimes(1);

    await user.click(screen.getByText("Найти"));
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(2));
    expect(mockedSearch.mock.calls[1][1]).toBe("qwen");
  });
});

describe("ModelSearchPage detail panel (model_search_download)", () => {
  it("clicking a model opens a detail panel to the right of the results list, not an inline expansion", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("bartowski/Qwen3-32B-GGUF")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByText("bartowski/Qwen3-32B-GGUF"));

    await waitFor(() => expect(mockedGetModelDetail).toHaveBeenCalledWith(1, "bartowski/Qwen3-32B-GGUF"));
    const panel = await screen.findByTestId("model-detail-panel");
    const resultsList = screen.getByText("Результаты поиска").closest("section")!;
    // the panel is a sibling section next to the results list, not nested below it
    expect(panel.parentElement).toBe(resultsList.parentElement);
  });

  it("над разделами — имя модели без кнопок, затем «Метаданные» и «Карточка модели»", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("bartowski/Qwen3-32B-GGUF")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByText("bartowski/Qwen3-32B-GGUF"));

    const panel = await screen.findByTestId("model-detail-panel");
    await waitFor(() => expect(within(panel).getByTestId("model-meta-info")).toBeInTheDocument());
    expect(within(panel).getByTestId("model-card")).toBeInTheDocument();
    expect(within(panel).queryByText("Закрыть")).not.toBeInTheDocument();
    await waitFor(() => expect(within(panel).getByTestId("meta-status")).toHaveTextContent("скачано частично"));
    expect(within(panel).getByTestId("meta-updates")).toHaveTextContent("актуально");
    expect(within(panel).getByTestId("meta-support")).toHaveTextContent("поддерживается · llama-cpp-main");
    expect(within(panel).getByTestId("meta-quants")).toHaveTextContent("Q4_K_M");
    expect(within(panel).getByTestId("meta-quants")).toHaveTextContent("Q8_0 ✓");
  });

  it("shows description, total size, and every repo file once", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("bartowski/Qwen3-32B-GGUF")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByText("bartowski/Qwen3-32B-GGUF"));

    await waitFor(() => expect(screen.getByText(/great quantized model/)).toBeInTheDocument());
    expect(screen.getByText("5.0 GB")).toBeInTheDocument();
    const files = screen.getByTestId("files-table-scroll");
    expect(within(files).getAllByText("Qwen3-32B-Q4_K_M.gguf")).toHaveLength(1);
    expect(within(files).getAllByText("Qwen3-32B-Q8_0.gguf")).toHaveLength(1);
  });

  it("у нескачанного файла — «Скачать» этого файла", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("bartowski/Qwen3-32B-GGUF")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByText("bartowski/Qwen3-32B-GGUF"));
    await waitFor(() => expect(screen.getByTestId("download-file-Qwen3-32B-Q4_K_M.gguf")).toBeInTheDocument());
    expect(screen.getAllByText("достаточно").length).toBeGreaterThan(0);

    await user.click(screen.getByTestId("download-file-Qwen3-32B-Q4_K_M.gguf"));
    await waitFor(() =>
      expect(mockedCreateDownload).toHaveBeenCalledWith({
        provider_id: 1,
        model_ref: "bartowski/Qwen3-32B-GGUF",
        variant_label: "",
        files: [{ filename: "Qwen3-32B-Q4_K_M.gguf", size: 100 }],
      })
    );
  });

  it("скачанный совпадающий файл — «скачано» без «Обновить»", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("bartowski/Qwen3-32B-GGUF")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByText("bartowski/Qwen3-32B-GGUF"));

    await waitFor(() => expect(screen.getByTestId("file-row-Qwen3-32B-Q8_0.gguf")).toHaveTextContent("скачано"));
    expect(screen.queryByText("Обновить")).not.toBeInTheDocument();
  });

  it("изменённый в репозитории файл обновляется кнопкой «Обновить»", async () => {
    mockedGetRepoSync.mockResolvedValue({
      ...SYNC_SAME,
      has_updates: true,
      changed_count: 1,
      files: [{ ...SYNC_SAME.files[0], state: "changed" as const, remote_size: 210 }],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("bartowski/Qwen3-32B-GGUF")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByText("bartowski/Qwen3-32B-GGUF"));
    await waitFor(() => expect(screen.getByTestId("update-file-Qwen3-32B-Q8_0.gguf")).toBeInTheDocument());
    expect(screen.getByTestId("meta-updates")).toHaveTextContent("есть обновления");

    await user.click(screen.getByTestId("update-file-Qwen3-32B-Q8_0.gguf"));

    await waitFor(() =>
      expect(mockedRefreshVariant).toHaveBeenCalledWith(1, "bartowski/Qwen3-32B-GGUF", "Qwen3-32B-Q8_0.gguf")
    );
  });

  it("нескачанная модель не сверяется с репозиторием", async () => {
    mockedGetModelDetail.mockResolvedValue({
      ...MODEL_DETAIL,
      files: MODEL_DETAIL.files.map((f) => ({ ...f, downloaded: false, local_size: null })),
      local_bytes: 0,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("bartowski/Qwen3-32B-GGUF")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByText("bartowski/Qwen3-32B-GGUF"));

    await waitFor(() => expect(screen.getByTestId("meta-status")).toHaveTextContent("не установлена"));
    expect(screen.getByTestId("meta-updates")).toHaveTextContent("—");
    expect(mockedGetRepoSync).not.toHaveBeenCalled();
  });
});

describe("ModelSearchPage — «Скачать» у суммарного объёма", () => {
  it("одна кнопка в строке объёма ставит на закачку только нескачанные файлы", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("bartowski/Qwen3-32B-GGUF")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByText("bartowski/Qwen3-32B-GGUF"));
    await waitFor(() => expect(screen.getByTestId("download-full-repo")).toBeInTheDocument());
    expect(screen.getAllByTestId("download-full-repo")).toHaveLength(1);
    expect(screen.getByTestId("download-full-repo")).toHaveTextContent("Скачать");

    const totalRow = screen.getByText(/Суммарный занимаемый объём/).closest("div")!.parentElement!;
    expect(totalRow.contains(screen.getByTestId("download-full-repo"))).toBe(true);

    await user.click(screen.getByTestId("download-full-repo"));

    await waitFor(() =>
      expect(mockedCreateDownload).toHaveBeenCalledWith({
        provider_id: 1,
        model_ref: "bartowski/Qwen3-32B-GGUF",
        variant_label: "",
        files: [{ filename: "Qwen3-32B-Q4_K_M.gguf", size: 100 }],
      })
    );
  });

  it("sends every file when none of them are downloaded yet", async () => {
    mockedGetModelDetail.mockResolvedValue({
      ...MODEL_DETAIL,
      files: MODEL_DETAIL.files.map((f) => ({ ...f, downloaded: false, local_size: null })),
      local_bytes: 0,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("bartowski/Qwen3-32B-GGUF")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByText("bartowski/Qwen3-32B-GGUF"));
    await waitFor(() => expect(screen.getByTestId("download-full-repo")).toBeInTheDocument());

    await user.click(screen.getByTestId("download-full-repo"));

    await waitFor(() =>
      expect(mockedCreateDownload).toHaveBeenCalledWith({
        provider_id: 1,
        model_ref: "bartowski/Qwen3-32B-GGUF",
        variant_label: "",
        files: [
          { filename: "Qwen3-32B-Q4_K_M.gguf", size: 100 },
          { filename: "Qwen3-32B-Q8_0.gguf", size: 200 },
        ],
      })
    );
  });

  it("репозиторий без GGUF скачивается целиком той же кнопкой", async () => {
    mockedGetModelDetail.mockResolvedValue({
      ...MODEL_DETAIL,
      variants: [],
      repo_format: null,
      supporting_engines: [],
      files: [
        { filename: "qwen3_8_27b.ninfer", size: 1000, downloaded: false, local_size: null, disk_sufficient: true },
        { filename: "LICENSE", size: 10, downloaded: false, local_size: null, disk_sufficient: true },
      ],
      local_bytes: 0,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("bartowski/Qwen3-32B-GGUF")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByText("bartowski/Qwen3-32B-GGUF"));
    await waitFor(() => expect(screen.getByTestId("download-full-repo")).toBeInTheDocument());
    expect(screen.getByTestId("meta-support")).toHaveTextContent("не удалось проверить совместимость");

    await user.click(screen.getByTestId("download-full-repo"));

    await waitFor(() =>
      expect(mockedCreateDownload).toHaveBeenCalledWith(
        expect.objectContaining({
          files: [
            { filename: "qwen3_8_27b.ninfer", size: 1000 },
            { filename: "LICENSE", size: 10 },
          ],
        })
      )
    );
  });

  it("hides the button once every file is already downloaded", async () => {
    mockedGetModelDetail.mockResolvedValue({
      ...MODEL_DETAIL,
      files: MODEL_DETAIL.files.map((f) => ({ ...f, downloaded: true, local_size: f.size })),
      local_bytes: 300,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("bartowski/Qwen3-32B-GGUF")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByText("bartowski/Qwen3-32B-GGUF"));
    await waitFor(() => expect(screen.getByTestId("model-detail-panel")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("meta-status")).toHaveTextContent("скачано"));

    expect(screen.queryByTestId("download-full-repo")).not.toBeInTheDocument();
  });

  it("shows an insufficient-disk-space warning next to the total when total_disk_sufficient is false", async () => {
    mockedGetModelDetail.mockResolvedValue({ ...MODEL_DETAIL, total_disk_sufficient: false });
    renderPage();
    await waitFor(() => expect(screen.getByText("bartowski/Qwen3-32B-GGUF")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByText("bartowski/Qwen3-32B-GGUF"));

    await waitFor(() => expect(screen.getByText("недостаточно места на диске")).toBeInTheDocument());
  });
});

describe("ModelSearchPage — закачка не предлагается повторно (download-duplicate-guard)", () => {
  const REPO = "bartowski/Qwen3-32B-GGUF";

  function unfinishedDownload(overrides: Record<string, unknown> = {}) {
    return {
      id: "dl-1",
      provider_id: 1,
      model_ref: REPO,
      target_dir: "/models/huggingface/bartowski/Qwen3-32B-GGUF",
      status: "active",
      downloaded_bytes: 10,
      total_bytes: 100,
      error_message: null,
      file_names: null as string[] | null,
      ...overrides,
    };
  }

  async function openRepoPanel() {
    renderPage();
    await waitFor(() => expect(screen.getByText(REPO)).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByText(REPO));
    await waitFor(() => expect(screen.getByTestId("model-detail-panel")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("model-card")).toHaveTextContent("Суммарный занимаемый объём"));
    return user;
  }

  it("пока закачка модели идёт, вместо «Скачать» — её состояние, у файлов кнопок нет", async () => {
    mockedListDownloads.mockResolvedValue([unfinishedDownload()]);

    await openRepoPanel();

    expect(screen.queryByTestId("download-full-repo")).not.toBeInTheDocument();
    expect(screen.getByTestId("repo-task-state")).toHaveTextContent("качается");
    expect(screen.queryByTestId("download-file-Qwen3-32B-Q4_K_M.gguf")).not.toBeInTheDocument();
    expect(screen.getByTestId("meta-status")).toHaveTextContent("качается 10%");
  });

  it.each([
    ["queued", "в очереди"],
    ["paused", "на паузе"],
  ])("для статуса %s показано «%s»", async (status, label) => {
    mockedListDownloads.mockResolvedValue([unfinishedDownload({ status })]);

    await openRepoPanel();

    expect(screen.queryByTestId("download-full-repo")).not.toBeInTheDocument();
    expect(screen.getByTestId("repo-task-state")).toHaveTextContent(label);
  });

  it("завершившаяся закачка «Скачать» не блокирует", async () => {
    mockedListDownloads.mockResolvedValue([unfinishedDownload({ status: "failed" })]);

    await openRepoPanel();

    expect(screen.getByTestId("download-full-repo")).toBeEnabled();
  });

  it("закачка одного файла тоже занимает каталог модели — «Скачать» не предлагается", async () => {
    mockedListDownloads.mockResolvedValue([unfinishedDownload({ file_names: ["Qwen3-32B-Q4_K_M.gguf"] })]);

    await openRepoPanel();

    expect(screen.queryByTestId("download-full-repo")).not.toBeInTheDocument();
    expect(screen.getByTestId("file-row-Qwen3-32B-Q4_K_M.gguf")).toHaveTextContent("качается");
  });

  it("показывает текст отказа оркестратора, а не «Не удалось начать загрузку»", async () => {
    const { ApiError } = await import("../../api/client");
    mockedCreateDownload.mockRejectedValue(
      new ApiError(409, { detail: "в каталог /models/x уже идёт закачка org/model (id dl-1, статус active)" })
    );

    const user = await openRepoPanel();
    await user.click(screen.getByTestId("download-full-repo"));

    await waitFor(() => expect(screen.getByText(/уже идёт закачка org\/model/)).toBeInTheDocument());
  });
});

describe("ModelSearchPage — статус скачивания в результатах (search-results-download-status)", () => {
  const REPO = "bartowski/Qwen3-32B-GGUF";

  async function waitResults() {
    renderPage();
    await waitFor(() => expect(screen.getByText(REPO)).toBeInTheDocument());
  }

  it("без закачек и моделей бейдж не показывается", async () => {
    await waitResults();
    expect(screen.queryByTestId("result-download-status")).not.toBeInTheDocument();
  });

  it("зарегистрированная модель помечается «скачан»", async () => {
    mockedListModels.mockResolvedValue([
      { id: 1, provider_id: 1, ref: REPO, file_path: "/m", format: "gguf", metadata: {}, favorite: false, validity: { usable: true, reason: null } },
    ]);
    await waitResults();

    const badges = screen.getAllByTestId("result-download-status");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent("скачан");
  });

  it("незавершённая закачка помечается «скачивается»", async () => {
    mockedListDownloads.mockResolvedValue([
      { id: "dl-1", provider_id: 1, model_ref: REPO, target_dir: "/m", status: "active", downloaded_bytes: 1, total_bytes: 2, error_message: null, file_names: null },
    ]);
    await waitResults();

    const badge = screen.getByTestId("result-download-status");
    expect(badge).toHaveTextContent("скачивается");
  });

  it("идущая закачка приоритетнее регистрации", async () => {
    mockedListModels.mockResolvedValue([
      { id: 1, provider_id: 1, ref: REPO, file_path: "/m", format: "gguf", metadata: {}, favorite: false, validity: { usable: true, reason: null } },
    ]);
    mockedListDownloads.mockResolvedValue([
      { id: "dl-1", provider_id: 1, model_ref: REPO, target_dir: "/m", status: "paused", downloaded_bytes: 1, total_bytes: 2, error_message: null, file_names: null },
    ]);
    await waitResults();

    expect(screen.getByTestId("result-download-status")).toHaveTextContent("скачивается");
  });
});

describe("ModelSearchPage — статусы дозапросом, без постоянного опроса", () => {
  it("не опрашивает состояния, пока пользователь ничего не делает", async () => {
    vi.useFakeTimers();
    try {
      renderPage();
      await vi.advanceTimersByTimeAsync(0);  // первичная загрузка и поиск
      const afterSearch = mockedListDownloads.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10000);  // пять тиков прежнего опроса

      expect(mockedListDownloads.mock.calls.length).toBe(afterSearch);
    } finally {
      vi.useRealTimers();
    }
  });

  it("запрашивает состояния после поиска — до отрисовки результатов", async () => {
    renderPage();

    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    // Статусы берутся тем же дозапросом: список задач и список моделей.
    await waitFor(() => expect(mockedListDownloads).toHaveBeenCalled());
    expect(vi.mocked(orchestratorApi.listModels)).toHaveBeenCalled();
  });
});

describe("ModelSearchPage — плитка модели", () => {
  it("результат без полученных деталей не показывает строку вариантов", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("bartowski/Qwen3-32B-GGUF")).toBeInTheDocument());
    expect(screen.queryByTestId("launch-variants")).not.toBeInTheDocument();
  });

  it("раскрытый результат показывает варианты из полученных деталей", async () => {
    mockedGetModelDetail.mockResolvedValue({
      ...MODEL_DETAIL,
      features: ["mmproj"],
      variants: [
        { ...MODEL_DETAIL.variants[0], quant_label: "IQ3_XXS" },
        { ...MODEL_DETAIL.variants[0], filename: "b.gguf", quant_label: "Q2_0" },
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("bartowski/Qwen3-32B-GGUF")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("model-tile-bartowski/Qwen3-32B-GGUF"));

    await waitFor(() => expect(screen.getByTestId("launch-variants")).toHaveTextContent("IQ3_XXS Q2_0 +mmproj"));
  });
});
