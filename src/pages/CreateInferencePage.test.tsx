import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateInferencePage } from "./CreateInferencePage";
import { orchestratorApi } from "../api/orchestrator";

vi.mock("../api/orchestrator", () => ({
  orchestratorApi: {
    listModels: vi.fn(),
    listProfiles: vi.fn(),
    listEngineInstallations: vi.fn(),
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
  vi.mocked(orchestratorApi.listEngineInstallations).mockReset().mockResolvedValue([] as never);
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
