import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EngineInstallDetailPage } from "./EnginePages";
import { orchestratorApi } from "../../api/orchestrator";

vi.mock("../../api/orchestrator", () => ({
  orchestratorApi: {
    getEngineInstallation: vi.fn(),
    getPluginSchema: vi.fn(),
    listProfiles: vi.fn().mockResolvedValue([]),
    updateEngineInstallation: vi.fn(),
    recheckEngineInstallation: vi.fn(),
    deleteEngineInstallation: vi.fn(),
  },
}));

const mockedGet = vi.mocked(orchestratorApi.getEngineInstallation);
const mockedGetSchema = vi.mocked(orchestratorApi.getPluginSchema);
const mockedUpdate = vi.mocked(orchestratorApi.updateEngineInstallation);

const INSTALLATION = {
  id: 1,
  name: "llama.cpp (cpu)",
  plugin_id: 1,
  install_fields: { llama_server_path: "/opt/engines/llama.cpp/cpu/llama-server" },
  version: "b4200",
  available: true,
  unavailable_reason: null,
};

const INSTALL_SCHEMA = [
  {
    name: "llama_server_path",
    type: "path",
    label: "Путь к llama-server",
    required: true,
    default: null,
    description: "",
    choices: null,
  },
];

beforeEach(() => {
  mockedGet.mockReset().mockResolvedValue(INSTALLATION);
  mockedGetSchema.mockReset().mockResolvedValue({ install_schema: INSTALL_SCHEMA, profile_schema: [] });
  mockedUpdate.mockReset();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/engines/1"]}>
      <Routes>
        <Route path="/engines" element={<div data-testid="engines-list">list</div>} />
        <Route path="/engines/:id" element={<EngineInstallDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("EngineInstallDetailPage — редактирование полей (CRUD: Update)", () => {
  it("поля название и путь редактируемые, не disabled", async () => {
    renderPage();

    const nameInput = await screen.findByDisplayValue("llama.cpp (cpu)");
    const pathInput = await screen.findByDisplayValue("/opt/engines/llama.cpp/cpu/llama-server");

    expect(nameInput).not.toBeDisabled();
    expect(pathInput).not.toBeDisabled();
  });

  it("кнопка «Сохранить» задизейблена, пока ничего не изменено", async () => {
    renderPage();

    const saveButton = await screen.findByText("Сохранить");
    expect(saveButton).toBeDisabled();
  });

  it("сохраняет правки имени и пути", async () => {
    mockedUpdate.mockResolvedValue({ ...INSTALLATION, name: "renamed", version: "b4300" });
    renderPage();

    const user = userEvent.setup();
    const nameInput = await screen.findByDisplayValue("llama.cpp (cpu)");
    await user.clear(nameInput);
    await user.type(nameInput, "renamed");

    const saveButton = screen.getByText("Сохранить");
    expect(saveButton).not.toBeDisabled();
    await user.click(saveButton);

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith(1, {
        name: "renamed",
        install_fields: { llama_server_path: "/opt/engines/llama.cpp/cpu/llama-server" },
      })
    );
    await waitFor(() => expect(screen.getByDisplayValue("renamed")).toBeInTheDocument());
  });

  it("при ошибке сохранения показывает сообщение и не теряет введённые значения", async () => {
    mockedUpdate.mockRejectedValue(new Error("установка с именем 'taken' уже существует"));
    renderPage();

    const user = userEvent.setup();
    const nameInput = await screen.findByDisplayValue("llama.cpp (cpu)");
    await user.clear(nameInput);
    await user.type(nameInput, "taken");
    await user.click(screen.getByText("Сохранить"));

    await screen.findByText("установка с именем 'taken' уже существует");
    expect(screen.getByDisplayValue("taken")).toBeInTheDocument();
  });
});
