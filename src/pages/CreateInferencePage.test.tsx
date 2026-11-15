import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateInferencePage } from "./CreateInferencePage";
import { orchestratorApi } from "../api/orchestrator";
import { profileEntry } from "../api/__fixtures__/profile";

vi.mock("../api/orchestrator", () => ({
  orchestratorApi: {
    listPlugins: vi.fn().mockResolvedValue([]),
    getHardwareInfo: vi.fn().mockResolvedValue({ gpus: [], cpus: [], nvml_error: null }),
    getResourceSettings: vi.fn().mockResolvedValue({ gpu_pool: [0, 1] }),
    getPluginSchema: vi.fn().mockResolvedValue({ install_schema: [], profile_schema: [] }),
    listModels: vi.fn(),
    listProfiles: vi.fn(),
    createInference: vi.fn(),
  },
}));

const MODELS = [
  // Порядок — как его отдаёт оркестратор: избранные первыми.
  {
    id: 2,
    provider_id: 1,
    ref: "org/favorite",
    file_path: "/m/f/model-Q4_K_M.gguf",
    format: "gguf",
    metadata: { quantization: "Q4_K_M" },
    favorite: true,
    validity: { usable: true, reason: null },
  },
  {
    id: 1,
    provider_id: 1,
    ref: "org/plain",
    file_path: "/m/p/model-Q2_0.gguf",
    format: "gguf",
    metadata: { quantization: "Q2_0" },
    favorite: false,
    validity: { usable: true, reason: null },
  },
  // Второй вариант того же репозитория, зарегистрированный позже —
  // должен встать рядом со своим, а не в конец перечня.
  {
    id: 3,
    provider_id: 1,
    ref: "org/favorite",
    file_path: "/m/f/model-Q2_0.gguf",
    format: "gguf",
    metadata: { quantization: "Q2_0" },
    favorite: false,
    validity: { usable: true, reason: null },
  },
];

beforeEach(() => {
  vi.mocked(orchestratorApi.listModels).mockReset().mockResolvedValue(MODELS as never);
  vi.mocked(orchestratorApi.listProfiles).mockReset().mockResolvedValue([] as never);
});

describe("CreateInferencePage — выбор модели", () => {
  it("помечает избранные модели и держит их первыми", async () => {
    render(
      <MemoryRouter>
        <CreateInferencePage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("★ org/favorite Q4_K_M")).toBeInTheDocument());
    const options = screen.getAllByRole("option").filter((option) => option.getAttribute("value") !== "");
    expect(options.map((option) => option.textContent)).toEqual([
      "★ org/favorite Q4_K_M",
      "org/favorite Q2_0",
      "org/plain Q2_0",
    ]);
  });

  it("показывает все варианты каталога с квантами в подписях", async () => {
    render(
      <MemoryRouter>
        <CreateInferencePage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("org/plain Q2_0")).toBeInTheDocument());
    const options = screen.getAllByRole("option").filter((option) => option.getAttribute("value") !== "");
    expect(options).toHaveLength(MODELS.length);
  });
});

const PROFILE = profileEntry({
  id: 7, name: "llama-q4", model_id: 2, gpu_ids: [0], port: null,
  structural_fields: { driver: "nvidia" }, cli_options: "-ngl 999 --ctx-size 4096",
});

describe("CreateInferencePage — параметры запуска из профиля", () => {
  async function fillWizard() {
    vi.mocked(orchestratorApi.listProfiles).mockResolvedValue([PROFILE] as never);
    vi.mocked(orchestratorApi.createInference).mockReset().mockResolvedValue({ id: "new" } as never);
    render(
      <MemoryRouter>
        <CreateInferencePage />
      </MemoryRouter>
    );
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText("★ org/favorite Q4_K_M")).toBeInTheDocument());
    const [nameInput] = screen.getAllByRole("textbox");
    await user.type(nameInput, "my-inference");
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[0], "2");
    await user.selectOptions(selects[1], "7");
    await waitFor(() => expect(screen.getByTestId("create-launch-params")).toBeInTheDocument());
    return user;
  }

  it("выбора установки нет: движок берётся из профиля", async () => {
    await fillWizard();
    expect(screen.queryByText("Установка движка")).not.toBeInTheDocument();
  });

  it("нетронутые параметры уходят значениями профиля", async () => {
    const user = await fillWizard();
    expect(screen.getByLabelText("Значение #1")).toHaveValue("999");
    await user.click(screen.getByText("Создать"));
    await waitFor(() =>
      expect(orchestratorApi.createInference).toHaveBeenCalledWith(
        expect.objectContaining({ gpu_ids: [0], structural_fields: { driver: "nvidia" }, cli_options: "-ngl 999 --ctx-size 4096", system_prompt: "" })
      )
    );
  });

  it("удалённый параметр меняет опции, остальное — значения профиля", async () => {
    const user = await fillWizard();
    await user.click(screen.getByLabelText("Удалить #2"));
    await user.click(screen.getByText("Создать"));
    await waitFor(() =>
      expect(orchestratorApi.createInference).toHaveBeenCalledWith(
        expect.objectContaining({ gpu_ids: [0], structural_fields: { driver: "nvidia" }, cli_options: "-ngl 999", system_prompt: "" })
      )
    );
  });
});
