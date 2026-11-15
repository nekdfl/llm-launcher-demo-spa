import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EngineVariantDetailPage } from "./EnginePages";
import { orchestratorApi } from "../../api/orchestrator";
import { inferenceEntry } from "../../api/__fixtures__/inference";
import { pluginEntry, profileEntry } from "../../api/__fixtures__/profile";

vi.mock("../../api/orchestrator", () => ({
  orchestratorApi: {
    listPlugins: vi.fn(),
    getPluginSchema: vi.fn(),
    listProfiles: vi.fn(),
    listInferences: vi.fn(),
    updatePlugin: vi.fn(),
    recheckPlugin: vi.fn(),
    deletePlugin: vi.fn(),
  },
}));

const mockedList = vi.mocked(orchestratorApi.listPlugins);
const mockedGetSchema = vi.mocked(orchestratorApi.getPluginSchema);
const mockedUpdate = vi.mocked(orchestratorApi.updatePlugin);

const VARIANT = pluginEntry({
  id: 1,
  name: "llama.cpp (cpu)",
  install_fields: { llama_server_path: "/opt/engines/llama.cpp/cpu/llama-server" },
  engine_version: "b4200",
});

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
  mockedList.mockReset().mockResolvedValue([VARIANT]);
  vi.mocked(orchestratorApi.listProfiles).mockReset().mockResolvedValue([]);
  vi.mocked(orchestratorApi.listInferences).mockReset().mockResolvedValue([]);
  mockedGetSchema.mockReset().mockResolvedValue({ install_schema: INSTALL_SCHEMA, profile_schema: [] });
  mockedUpdate.mockReset();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/engines/1"]}>
      <Routes>
        <Route path="/engines" element={<div data-testid="engines-list">list</div>} />
        <Route path="/engines/:id" element={<EngineVariantDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("EngineVariantDetailPage — редактирование полей (CRUD: Update)", () => {
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
    mockedUpdate.mockResolvedValue({ ...VARIANT, name: "renamed", engine_version: "b4300" });
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
    mockedUpdate.mockRejectedValue(new Error("движок с именем 'taken' уже существует"));
    renderPage();

    const user = userEvent.setup();
    const nameInput = await screen.findByDisplayValue("llama.cpp (cpu)");
    await user.clear(nameInput);
    await user.type(nameInput, "taken");
    await user.click(screen.getByText("Сохранить"));

    await screen.findByText("движок с именем 'taken' уже существует");
    expect(screen.getByDisplayValue("taken")).toBeInTheDocument();
  });

  it("удаление заблокировано, пока на вариант ссылаются профиль или inference", async () => {
    vi.mocked(orchestratorApi.listProfiles).mockResolvedValue([profileEntry({ plugin_id: 1, name: "p1" })]);
    vi.mocked(orchestratorApi.listInferences).mockResolvedValue([inferenceEntry({ plugin_id: 1, name: "i1" })]);
    renderPage();

    expect(await screen.findByText("Удалить вариант")).toBeDisabled();
    expect(screen.getByText("профиль p1")).toBeInTheDocument();
    expect(screen.getByText("inference i1")).toBeInTheDocument();
  });
});
