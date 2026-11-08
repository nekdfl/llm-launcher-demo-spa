import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/orchestrator", () => ({
  orchestratorApi: {
    getNumaTopology: vi.fn().mockResolvedValue({ "0": [0, 1] }),
    getHardwareInfo: vi.fn().mockResolvedValue({
      cpu: { model_name: "X", core_count: 4 },
      ram: { total_bytes: 16 * 1024**3, available_bytes: 8 * 1024**3 },
      numa_topology: { "0": [0, 1] },
      gpus: null,
      nvml_error: "nvidia-smi недоступен",
    }),
    getResourceSettings: vi.fn().mockResolvedValue({
      cpu_pool: [0, 1], gpu_pool: [0], port_range_start: 8080, port_range_end: 8180,
      disk_ceiling_bytes_per_sec: 100, net_ceiling_bytes_per_sec: 100,
    }),
    getDownloadSettings: vi.fn().mockResolvedValue({ models_dir: "/models" }),
    updateDownloadSettings: vi.fn(),
    relocateModels: vi.fn(),
    getAssistantSettings: vi.fn().mockResolvedValue({ router_base_url: "", model: "", has_api_key: false, configured: false }),
    getHistorySettings: vi.fn().mockResolvedValue({
      max_records_per_profile: 50, max_total_log_bytes: 1000000, max_log_age_days: 30, max_log_files: 50,
    }),
    updateHistorySettings: vi.fn().mockResolvedValue({
      max_records_per_profile: 50, max_total_log_bytes: 1000000, max_log_age_days: 14, max_log_files: 20,
    }),
    getRequestLogSettings: vi.fn().mockResolvedValue({ max_records: 1000 }),
    updateRequestLogSettings: vi.fn().mockResolvedValue({ max_records: 1000 }),
    getAuditSettings: vi.fn().mockResolvedValue({ max_records: 20000 }),
    updateAuditSettings: vi.fn().mockResolvedValue({ max_records: 20000 }),
    getMetricsSettings: vi.fn().mockResolvedValue({ raw_retention_hours: 6, aggregate_retention_days: 30 }),
    updateMetricsSettings: vi.fn().mockResolvedValue({ raw_retention_hours: 6, aggregate_retention_days: 30 }),
  },
}));
vi.mock("../../api/accounts", () => ({
  accountsApi: { isAdmin: vi.fn().mockResolvedValue(true), listUsers: vi.fn().mockResolvedValue([{ id: 1, username: "admin", role: "admin", is_active: true }]), updateUser: vi.fn(), createUser: vi.fn() },
}));

import { SettingsPage } from "./SettingsPage";
import { UsersSettingsPage, ModelsDirSettingsPage, NetworkSettingsPage, CpuGpuSettingsPage, InferenceSettingsPage } from "./SettingsSubPages";
import { AssistantSettingsPage } from "./AssistantSettingsPage";

function renderAt(path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path={path} element={element} />
      </Routes>
    </MemoryRouter>
  );
}

describe("settings hub", () => {
  it("every bento card is a route link (§1: отдельная страница)", async () => {
    renderAt("/settings", <SettingsPage />);
    await waitFor(() => expect(screen.getAllByRole("link").length).toBeGreaterThanOrEqual(5));
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const expected of ["/settings/users", "/settings/models-dir", "/settings/network", "/settings/cpu-gpu", "/settings/assistant"]) {
      expect(hrefs).toContain(expected);
    }
    // The overview has no editable fields — inputs live on subpages.
    expect(screen.queryByTestId("models-dir-input")).not.toBeInTheDocument();
  });
});

describe("settings subpages", () => {
  it("users page shows the users table with a back link", async () => {
    renderAt("/settings/users", <UsersSettingsPage />);
    expect(screen.getByText("← Настройки")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Заблокировать")).toBeInTheDocument());
  });

  it("models-dir page renders the editable path", async () => {
    renderAt("/settings/models-dir", <ModelsDirSettingsPage />);
    await waitFor(() => expect(screen.getByDisplayValue("/models")).toBeInTheDocument());
  });

  it("network page renders the port range", async () => {
    renderAt("/settings/network", <NetworkSettingsPage />);
    await waitFor(() => expect(screen.getByDisplayValue("8080")).toBeInTheDocument());
    expect(screen.getByDisplayValue("8180")).toBeInTheDocument();
  });

  it("cpu-gpu page renders pools and numa topology", async () => {
    renderAt("/settings/cpu-gpu", <CpuGpuSettingsPage />);
    await waitFor(() => expect(screen.getByTestId("cpu-checkbox-0")).toBeInTheDocument());
    expect(screen.getByTestId("cpu-checkbox-0")).toBeChecked();
    expect(screen.getByTestId("cpu-checkbox-1")).toBeChecked();
  });

  it("assistant page renders the configured badge", async () => {
    renderAt("/settings/assistant", <AssistantSettingsPage />);
    await waitFor(() => expect(screen.getByTestId("assistant-settings")).toBeInTheDocument());
    expect(screen.getByText("← Настройки")).toBeInTheDocument();
  });
});

describe("ModelsDirSettingsPage — осиротевшие записи", () => {
  it("предупреждает о записях в прежнем каталоге и переводит их", async () => {
    const { orchestratorApi } = await import("../../api/orchestrator");
    vi.mocked(orchestratorApi.updateDownloadSettings).mockResolvedValue({
      models_dir: "/data/models",
      rate_limit_bytes_per_sec: 0,
      max_concurrent_downloads: 1,
      orphaned_models: 3,
      previous_models_dir: "/models",
    } as never);
    vi.mocked(orchestratorApi.relocateModels).mockResolvedValue({ moved: [{}, {}, {}], skipped: [] } as never);
    renderAt("/settings/models-dir", <ModelsDirSettingsPage />);
    await waitFor(() => expect(screen.getByDisplayValue("/models")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByText("Сохранить"));

    const warning = await screen.findByTestId("orphaned-models-warning");
    expect(warning).toHaveTextContent("3");

    await user.click(screen.getByTestId("relocate-models"));

    await waitFor(() => expect(orchestratorApi.relocateModels).toHaveBeenCalledWith("/models"));
    // Все записи нашлись — предупреждение снято.
    await waitFor(() => expect(screen.queryByTestId("orphaned-models-warning")).not.toBeInTheDocument());
  });
});


describe("InferenceSettingsPage — хранение журналов запусков", () => {
  it("показывает действующую политику, а не пустые заготовки", async () => {
    render(
      <MemoryRouter initialEntries={["/settings/inference"]}>
        <Routes>
          <Route path="/settings/inference" element={<InferenceSettingsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByTestId("max-log-age-days")).toHaveValue("30"));
    expect(screen.getByTestId("max-log-files")).toHaveValue("50");
  });

  it("сохранение отправляет новую политику журналов", async () => {
    const { orchestratorApi } = await import("../../api/orchestrator");
    render(
      <MemoryRouter initialEntries={["/settings/inference"]}>
        <Routes>
          <Route path="/settings/inference" element={<InferenceSettingsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByTestId("max-log-age-days")).toHaveValue("30"));

    await userEvent.clear(screen.getByTestId("max-log-age-days"));
    await userEvent.type(screen.getByTestId("max-log-age-days"), "14");
    await userEvent.clear(screen.getByTestId("max-log-files"));
    await userEvent.type(screen.getByTestId("max-log-files"), "20");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(orchestratorApi.updateHistorySettings).toHaveBeenCalledWith({
        max_log_age_days: 14,
        max_log_files: 20,
      })
    );
  });
});
