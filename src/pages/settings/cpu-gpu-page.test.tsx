import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CpuGpuSettingsPage } from "./SettingsSubPages";
import { orchestratorApi } from "../../api/orchestrator";

vi.mock("../../api/orchestrator", () => ({
  orchestratorApi: {
    getResourceSettings: vi.fn().mockResolvedValue({
      cpu_pool: [0, 1], gpu_pool: [1], port_range_start: 8080, port_range_end: 8180,
      disk_ceiling_bytes_per_sec: 100, net_ceiling_bytes_per_sec: 100,
    }),
    updateResourceSettings: vi.fn().mockResolvedValue({
      cpu_pool: [0, 1, 2], gpu_pool: [0, 1], port_range_start: 8080, port_range_end: 8180,
      disk_ceiling_bytes_per_sec: 100, net_ceiling_bytes_per_sec: 100,
    }),
    getHardwareInfo: vi.fn(),
  },
}));

const mockedGet = vi.mocked(orchestratorApi.getHardwareInfo);
const mockedUpdate = vi.mocked(orchestratorApi.updateResourceSettings);

beforeEach(() => {
  mockedGet.mockReset();
  mockedUpdate.mockReset().mockResolvedValue({
    cpu_pool: [], gpu_pool: [], port_range_start: 8080, port_range_end: 8180,
    disk_ceiling_bytes_per_sec: 100, net_ceiling_bytes_per_sec: 100,
  });
});

function renderPage() {
  return render(<MemoryRouter><CpuGpuSettingsPage /></MemoryRouter>);
}

describe("CpuGpuSettingsPage (issue #20)", () => {
  it("shows system info block ABOVE the pool picker: cpu model, gpus with names, free RAM", async () => {
    mockedGet.mockResolvedValue({
      cpu: { model_name: "AMD Ryzen 9 7950X", core_count: 32 },
      ram: { total_bytes: 128 * 1024**3, available_bytes: 96 * 1024**3 },
      numa_topology: { "0": [0, 1], "1": [2, 3] },
      gpus: [
        { gpu_id: 0, name: "NVIDIA GeForce RTX 3090", used_bytes: 1024**3, total_bytes: 24 * 1024**3, utilization_percent: 5, temperature_c: 50 },
        { gpu_id: 1, name: "NVIDIA GeForce RTX 3090 Ti", used_bytes: 2 * 1024**3, total_bytes: 24 * 1024**3, utilization_percent: 40, temperature_c: 61 },
      ],
      nvml_error: null,
    });

    const { container } = renderPage();

    await waitFor(() => expect(screen.getByText("Информация о системе")).toBeInTheDocument());
    // Processor model and core count:
    expect(screen.getByText("AMD Ryzen 9 7950X")).toBeInTheDocument();
    expect(screen.getByText("32")).toBeInTheDocument();
    // GPU names visible (name appears in info card and checkbox label):
    expect(screen.getAllByText(/RTX 3090 Ti/).length).toBeGreaterThanOrEqual(1);
    // Free RAM:
    expect(screen.getByText(/96\.0 GB свободно/)).toBeInTheDocument();

    // Info block sits ABOVE the picker (spec: выше блока с выбором):
    const info = screen.getByTestId("hardware-info");
    const picker = screen.getByText("Пул ресурсов");
    expect(container.firstElementChild).not.toBeNull();
    expect(info.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders checkboxes for ALL discovered cpus and gpus, current pool checked", async () => {
    mockedGet.mockResolvedValue({
      cpu: { model_name: "X", core_count: 4 },
      ram: { total_bytes: 16 * 1024**3, available_bytes: 8 * 1024**3 },
      numa_topology: { "0": [0, 1], "1": [2, 3] },
      gpus: [
        { gpu_id: 0, name: "RTX 3090", used_bytes: 0, total_bytes: 24 * 1024**3, utilization_percent: 0, temperature_c: 40 },
        { gpu_id: 1, name: "RTX 3090", used_bytes: 0, total_bytes: 24 * 1024**3, utilization_percent: 0, temperature_c: 40 },
      ],
      nvml_error: null,
    });

    renderPage();
    await waitFor(() => expect(screen.getByTestId("cpu-checkbox-3")).toBeInTheDocument());

    // All 4 cores visible (issue: «список доступных ядер»), 0 and 1 checked (current pool):
    expect(screen.getByTestId("cpu-checkbox-0")).toBeChecked();
    expect(screen.getByTestId("cpu-checkbox-1")).toBeChecked();
    expect(screen.getByTestId("cpu-checkbox-2")).not.toBeChecked();
    expect(screen.getByTestId("cpu-checkbox-3")).not.toBeChecked();
    // GPU 1 checked (current pool), GPU 0 not:
    expect(screen.getByTestId("gpu-checkbox-0")).not.toBeChecked();
    expect(screen.getByTestId("gpu-checkbox-1")).toBeChecked();
  });

  it("toggling checkboxes and saving sends the new pools", async () => {
    mockedGet.mockResolvedValue({
      cpu: { model_name: "X", core_count: 4 },
      ram: { total_bytes: 16 * 1024**3, available_bytes: 8 * 1024**3 },
      numa_topology: { "0": [0, 1] },
      gpus: [
        { gpu_id: 0, name: "RTX 3090", used_bytes: 0, total_bytes: 24 * 1024**3, utilization_percent: 0, temperature_c: 40 },
        { gpu_id: 1, name: "RTX 3090", used_bytes: 0, total_bytes: 24 * 1024**3, utilization_percent: 0, temperature_c: 40 },
      ],
      nvml_error: null,
    });

    renderPage();
    await waitFor(() => expect(screen.getByTestId("cpu-checkbox-1")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("cpu-checkbox-1")); // снять
    await user.click(screen.getByTestId("gpu-checkbox-0")); // добавить GPU 0

    await user.click(screen.getByText("Сохранить"));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    const payload = mockedUpdate.mock.calls[0][0];
    expect(payload.cpu_pool.sort()).toEqual([0]);
    expect(payload.gpu_pool.sort()).toEqual([0, 1]);
  });

  it("degrades without NVML: reason shown, cpu checkboxes still work", async () => {
    mockedGet.mockResolvedValue({
      cpu: { model_name: "X", core_count: 4 },
      ram: { total_bytes: 16 * 1024**3, available_bytes: 8 * 1024**3 },
      numa_topology: { "0": [0, 1] },
      gpus: null,
      nvml_error: "nvidia-smi недоступен: no nvidia-smi",
    });

    renderPage();
    await waitFor(() => expect(screen.getByText(/nvidia-smi недоступен/)).toBeInTheDocument());
    // CPU checkboxes remain usable:
    expect(screen.getByTestId("cpu-checkbox-0")).toBeInTheDocument();
    // GPU checkboxes not rendered:
    expect(screen.queryByTestId("gpu-checkbox-0")).not.toBeInTheDocument();
  });
});
