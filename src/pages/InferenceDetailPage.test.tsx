import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InferenceDetailPage } from "./InferenceDetailPage";
import { orchestratorApi } from "../api/orchestrator";
import { inferenceEntry } from "../api/__fixtures__/inference";

vi.mock("../hooks/useInferenceLogs", () => ({
  useInferenceLogs: () => [],
}));

vi.mock("../api/orchestrator", () => ({
  orchestratorApi: {
    getInference: vi.fn(),
    getProfile: vi.fn().mockResolvedValue({
      id: 1, name: "profile-1", model_id: 1, engine_plugin_id: 1, gpu_ids: [], port: 8090,
      structural_fields: {}, cli_options: "", system_prompt: "", plugin_version: "1.0.0",
      schema_hash: "x", origin_profile_id: null, needs_review: false,
    }),
    getModel: vi.fn().mockResolvedValue({ id: 1, provider_id: 1, ref: "org/model", file_path: "/m", format: "gguf", metadata: {} }),
    getEngineInstallation: vi.fn().mockResolvedValue({
      id: 1, name: "install-1", plugin_id: 1, install_fields: {}, version: "1.0.0", available: true, unavailable_reason: null,
    }),
    listRunsForInference: vi.fn().mockResolvedValue([]),
    getRunLog: vi.fn().mockResolvedValue([]),
    getRunTrace: vi.fn().mockResolvedValue([]),
    getInferenceStatus: vi.fn().mockResolvedValue({ status: "stopped" }),
    getInferenceThroughput: vi.fn().mockResolvedValue({}),
    deleteInference: vi.fn(),
    startInference: vi.fn().mockResolvedValue({ status: "warming" }),
    stopInference: vi.fn().mockResolvedValue({ status: "stopped" }),
    getStopProgress: vi.fn().mockResolvedValue({ progress: "done" }),
    updateInference: vi.fn(),
    getHardwareInfo: vi.fn(),
    getResourceSettings: vi.fn(),
    getThroughputHistory: vi.fn(),
  },
}));

const mockedGetInference = vi.mocked(orchestratorApi.getInference);
const mockedStatus = vi.mocked(orchestratorApi.getInferenceStatus);
const mockedDelete = vi.mocked(orchestratorApi.deleteInference);
const mockedStart = vi.mocked(orchestratorApi.startInference);
const mockedStop = vi.mocked(orchestratorApi.stopInference);
const mockedUpdate = vi.mocked(orchestratorApi.updateInference);
const mockedHardware = vi.mocked(orchestratorApi.getHardwareInfo);
const mockedResourceSettings = vi.mocked(orchestratorApi.getResourceSettings);
const mockedThroughputHistory = vi.mocked(orchestratorApi.getThroughputHistory);

function hardwareGpu(gpuId: number, name: string) {
  return { gpu_id: gpuId, name, used_bytes: 1000, total_bytes: 24000, utilization_percent: 5, temperature_c: 40 };
}

const HARDWARE = {
  cpu: { model_name: "cpu", core_count: 8 },
  ram: { total_bytes: 64, available_bytes: 32 },
  numa_topology: { "0": [0, 1] },
  gpus: [hardwareGpu(0, "RTX 4090"), hardwareGpu(1, "RTX 4090"), hardwareGpu(2, "RTX 3090")],
  nvml_error: null,
};

const RESOURCE_SETTINGS = {
  cpu_pool: [0, 1],
  gpu_pool: [0, 1],
  port_range_start: 20000,
  port_range_end: 20999,
  disk_ceiling_bytes_per_sec: 1,
  net_ceiling_bytes_per_sec: 1,
};

const INFERENCE = inferenceEntry({
  id: "inf-1", slug: "inf-1", name: "inference-1", gpu_ids: [0], port: 8090,
  structural_fields: { driver: "cpu" },
});

function status(label: "stopped" | "running" | "warming" | "unresponsive" | "failed") {
  return { status: label, color: "#fff", gpu_considered_free: label !== "running" };
}

beforeEach(() => {
  mockedGetInference.mockReset().mockResolvedValue(INFERENCE);
  mockedStatus.mockReset().mockResolvedValue(status("stopped"));
  mockedDelete.mockReset().mockResolvedValue(undefined);
  mockedStart.mockReset().mockResolvedValue({ status: "warming" } as never);
  mockedStop.mockReset().mockResolvedValue({ status: "stopped" } as never);
  mockedUpdate.mockReset().mockResolvedValue(INFERENCE as never);
  mockedHardware.mockReset().mockResolvedValue(HARDWARE as never);
  mockedResourceSettings.mockReset().mockResolvedValue(RESOURCE_SETTINGS as never);
  mockedThroughputHistory.mockReset().mockResolvedValue({ range: "all", points: [] } as never);
  window.localStorage.clear();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/inferences/inf-1"]}>
      <Routes>
        <Route path="/" element={<div data-testid="dashboard">dashboard</div>} />
        <Route path="/inferences/:id" element={<InferenceDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("InferenceDetailPage — delete button (was missing entirely)", () => {
  it("deletes a stopped inference and navigates to the dashboard", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Удалить inference")).toBeInTheDocument());
    expect(screen.getByText("Удалить inference")).not.toBeDisabled();

    const user = userEvent.setup();
    await user.click(screen.getByText("Удалить inference"));

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith("inf-1"));
    expect(await screen.findByTestId("dashboard")).toBeInTheDocument();
  });

  it("disables delete while the inference is running", async () => {
    mockedStatus.mockResolvedValue(status("running"));
    renderPage();

    await waitFor(() => expect(screen.getByText("Удалить inference")).toBeDisabled());
  });

  it("disables delete while the inference is warming", async () => {
    mockedStatus.mockResolvedValue(status("warming"));
    renderPage();

    await waitFor(() => expect(screen.getByText("Удалить inference")).toBeDisabled());
  });
});

describe("InferenceDetailPage — lifecycle controls (inference-action-feedback)", () => {
  it("shows a dedicated current-status field", async () => {
    mockedStatus.mockResolvedValue(status("stopped"));
    renderPage();

    await waitFor(() => expect(screen.getByTestId("inference-status-label")).toHaveTextContent("остановлен"));
  });

  it("when stopped: Start enabled, Stop and Restart disabled", async () => {
    mockedStatus.mockResolvedValue(status("stopped"));
    renderPage();

    await waitFor(() => expect(screen.getByTestId("action-start")).toBeEnabled());
    expect(screen.getByTestId("action-stop")).toBeDisabled();
    expect(screen.getByTestId("action-restart")).toBeDisabled();
  });

  it("when running: Stop and Restart enabled, Start disabled", async () => {
    mockedStatus.mockResolvedValue(status("running"));
    renderPage();

    await waitFor(() => expect(screen.getByTestId("action-stop")).toBeEnabled());
    expect(screen.getByTestId("action-restart")).toBeEnabled();
    expect(screen.getByTestId("action-start")).toBeDisabled();
  });

  it("Start calls startInference and shows feedback near the buttons", async () => {
    mockedStatus.mockResolvedValue(status("stopped"));
    renderPage();

    await waitFor(() => expect(screen.getByTestId("action-start")).toBeEnabled());
    const user = userEvent.setup();
    await user.click(screen.getByTestId("action-start"));

    await waitFor(() => expect(mockedStart).toHaveBeenCalledWith("inf-1"));
    await waitFor(() => expect(screen.getByTestId("action-feedback")).toHaveTextContent("Запуск выполнен"));
  });

  it("Restart of a stopped inference starts without waiting on stop-progress", async () => {
    mockedStatus.mockResolvedValue(status("running"));
    renderPage();

    // Restart is only enabled while running; click it, then it should stop+start.
    await waitFor(() => expect(screen.getByTestId("action-restart")).toBeEnabled());
    const user = userEvent.setup();
    await user.click(screen.getByTestId("action-restart"));

    await waitFor(() => expect(mockedStop).toHaveBeenCalledWith("inf-1"));
    await waitFor(() => expect(mockedStart).toHaveBeenCalledWith("inf-1"));
  });
});

describe("InferenceDetailPage — остановка доступна, пока ресурсы не освобождены", () => {
  for (const label of ["unresponsive", "failed"] as const) {
    it(`в статусе ${label} «Остановить» активна и вызывает stopInference, «Запустить» отключена`, async () => {
      mockedStatus.mockResolvedValue(status(label));
      renderPage();

      await waitFor(() => expect(screen.getByTestId("action-stop")).toBeEnabled());
      expect(screen.getByTestId("action-restart")).toBeEnabled();
      expect(screen.getByTestId("action-start")).toBeDisabled();

      const user = userEvent.setup();
      await user.click(screen.getByTestId("action-stop"));
      await waitFor(() => expect(mockedStop).toHaveBeenCalledWith("inf-1"));
    });
  }
});

describe("InferenceDetailPage — индикатор статуса линией", () => {
  it("зелёная линия, когда работает", async () => {
    mockedStatus.mockResolvedValue(status("running"));
    renderPage();

    await waitFor(() => expect(screen.getByTestId("inference-status-line")).toHaveClass("tactical-accent"));
  });

  it("жёлтая линия на прогреве", async () => {
    mockedStatus.mockResolvedValue(status("warming"));
    renderPage();

    await waitFor(() => expect(screen.getByTestId("inference-status-line")).toHaveClass("tactical-accent-warn"));
  });

  it("красная линия, когда остановлен", async () => {
    mockedStatus.mockResolvedValue(status("stopped"));
    renderPage();

    await waitFor(() => expect(screen.getByTestId("inference-status-line")).toHaveClass("tactical-accent-danger"));
  });

  it("жёлтая линия, пока остановка выполняется", async () => {
    mockedStatus.mockResolvedValue(status("running"));
    // Остановка «залипает» в полёте — линия должна показывать промежуточную
    // стадию, которой нет среди статусов оркестратора.
    mockedStop.mockReturnValue(new Promise(() => {}) as never);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("action-stop")).toBeEnabled());
    const user = userEvent.setup();
    await user.click(screen.getByTestId("action-stop"));

    await waitFor(() => expect(screen.getByTestId("inference-status-line")).toHaveClass("tactical-accent-warn"));
  });
});

describe("InferenceDetailPage — выбор карт чекбоксами из пула", () => {
  it("отмечены карты текущего inference", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId("gpu-checkbox-0")).toBeChecked());
    expect(screen.getByTestId("gpu-checkbox-1")).not.toBeChecked();
  });

  it("карты вне пула не предлагаются", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId("gpu-checkbox-1")).toBeInTheDocument());
    // GPU 2 есть на стенде, но не в пуле — выбрать её нельзя.
    expect(screen.queryByTestId("gpu-checkbox-2")).not.toBeInTheDocument();
  });

  it("уже назначенная карта вне пула остаётся выбранной и помечена", async () => {
    mockedGetInference.mockResolvedValue({ ...INFERENCE, gpu_ids: [0, 2] });
    renderPage();

    await waitFor(() => expect(screen.getByTestId("gpu-checkbox-2")).toBeChecked());
    expect(screen.getByTestId("gpu-out-of-pool-2")).toHaveTextContent("вне пула");
  });

  it("изменённый набор карт уходит в сохранение", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("gpu-checkbox-1")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("gpu-checkbox-1"));
    await user.click(screen.getByTestId("gpu-checkbox-0"));
    await user.click(screen.getByText("Сохранить"));

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith("inf-1", expect.objectContaining({ gpu_ids: [1] }))
    );
  });

  it("сохраняет признак reasoning и модальности ввода", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Reasoning")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Reasoning"));
    await user.click(screen.getByLabelText("image"));
    await user.click(screen.getByText("Сохранить"));

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith(
        "inf-1",
        expect.objectContaining({ reasoning: true, input_modalities: ["text", "image"] })
      )
    );
  });

  it("при недоступном NVML карты пула всё равно выбираются", async () => {
    mockedHardware.mockResolvedValue({ ...HARDWARE, gpus: null, nvml_error: "NVML недоступен" } as never);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("gpu-checkbox-0")).toBeChecked());
    expect(screen.getByTestId("gpu-checkbox-1")).toBeInTheDocument();
    expect(screen.getByTestId("gpu-checklist-nvml-error")).toHaveTextContent("NVML недоступен");
  });
});

describe("InferenceDetailPage — график берёт историю этого inference", () => {
  it("при открытии запрашивает историю именно этого inference за всё время", async () => {
    renderPage();

    await waitFor(() => expect(mockedThroughputHistory).toHaveBeenCalledWith("all", ["inf-1"]));
  });

  it("смена диапазона перезапрашивает ряд", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("metrics-range")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("metrics-range-1h"));

    await waitFor(() => expect(mockedThroughputHistory).toHaveBeenCalledWith("1h", ["inf-1"]));
  });

  it("история рисуется сразу, с разрывом за время простоя", async () => {
    mockedThroughputHistory.mockResolvedValue({
      range: "24h",
      points: [
        { at: "2026-10-14T06:00:00", tokens_in_per_sec: 10, tokens_out_per_sec: 2 },
        { at: "2026-10-14T06:00:05", tokens_in_per_sec: 12, tokens_out_per_sec: 3 },
        // Провал: inference был остановлен несколько часов.
        { at: "2026-10-14T11:00:00", tokens_in_per_sec: 8, tokens_out_per_sec: 1 },
        { at: "2026-10-14T11:00:05", tokens_in_per_sec: 9, tokens_out_per_sec: 1 },
      ],
    } as never);

    const { container } = renderPage();

    await waitFor(() => expect(mockedThroughputHistory).toHaveBeenCalled());
    // Два отрезка на серию вместо одной прямой через провал.
    await waitFor(() =>
      expect(container.querySelectorAll("[data-testid='chart-line-segment']").length).toBeGreaterThanOrEqual(4)
    );
  });
});

describe("InferenceDetailPage — негодная модель", () => {
  it("запуск выключен с подсказкой причины", async () => {
    mockedStatus.mockResolvedValue(status("stopped"));
    mockedGetInference.mockResolvedValue({
      ...INFERENCE,
      model_validity: { usable: false, reason: "файл отсутствует" },
    } as never);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("action-start")).toBeDisabled());
    expect(screen.getByTestId("action-start")).toHaveAttribute("title", "модель негодна: файл отсутствует");
  });
});

describe("InferenceDetailPage — связи с моделью и профилем", () => {
  it("называет модель и профиль ссылками на их страницы", async () => {
    renderPage();

    const modelLink = await screen.findByTestId("inference-model-link");
    expect(modelLink.querySelector("a")).toHaveAttribute("href", "/models/1");

    const profileLink = screen.getByTestId("inference-profile-link");
    expect(profileLink.querySelector("a")).toHaveAttribute("href", "/profiles/1");
  });
});


describe("InferenceDetailPage — журналы запусков", () => {
  const finishedRun = {
    id: 63,
    inference_id: "inf-1",
    profile_id: 1,
    engine_installation_id: 1,
    engine_installation_version: "0.5.0",
    gpu_ids: [0],
    port: 8090,
    started_at: "2026-10-20T11:04:00",
    stopped_at: "2026-10-20T17:05:00",
    outcome: "stopped" as const,
    peak_vram_bytes: null,
    peak_ram_bytes: null,
    initiated_by: null,
    log_file_path: "/logs/63.log.gz",
  };

  beforeEach(() => {
    vi.mocked(orchestratorApi.listRunsForInference).mockReset().mockResolvedValue([finishedRun]);
    vi.mocked(orchestratorApi.getRunLog).mockReset().mockResolvedValue(["строка архива"]);
  });

  it("запуски различимы временем старта и исходом", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId("run-select")).toBeInTheDocument());
    expect(screen.getByRole("option", { name: /остановлен/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Текущий запуск" })).toBeInTheDocument();
  });

  it("выбор завершённого запуска показывает его архивный журнал", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId("run-select")).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByTestId("run-select"), "63");

    await waitFor(() => expect(screen.getByTestId("log-view")).toHaveTextContent("строка архива"));
    expect(orchestratorApi.getRunLog).toHaveBeenCalledWith(63);
  });

  it("запуск без журнала объяснён, а не показан пустым списком строк", async () => {
    vi.mocked(orchestratorApi.getRunLog).mockResolvedValue([]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("run-select")).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByTestId("run-select"), "63");

    await waitFor(() => expect(screen.getByTestId("run-log-absent")).toBeInTheDocument());
  });

  it("trace переключается и сохраняется с пометкой о следующем запуске", async () => {
    mockedUpdate.mockResolvedValue({ ...INFERENCE, trace: true } as never);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("trace-toggle")).toBeInTheDocument());
    expect(screen.getByTestId("trace-note")).toHaveTextContent("перезапуск не нужен");

    await userEvent.click(screen.getByTestId("trace-toggle"));
    await userEvent.click(screen.getAllByRole("button", { name: "Сохранить" })[0]);

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith("inf-1", expect.objectContaining({ trace: true }))
    );
  });
});


describe("InferenceDetailPage — сохранённые запросы (trace)", () => {
  const finishedRun = {
    id: 70,
    inference_id: "inf-1",
    profile_id: 1,
    engine_installation_id: 1,
    engine_installation_version: "0.5.0",
    gpu_ids: [0],
    port: 8090,
    started_at: "2026-10-20T11:04:00",
    stopped_at: "2026-10-20T17:05:00",
    outcome: "stopped" as const,
    peak_vram_bytes: null,
    peak_ram_bytes: null,
    initiated_by: null,
    log_file_path: "/logs/70.log.gz",
  };

  beforeEach(() => {
    vi.mocked(orchestratorApi.listRunsForInference).mockReset().mockResolvedValue([finishedRun]);
    vi.mocked(orchestratorApi.getRunLog).mockReset().mockResolvedValue(["строка журнала"]);
  });

  it("показывает сохранённые запросы отдельно от журнала процесса", async () => {
    vi.mocked(orchestratorApi.getRunTrace).mockReset().mockResolvedValue([
      { at: "2026-10-20T18:00:00+00:00", request: { messages: [{ role: "user", content: "вопрос" }] }, response: { choices: [] } },
    ]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("run-select")).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByTestId("run-select"), "70");

    await waitFor(() => expect(screen.getByTestId("run-trace-view")).toHaveTextContent("вопрос"));
    // Журнал процесса остался своим блоком.
    expect(screen.getByTestId("log-view")).toHaveTextContent("строка журнала");
  });

  it("запуск без сохранённых запросов объяснён", async () => {
    vi.mocked(orchestratorApi.getRunTrace).mockReset().mockResolvedValue([]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("run-select")).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByTestId("run-select"), "70");

    await waitFor(() => expect(screen.getByTestId("run-trace-absent")).toBeInTheDocument());
  });
});
