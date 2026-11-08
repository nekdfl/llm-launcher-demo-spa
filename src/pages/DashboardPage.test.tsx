import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPage, sortByRecentLaunch } from "./DashboardPage";
import { orchestratorApi } from "../api/orchestrator";
import { gpuStatusEntry } from "../api/__fixtures__/gpuStatus";
import { inferenceEntry } from "../api/__fixtures__/inference";
import type { Inference } from "../api/types";

vi.mock("../api/orchestrator", () => ({
  orchestratorApi: {
    listModels: vi.fn().mockResolvedValue([]),
    listProfiles: vi.fn().mockResolvedValue([]),
    listProviders: vi.fn().mockResolvedValue([]),
    listEngineInstallations: vi.fn().mockResolvedValue([]),
    getResourceSettings: vi.fn().mockResolvedValue({
      cpu_pool: [],
      gpu_pool: [0, 1],
      port_range_start: 20000,
      port_range_end: 20999,
      disk_ceiling_bytes_per_sec: 1,
      net_ceiling_bytes_per_sec: 1,
    }),
    listInferences: vi.fn().mockResolvedValue([]),
    getInferenceStatus: vi.fn(),
    getGpuStatus: vi.fn(),
    getHostLoad: vi.fn().mockResolvedValue({
      cpu_percent: 1,
      ram_percent: 1,
      disk_read_bytes_per_sec: 0,
      disk_write_bytes_per_sec: 0,
      net_recv_bytes_per_sec: 0,
      net_sent_bytes_per_sec: 0,
    }),
    getInferenceThroughput: vi.fn().mockResolvedValue({}),
    // Объём RAM стенда: без него график RAM останется в процентах, поэтому
    // в тестах он задан явно — так проверяется основная ветка.
    getHardwareInfo: vi.fn().mockResolvedValue({
      cpu: { model_name: "test", core_count: 4 },
      ram: { total_bytes: 32 * 1024 ** 3, available_bytes: 16 * 1024 ** 3 },
      numa_topology: {},
      gpus: null,
      nvml_error: null,
    }),
    stopAllInferences: vi.fn(),
    getHostLoadHistory: vi.fn().mockResolvedValue({ range: "all", points: [] }),
    getThroughputHistory: vi.fn().mockResolvedValue({ range: "all", points: [] }),
    getGpuPowerHistory: vi.fn().mockResolvedValue({ range: "all", points: [] }),
  },
}));

const mockedGpuStatus = vi.mocked(orchestratorApi.getGpuStatus);

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
}

describe("DashboardPage — устойчивость к недоступности GPU", () => {
  beforeEach(() => {
    mockedGpuStatus.mockReset();
  });

  it("при ошибке getGpuStatus дашборд всё равно рендерится (не застревает на «Загрузка…»)", async () => {
    mockedGpuStatus.mockRejectedValue(new Error("503 nvidia-smi недоступен"));
    renderDashboard();

    // Блок видеокарт отрисован с пометкой недоступности, значит дашборд вышел
    // из состояния загрузки и построил основную разметку.
    await waitFor(() => expect(screen.getByTestId("gpu-unavailable")).toBeInTheDocument());
    expect(screen.queryByText("Загрузка…")).not.toBeInTheDocument();
    expect(screen.getByText("Видеокарты // NVML")).toBeInTheDocument();
  });

  it("при успешном getGpuStatus карточки GPU отображаются, пометки недоступности нет", async () => {
    mockedGpuStatus.mockResolvedValue([gpuStatusEntry()]);
    renderDashboard();

    await waitFor(() => expect(screen.getByTestId("gpu-card-0")).toBeInTheDocument());
    expect(screen.queryByTestId("gpu-unavailable")).not.toBeInTheDocument();
  });
});

const mockedListInferences = vi.mocked(orchestratorApi.listInferences);
const mockedInferenceStatus = vi.mocked(orchestratorApi.getInferenceStatus);

function gpuEntry(gpuId: number, usedBytes: number) {
  return gpuStatusEntry({ gpu_id: gpuId, used_bytes: usedBytes });
}

function inferenceOnGpu(id: string, name: string, gpuIds: number[], overrides: Partial<Inference> = {}) {
  return inferenceEntry({ id, slug: name, name, gpu_ids: gpuIds, port: 20000, ...overrides });
}

describe("DashboardPage — список inferences на карточке GPU", () => {
  beforeEach(() => {
    mockedGpuStatus.mockReset();
    mockedListInferences.mockReset();
    mockedInferenceStatus.mockReset();
    mockedGpuStatus.mockResolvedValue([gpuEntry(0, 20000)]);
    mockedListInferences.mockResolvedValue([
      inferenceOnGpu("uuid-running", "llama-работяга", [0]),
      inferenceOnGpu("uuid-stopped", "qwen-простой", [0]),
      inferenceOnGpu("uuid-other-card", "mistral-на-другой", [1]),
    ]);
    mockedInferenceStatus.mockImplementation(async (id: string) =>
      id === "uuid-running"
        ? { status: "running" as const, color: "green", gpu_considered_free: false }
        : { status: "stopped" as const, color: "gray", gpu_considered_free: true }
    );
  });

  it("клик раскрывает занимающие карту inferences; остановленный в список не попадает", async () => {
    const { container } = renderDashboard();
    await waitFor(() => expect(screen.getByTestId("gpu-card-0")).toBeInTheDocument());

    expect(screen.queryByTestId("gpu-card-inferences-0")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("gpu-card-toggle-0"));

    const list = await screen.findByTestId("gpu-card-inferences-0");
    expect(list).toHaveTextContent("llama-работяга");
    expect(list).toHaveTextContent("работает");
    // Остановленный карту не занимает — его в списке нет.
    expect(list).not.toHaveTextContent("qwen-простой");
    expect(list).not.toHaveTextContent("остановлен");
    // Карта в списке только своя: inference на GPU 1 сюда не попадает.
    expect(list).not.toHaveTextContent("mistral-на-другой");
    expect(container.querySelector("[data-testid='gpu-card-inferences-0'] .tactical-accent")).not.toBeNull();
  });

  it("не отвечающий и упавший inference в списке остаются — они могли не освободить карту", async () => {
    mockedInferenceStatus.mockImplementation(async (id: string) =>
      id === "uuid-running"
        ? { status: "unresponsive" as const, color: "red", gpu_considered_free: false }
        : { status: "failed" as const, color: "red", gpu_considered_free: true }
    );
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("gpu-card-0")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("gpu-card-toggle-0"));

    const list = await screen.findByTestId("gpu-card-inferences-0");
    expect(list).toHaveTextContent("llama-работяга");
    expect(list).toHaveTextContent("перестал отвечать");
    expect(list).toHaveTextContent("qwen-простой");
    expect(list).toHaveTextContent("упал");
  });

  it("повторный клик скрывает список, карточка остаётся на месте", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("gpu-card-0")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("gpu-card-toggle-0"));
    await screen.findByTestId("gpu-card-inferences-0");

    fireEvent.click(screen.getByTestId("gpu-card-toggle-0"));
    await waitFor(() => expect(screen.queryByTestId("gpu-card-inferences-0")).not.toBeInTheDocument());
    expect(screen.getByTestId("gpu-card-0")).toBeInTheDocument();
  });

  it("имя inference в списке ведёт на его страницу", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("gpu-card-0")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("gpu-card-toggle-0"));

    const link = await screen.findByRole("link", { name: "llama-работяга" });
    expect(link).toHaveAttribute("href", "/inferences/uuid-running");
  });

  it("занятая VRAM без моделей на карте объяснена процессами вне стенда", async () => {
    mockedListInferences.mockResolvedValue([]);
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("gpu-card-0")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("gpu-card-toggle-0"));

    const empty = await screen.findByTestId("gpu-card-no-inferences-0");
    expect(empty).toHaveTextContent("VRAM занята процессами вне стенда");
  });
});

describe("DashboardPage — раскладка на узких экранах", () => {
  beforeEach(() => {
    mockedGpuStatus.mockReset().mockResolvedValue([gpuEntry(0, 20000)]);
    mockedListInferences.mockReset().mockResolvedValue([inferenceOnGpu("uuid-running", "llama", [0])]);
    mockedInferenceStatus
      .mockReset()
      .mockResolvedValue({ status: "running", color: "green", gpu_considered_free: false });
  });

  it("плотность сеток поднята на самый широкий breakpoint: графики и плитки по одному, карточки GPU по две", async () => {
    const { container } = renderDashboard();
    await waitFor(() => expect(screen.getByTestId("gpu-card-0")).toBeInTheDocument());

    const grids = [...container.querySelectorAll("div.grid")].map((node) => node.className);
    // График мониторинга: один в ряд до 2xl.
    expect(grids).toContain("grid grid-cols-1 2xl:grid-cols-2 gap-4");
    // Карточки GPU: две в ряд (на телефоне — одна), четыре только на 2xl.
    expect(grids).toContain("grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-4");
    // Плитки inferences: одна в ряд до 2xl.
    expect(grids).toContain("grid grid-cols-1 2xl:grid-cols-3 gap-4");
  });
});

const mockedStopAll = vi.mocked(orchestratorApi.stopAllInferences);

describe("DashboardPage — выгрузить все модели", () => {
  beforeEach(() => {
    mockedGpuStatus.mockReset().mockResolvedValue([gpuEntry(0, 20000)]);
    mockedListInferences.mockReset().mockResolvedValue([inferenceOnGpu("uuid-running", "llama", [0])]);
    mockedInferenceStatus
      .mockReset()
      .mockResolvedValue({ status: "running", color: "green", gpu_considered_free: false });
    mockedStopAll.mockReset().mockResolvedValue({
      units: [
        { unit: "llm-one.service", inference_id: "one", outcome: "stopped", detail: null },
        { unit: "llm-two.service", inference_id: "two", outcome: "killed", detail: null },
      ],
    });
  });

  it("без подтверждения запрос не уходит", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("unload-all")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("unload-all"));

    expect(screen.getByTestId("unload-all-confirm")).not.toHaveAttribute("hidden");
    expect(mockedStopAll).not.toHaveBeenCalled();
  });

  it("после подтверждения выгружает и показывает итог по каждому юниту", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("unload-all")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("unload-all"));
    fireEvent.click(screen.getByTestId("unload-all-confirm-yes"));

    await waitFor(() => expect(mockedStopAll).toHaveBeenCalledTimes(1));
    const report = await screen.findByTestId("unload-all-report");
    expect(report).toHaveTextContent("llm-one.service");
    expect(report).toHaveTextContent("остановлен");
    expect(report).toHaveTextContent("llm-two.service");
    expect(report).toHaveTextContent("завершён принудительно");
  });

  it("пустой итог объяснён словами, а не пустым блоком", async () => {
    mockedStopAll.mockResolvedValue({ units: [] });
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("unload-all")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("unload-all"));
    fireEvent.click(screen.getByTestId("unload-all-confirm-yes"));

    const report = await screen.findByTestId("unload-all-report");
    expect(report).toHaveTextContent("Выгружать было нечего");
  });

  it("кнопка отключена, пока выгрузка выполняется", async () => {
    mockedStopAll.mockReturnValue(new Promise(() => {}) as never);
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("unload-all")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("unload-all"));
    fireEvent.click(screen.getByTestId("unload-all-confirm-yes"));

    await waitFor(() => expect(screen.getByTestId("unload-all")).toBeDisabled());
    expect(screen.getByTestId("unload-all")).toHaveTextContent("Выгрузка…");
  });

  it("ошибка видна рядом с кнопкой, дашборд продолжает работать", async () => {
    mockedStopAll.mockRejectedValue(new Error("409 сокет недоступен"));
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("unload-all")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("unload-all"));
    fireEvent.click(screen.getByTestId("unload-all-confirm-yes"));

    expect(await screen.findByTestId("unload-all-error")).toHaveTextContent("сокет недоступен");
    expect(screen.getByTestId("gpu-card-0")).toBeInTheDocument();
  });
});

const mockedHostLoadHistory = vi.mocked(orchestratorApi.getHostLoadHistory);
const mockedThroughputHistory = vi.mocked(orchestratorApi.getThroughputHistory);

describe("DashboardPage — графики берут историю с сервера", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedGpuStatus.mockReset().mockResolvedValue([gpuEntry(0, 1000)]);
    mockedListInferences.mockReset().mockResolvedValue([]);
    mockedInferenceStatus.mockReset();
    mockedHostLoadHistory.mockReset().mockResolvedValue({
      range: "all",
      points: [
        {
          at: "2026-10-14T09:00:00",
          cpu_percent: 40,
          ram_percent: 50,
          disk_read_bytes_per_sec: 0,
          disk_write_bytes_per_sec: 0,
          net_recv_bytes_per_sec: 0,
          net_sent_bytes_per_sec: 0,
        },
      ],
    });
    mockedThroughputHistory.mockReset().mockResolvedValue({ range: "all", points: [] });
  });

  it("при открытии запрашивает историю за всё время, а не ждёт накопления во вкладке", async () => {
    renderDashboard();

    await waitFor(() => expect(mockedHostLoadHistory).toHaveBeenCalledWith("all"));
    expect(mockedThroughputHistory).toHaveBeenCalledWith("all");
  });

  it("смена диапазона перезапрашивает историю", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("metrics-range")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("metrics-range-24h"));

    await waitFor(() => expect(mockedHostLoadHistory).toHaveBeenCalledWith("24h"));
    expect(mockedThroughputHistory).toHaveBeenCalledWith("24h");
  });

  it("выбранный диапазон запоминается на вкладке", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("metrics-range")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("metrics-range-7d"));

    await waitFor(() => expect(window.localStorage.getItem("llm-launcher.metrics-range")).toBe("7d"));
  });

  it("загруженная история сразу рисуется, а не показывает «недостаточно данных»", async () => {
    const { container } = renderDashboard();

    await waitFor(() => expect(mockedHostLoadHistory).toHaveBeenCalled());
    // Один отсчёт из истории — уже линия: график не ждёт накопления во вкладке.
    await waitFor(() => expect(container.querySelectorAll("[data-testid='chart-line-segment']").length).toBeGreaterThan(0));
  });
});

describe("sortByRecentLaunch", () => {
  const entry = (name: string, lastStartedAt: string | null) =>
    inferenceEntry({ id: name, name, last_started_at: lastStartedAt });

  it("недавно запущенный идёт первым", () => {
    const sorted = sortByRecentLaunch([
      entry("старый", "2026-10-18T17:30:52"),
      entry("свежий", "2026-10-20T11:04:00"),
    ]);

    expect(sorted.map((i) => i.name)).toEqual(["свежий", "старый"]);
  });

  it("никогда не запускавшийся идёт после запускавшихся", () => {
    const sorted = sortByRecentLaunch([
      entry("никогда", null),
      entry("запускался", "2026-10-18T17:30:52"),
    ]);

    expect(sorted.map((i) => i.name)).toEqual(["запускался", "никогда"]);
  });

  it("при равных временах порядок задаёт имя, а не порядок ответа", () => {
    const first = sortByRecentLaunch([entry("бета", null), entry("альфа", null)]);
    const second = sortByRecentLaunch([entry("альфа", null), entry("бета", null)]);

    expect(first.map((i) => i.name)).toEqual(["альфа", "бета"]);
    expect(second.map((i) => i.name)).toEqual(first.map((i) => i.name));
  });

  it("повторный опрос с теми же данными не перетряхивает список", () => {
    const inferences = [entry("a", "2026-10-20T11:04:00"), entry("b", "2026-10-19T10:00:00")];

    expect(sortByRecentLaunch(inferences).map((i) => i.id)).toEqual(
      sortByRecentLaunch(inferences).map((i) => i.id)
    );
  });
});

describe("DashboardPage — пики в плитке", () => {
  beforeEach(() => {
    mockedGpuStatus.mockReset().mockResolvedValue([]);
    mockedListInferences.mockReset().mockResolvedValue([
      inferenceOnGpu("uuid-peaks", "модель-с-пиками", [0], {
        last_run_peak_vram_bytes: 62102962176,
        last_run_peak_ram_bytes: 29139095552,
      }),
    ]);
    mockedInferenceStatus.mockReset().mockResolvedValue({
      status: "running" as const,
      color: "green",
      gpu_considered_free: false,
    });
  });

  it("плитка показывает пики из ответа списка inferences", async () => {
    renderDashboard();

    await waitFor(() => expect(screen.getByTestId("tile-peak-vram")).toHaveTextContent("57.8 GB"));
    expect(screen.getByTestId("tile-peak-ram")).toHaveTextContent("27.1 GB");
  });
});

describe("DashboardPage — график мощности GPU", () => {
  beforeEach(() => {
    mockedGpuStatus.mockReset().mockResolvedValue([]);
    mockedListInferences.mockReset().mockResolvedValue([]);
    mockedInferenceStatus.mockReset().mockResolvedValue({
      status: "stopped" as const,
      color: "gray" as const,
      gpu_considered_free: true,
    });
    vi.mocked(orchestratorApi.getResourceSettings)
      .mockReset()
      .mockResolvedValue({
        cpu_pool: [],
        gpu_pool: [0, 1],
        port_range_start: 20000,
        port_range_end: 20999,
        disk_ceiling_bytes_per_sec: 1,
        net_ceiling_bytes_per_sec: 1,
      });
    vi.mocked(orchestratorApi.getGpuPowerHistory)
      .mockReset()
      .mockResolvedValue({ range: "all", points: [] });
  });

  it("при картах в пуле — легенда и график мощности в карточке пропускной способности", async () => {
    renderDashboard();

    await waitFor(() => expect(screen.getByTestId("gpu-power-legend")).toBeInTheDocument());
    // Легенда называет каждую карту из пула.
    expect(screen.getByTestId("gpu-power-legend").textContent).toContain("gpu 0");
    expect(screen.getByTestId("gpu-power-legend").textContent).toContain("gpu 1");
  });

  it("пустой пул GPU — без графика мощности", async () => {
    vi.mocked(orchestratorApi.getResourceSettings).mockResolvedValue({
      cpu_pool: [],
      gpu_pool: [],
      port_range_start: 20000,
      port_range_end: 20999,
      disk_ceiling_bytes_per_sec: 1,
      net_ceiling_bytes_per_sec: 1,
    });

    renderDashboard();

    await waitFor(() => expect(screen.getByText("Видеокарты // NVML")).toBeInTheDocument());
    expect(screen.queryByTestId("gpu-power-legend")).not.toBeInTheDocument();
  });

  it("сбой GPU-телеметрии не роняет карточку пропускной способности", async () => {
    mockedGpuStatus.mockRejectedValue(new Error("503 nvidia-smi недоступен"));

    renderDashboard();

    // Карточка отрисована (график tok/s на месте), график мощности — в
    // пустом состоянии, без данных.
    await waitFor(() => expect(screen.getByTestId("gpu-unavailable")).toBeInTheDocument());
    expect(screen.getByText("Пропускная способность · сумма по всем inferences")).toBeInTheDocument();
    expect(screen.getByTestId("gpu-power-legend")).toBeInTheDocument();
  });
});
