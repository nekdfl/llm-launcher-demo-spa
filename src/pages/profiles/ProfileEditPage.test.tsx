import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileEditPage } from "./ProfileEditPage";
import { orchestratorApi } from "../../api/orchestrator";
import { inferenceEntry } from "../../api/__fixtures__/inference";

vi.mock("../../api/orchestrator", () => ({
  orchestratorApi: {
    listModels: vi.fn().mockResolvedValue([]),
    listPlugins: vi.fn().mockResolvedValue([]),
    getProfile: vi.fn(),
    listInferences: vi.fn(),
    deleteProfile: vi.fn(),
    // Подсказки монтируются, как только модель выбрана.
    getAssistantSuggestions: vi.fn().mockResolvedValue({ suggestions: [] }),
    getPluginSchema: vi.fn().mockResolvedValue({ install_schema: [], profile_schema: [], extensions: [] }),
    updateProfile: vi.fn(),
  },
}));

const mockedGetProfile = vi.mocked(orchestratorApi.getProfile);
const mockedListInferences = vi.mocked(orchestratorApi.listInferences);
const mockedDelete = vi.mocked(orchestratorApi.deleteProfile);

const PROFILE = {
  id: 5, name: "profile-5", model_id: 1, engine_plugin_id: 1, gpu_ids: [], port: 8090,
  structural_fields: {}, cli_options: "", system_prompt: "", plugin_version: "1.0.0",
  schema_hash: "x", origin_profile_id: null, needs_review: false, reasoning: false, input_modalities: ["text"],
};

beforeEach(() => {
  mockedGetProfile.mockReset().mockResolvedValue(PROFILE);
  mockedListInferences.mockReset().mockResolvedValue([]);
  mockedDelete.mockReset().mockResolvedValue(undefined);
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/profiles/5"]}>
      <Routes>
        <Route path="/profiles" element={<div data-testid="profiles-list">list</div>} />
        <Route path="/profiles/:id" element={<ProfileEditPage mode="edit" />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ProfileEditPage — delete button (was missing entirely)", () => {
  it("deletes a profile with no referencing inferences and navigates to the list", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Удалить профиль")).toBeInTheDocument());
    expect(screen.getByText("Удалить профиль")).not.toBeDisabled();

    const user = userEvent.setup();
    await user.click(screen.getByText("Удалить профиль"));

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith(5));
    expect(await screen.findByTestId("profiles-list")).toBeInTheDocument();
  });

  it("disables delete when an inference references the profile", async () => {
    mockedListInferences.mockResolvedValue([
      inferenceEntry({ id: "inf-1", slug: "inf-1", name: "x", profile_id: 5, port: 8090 }),
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Удалить профиль")).toBeDisabled());
  });

  it("does not render the delete button in create mode", async () => {
    render(
      <MemoryRouter initialEntries={["/profiles/new"]}>
        <Routes>
          <Route path="/profiles/new" element={<ProfileEditPage mode="create" />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Создать профиль")).toBeInTheDocument());
    expect(screen.queryByText("Удалить профиль")).not.toBeInTheDocument();
  });
});

describe("ProfileEditPage — связь с моделью", () => {
  it("называет выбранную модель ссылкой на её карточку", async () => {
    vi.mocked(orchestratorApi.listModels).mockResolvedValue([
      {
        id: 10,
        provider_id: 1,
        ref: "org/Qwen-32B",
        file_path: "/m",
        format: "gguf",
        metadata: {},
        favorite: false,
        validity: { usable: true, reason: null },
      },
    ] as never);
    mockedGetProfile.mockResolvedValue({ ...PROFILE, model_id: 10 } as never);
    renderPage();

    const link = await screen.findByTestId("profile-model-link");
    expect(link.querySelector("a")).toHaveAttribute("href", "/models/10");
    expect(link).toHaveTextContent("org/Qwen-32B");
  });
});

describe("ProfileEditPage — выбор модели", () => {
  it("варианты репозитория идут подряд и подписаны квантами", async () => {
    vi.mocked(orchestratorApi.listModels).mockResolvedValue([
      {
        id: 2,
        provider_id: 1,
        ref: "org/multi",
        file_path: "/m/multi/model-IQ3_XXS.gguf",
        format: "gguf",
        metadata: { quantization: "IQ3_XXS" },
        favorite: false,
        validity: { usable: true, reason: null },
      },
      {
        id: 3,
        provider_id: 1,
        ref: "org/other",
        file_path: "/m/other/model-Q4_K_M.gguf",
        format: "gguf",
        metadata: { quantization: "Q4_K_M" },
        favorite: false,
        validity: { usable: true, reason: null },
      },
      {
        id: 4,
        provider_id: 1,
        ref: "org/multi",
        file_path: "/m/multi/model-Q2_0.gguf",
        format: "gguf",
        metadata: { quantization: "Q2_0" },
        favorite: false,
        validity: { usable: true, reason: null },
      },
    ] as never);
    renderPage();

    await waitFor(() => expect(screen.getByText("org/multi IQ3_XXS")).toBeInTheDocument());
    const options = screen
      .getAllByRole("option")
      .filter((option) => option.getAttribute("value") !== "" && option.textContent?.includes("org/"));
    expect(options.map((option) => option.textContent)).toEqual([
      "org/multi IQ3_XXS",
      "org/multi Q2_0",
      "org/other Q4_K_M",
    ]);
  });
});

describe("ProfileEditPage — расширения", () => {
  const EXTENSION = {
    id: 7, plugin_id: 1, name: "ru-stress", version: "1.0.0", task: "text-to-speech", path: "/x",
    status: "ok", error_detail: null, dictionaries: [],
    options: [
      {
        name: "stress_mode", type: "choice", label: "Режим ударений", required: false,
        default: "omographs", description: "", choices: ["omographs", "all"],
      },
    ],
  };

  it("включение расширения показывает его опции, выбор уходит в сохранение", async () => {
    vi.mocked(orchestratorApi.getPluginSchema).mockResolvedValue({
      install_schema: [], profile_schema: [],
      extensions: [EXTENSION, { ...EXTENSION, id: 8, name: "broken", status: "incompatible" }],
    });
    vi.mocked(orchestratorApi.updateProfile).mockResolvedValue(PROFILE as never);

    renderPage();
    const user = userEvent.setup();
    const toggle = await screen.findByTestId("extension-toggle-ru-stress");
    expect(screen.queryByTestId("extension-toggle-broken")).not.toBeInTheDocument();
    await user.click(toggle);
    await user.selectOptions(screen.getByTestId("extension-option-ru-stress-stress_mode"), "all");
    await user.click(screen.getByText("Сохранить"));

    await waitFor(() =>
      expect(orchestratorApi.updateProfile).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ extensions: { "ru-stress": { stress_mode: "all" } } })
      )
    );
  });

  it("ошибка опции с сервера показывается у поля", async () => {
    const { ApiError } = await import("../../api/client");
    mockedGetProfile.mockResolvedValue({ ...PROFILE, extensions: { "ru-stress": { stress_mode: "all" } } });
    vi.mocked(orchestratorApi.getPluginSchema).mockResolvedValue({ install_schema: [], profile_schema: [], extensions: [EXTENSION] });
    vi.mocked(orchestratorApi.updateProfile).mockRejectedValue(
      new ApiError(400, {
        detail: { message: "опция stress_mode: недопустимое значение", field: "extensions.ru-stress.stress_mode" },
      })
    );

    renderPage();
    const user = userEvent.setup();
    await screen.findByTestId("extension-option-ru-stress-stress_mode");
    await user.click(screen.getByText("Сохранить"));

    expect(await screen.findByText("опция stress_mode: недопустимое значение")).toBeInTheDocument();
    expect(screen.getByTestId("extension-option-ru-stress-stress_mode")).toHaveValue("all");
  });
});

describe("ProfileEditPage — подбор движка и поля схемы", () => {
  it("модели TTS предлагаются только речевые плагины, поля схемы плагина сохраняются", async () => {
    vi.mocked(orchestratorApi.listModels).mockResolvedValue([
      { id: 1, provider_id: 1, ref: "OpenMOSS-Team/MOSS-TTS", file_path: "/m", format: "safetensors",
        pipeline_tag: "text-to-speech", metadata: {}, favorite: false, validity: { usable: true, reason: null } },
    ] as never);
    vi.mocked(orchestratorApi.listPlugins).mockResolvedValue([
      { id: 1, name: "vllm", plugin_type: "engine", tasks: ["text-generation"], model_formats: ["safetensors"] },
      { id: 2, name: "moss-tts", plugin_type: "engine", tasks: ["text-to-speech"], model_formats: ["safetensors"] },
    ] as never);
    mockedGetProfile.mockResolvedValue({ ...PROFILE, engine_plugin_id: 2 });
    vi.mocked(orchestratorApi.getPluginSchema).mockResolvedValue({
      install_schema: [], extensions: [],
      profile_schema: [{ name: "text_ruaccent", type: "path", label: "Модель RUAccent", required: false,
                         default: null, description: "", choices: null }],
    });
    vi.mocked(orchestratorApi.updateProfile).mockResolvedValue(PROFILE as never);

    renderPage();
    const user = userEvent.setup();
    const field = await screen.findByTestId("profile-field-text_ruaccent");
    expect(screen.queryByRole("option", { name: "vllm" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "moss-tts" })).toBeInTheDocument();
    await user.type(field, "/models/ruaccent");
    await user.click(screen.getByText("Сохранить"));

    await waitFor(() =>
      expect(orchestratorApi.updateProfile).toHaveBeenCalledWith(
        5, expect.objectContaining({ structural_fields: { text_ruaccent: "/models/ruaccent" } })
      )
    );
  });
});
