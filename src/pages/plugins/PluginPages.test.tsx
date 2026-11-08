import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginDetailPage, PluginsPage } from "./PluginPages";
import { accountsApi } from "../../api/accounts";
import { orchestratorApi } from "../../api/orchestrator";

vi.mock("../../api/accounts", () => ({
  accountsApi: { isAdmin: vi.fn() },
}));

vi.mock("../../api/orchestrator", () => ({
  orchestratorApi: {
    listPlugins: vi.fn(),
    listEngineInstallations: vi.fn().mockResolvedValue([]),
    disablePlugin: vi.fn(),
    enablePlugin: vi.fn(),
    deletePlugin: vi.fn(),
    getPluginSchema: vi.fn(),
    listProfiles: vi.fn().mockResolvedValue([]),
    installPluginExtension: vi.fn(),
    deletePluginExtension: vi.fn(),
  },
}));

const mockedIsAdmin = vi.mocked(accountsApi.isAdmin);
const mockedList = vi.mocked(orchestratorApi.listPlugins);
const mockedDisable = vi.mocked(orchestratorApi.disablePlugin);
const mockedEnable = vi.mocked(orchestratorApi.enablePlugin);

const OK_PLUGIN = {
  id: 1,
  name: "llama.cpp",
  plugin_version: "1.0.0",
  contract_version: "1",
  plugin_type: "engine",
  path: "/plugins/llama-cpp",
  status: "ok",
  error_detail: null,
  enabled: true,
  tasks: ["text-generation"],
};

const SCHEMA = { install_schema: [], profile_schema: [], tasks: ["text-to-speech"], extensions_unsupported_reason: null, extensions: [] };

beforeEach(() => {
  mockedIsAdmin.mockReset().mockResolvedValue(true);
  mockedList.mockReset();
  mockedDisable.mockReset();
  mockedEnable.mockReset();
  vi.mocked(orchestratorApi.getPluginSchema).mockReset().mockResolvedValue(SCHEMA);
});

describe("PluginsPage — status bug (backend sends 'ok', not 'loaded')", () => {
  it("shows a successfully loaded plugin as 'загружен', not 'ошибка'", async () => {
    mockedList.mockResolvedValue([OK_PLUGIN]);

    render(
      <MemoryRouter>
        <PluginsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("загружен")).toBeInTheDocument());
    expect(screen.queryByText("ошибка")).not.toBeInTheDocument();
  });

  it("still shows a genuinely failed plugin as 'ошибка'", async () => {
    mockedList.mockResolvedValue([{ ...OK_PLUGIN, status: "invalid_manifest", error_detail: "bad manifest" }]);

    render(
      <MemoryRouter>
        <PluginsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("ошибка")).toBeInTheDocument());
  });
});

describe("PluginsPage — «Отключить» performs a real action", () => {
  it("clicking Отключить calls disablePlugin and updates the card", async () => {
    mockedList.mockResolvedValue([OK_PLUGIN]);
    mockedDisable.mockResolvedValue({ ...OK_PLUGIN, enabled: false });

    render(
      <MemoryRouter>
        <PluginsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Отключить")).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByText("Отключить"));

    await waitFor(() => expect(mockedDisable).toHaveBeenCalledWith(1));
    expect(await screen.findByText("Включить")).toBeInTheDocument();
    expect(screen.getByText("отключён")).toBeInTheDocument();
  });

  it("clicking Отключить does not navigate to the plugin detail page", async () => {
    mockedList.mockResolvedValue([OK_PLUGIN]);
    mockedDisable.mockResolvedValue({ ...OK_PLUGIN, enabled: false });

    render(
      <MemoryRouter initialEntries={["/plugins"]}>
        <Routes>
          <Route path="/plugins" element={<PluginsPage />} />
          <Route path="/plugins/:id" element={<div data-testid="detail-page">detail</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Отключить")).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByText("Отключить"));

    await waitFor(() => expect(mockedDisable).toHaveBeenCalled());
    expect(screen.queryByTestId("detail-page")).not.toBeInTheDocument();
  });

  it("disable button is disabled for a plugin that failed to load", async () => {
    mockedList.mockResolvedValue([{ ...OK_PLUGIN, status: "invalid_manifest" }]);

    render(
      <MemoryRouter>
        <PluginsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Отключить")).toBeInTheDocument());
    expect(screen.getByText("Отключить")).toBeDisabled();
  });
});

describe("PluginDetailPage — status bug fixed", () => {
  it("shows 'загружен' for status ok", async () => {
    mockedList.mockResolvedValue([OK_PLUGIN]);

    render(
      <MemoryRouter initialEntries={["/plugins/1"]}>
        <Routes>
          <Route path="/plugins/:id" element={<PluginDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("загружен")).toBeInTheDocument());
  });
});

describe("Задачи движка и расширения", () => {
  it("карточка engine-плагина показывает его задачи", async () => {
    mockedList.mockResolvedValue([OK_PLUGIN]);

    render(
      <MemoryRouter>
        <PluginsPage />
      </MemoryRouter>
    );

    expect(await screen.findByTestId("plugin-tasks-1")).toHaveTextContent("text-generation");
  });

  it("плагин без поддержки расширений показывает причину вместо установки", async () => {
    mockedList.mockResolvedValue([OK_PLUGIN]);
    vi.mocked(orchestratorApi.getPluginSchema).mockResolvedValue({
      ...SCHEMA,
      extensions_unsupported_reason: "плагин llama.cpp не поддерживает расширения: движок текстовой генерации",
    });

    render(
      <MemoryRouter initialEntries={["/plugins/1"]}>
        <Routes>
          <Route path="/plugins/:id" element={<PluginDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByTestId("extensions-unsupported")).toHaveTextContent("не поддерживает расширения");
    expect(screen.queryByTestId("extension-install-open")).not.toBeInTheDocument();
  });

  it("отказ установки несовместимого расширения виден в окне, окно не закрывается", async () => {
    const { ApiError } = await import("../../api/client");
    mockedList.mockResolvedValue([{ ...OK_PLUGIN, tasks: ["text-to-speech"] }]);
    vi.mocked(orchestratorApi.installPluginExtension).mockRejectedValue(
      new ApiError(400, { detail: "расширение ru-stt несовместимо: движок решает задачи text-to-speech" })
    );

    render(
      <MemoryRouter initialEntries={["/plugins/1"]}>
        <Routes>
          <Route path="/plugins/:id" element={<PluginDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("extension-install-open"));
    await user.upload(screen.getByTestId("extension-archive"), new File(["x"], "ext.tar.gz"));
    await user.type(screen.getByTestId("extension-sha256"), "abc");
    await user.click(screen.getByText("Установить"));

    expect(await screen.findByTestId("extension-install-error")).toHaveTextContent("несовместимо");
    expect(screen.getByTestId("install-extension-modal")).toBeInTheDocument();
  });

  it("удаление расширения заблокировано, пока оно включено в профиле", async () => {
    mockedList.mockResolvedValue([{ ...OK_PLUGIN, tasks: ["text-to-speech"] }]);
    vi.mocked(orchestratorApi.getPluginSchema).mockResolvedValue({
      ...SCHEMA,
      extensions: [
        {
          id: 7, plugin_id: 1, name: "ru-stress", version: "1.0.0", task: "text-to-speech", path: "/x",
          status: "ok", error_detail: null, dictionaries: [], options: [],
        },
      ],
    });
    vi.mocked(orchestratorApi.listProfiles).mockResolvedValue([
      { id: 3, name: "tts-profile", engine_plugin_id: 1, extensions: { "ru-stress": {} } } as never,
    ]);

    render(
      <MemoryRouter initialEntries={["/plugins/1"]}>
        <Routes>
          <Route path="/plugins/:id" element={<PluginDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("ru-stress");
    const deleteButtons = screen.getAllByText("Удалить");
    expect(deleteButtons[0]).toBeDisabled();
    expect(deleteButtons[0]).toHaveAttribute("title", expect.stringContaining("tts-profile"));
  });
});
