import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ProfilesList } from "./ProfilesList";
import { orchestratorApi } from "../../api/orchestrator";

vi.mock("../../api/orchestrator", () => ({
  orchestratorApi: {
    listProfiles: vi.fn().mockResolvedValue([
      { id: 1, name: "qwen3-32b", model_id: 10, engine_plugin_id: 20, gpu_ids: [0], port: 8091, structural_fields: {}, cli_options: "", system_prompt: "", plugin_version: "1.0.0", schema_hash: "x", origin_profile_id: null, needs_review: false },
    ]),
    listModels: vi.fn().mockResolvedValue([{ id: 10, provider_id: 1, ref: "org/Qwen-32B", file_path: "/m", format: "gguf", metadata: {} }]),
    listInferences: vi.fn().mockResolvedValue([]),
    listPlugins: vi.fn().mockResolvedValue([{ id: 20, name: "llama.cpp", plugin_version: "1.0.0", contract_version: "v2", plugin_type: "engine", path: "/p", status: "loaded", error_detail: null }]),
  },
}));

describe("ProfilesList", () => {
  it("renders profile cards with model and engine metadata", async () => {
    render(
      <MemoryRouter>
        <ProfilesList />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("qwen3-32b")).toBeInTheDocument());
    expect(screen.getByText(/org\/Qwen-32B · llama.cpp/)).toBeInTheDocument();
    expect(screen.getByText("0 inferences")).toBeInTheDocument();
  });

  it("shows the create button", async () => {
    render(
      <MemoryRouter>
        <ProfilesList />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Создать профиль")).toBeInTheDocument());
  });
});

describe("ProfilesList — негодная модель профиля", () => {
  it("помечает профиль и даёт перейти к модели", async () => {
    vi.mocked(orchestratorApi.listProfiles).mockResolvedValue([
      {
        id: 1,
        name: "qwen3-32b",
        model_id: 10,
        engine_plugin_id: 20,
        gpu_ids: [0],
        port: 8091,
        structural_fields: {},
        cli_options: "",
        system_prompt: "",
        plugin_version: "1.0.0",
        schema_hash: "x",
        origin_profile_id: null,
        needs_review: false,
        model_validity: { usable: false, reason: "файл отсутствует" },
      },
    ] as never);

    render(
      <MemoryRouter>
        <ProfilesList />
      </MemoryRouter>
    );

    const notice = await screen.findByTestId("profile-model-unusable-1");
    expect(notice).toHaveTextContent("файл отсутствует");
    expect(notice.querySelector("a")).toHaveAttribute("href", "/models/10");
  });
});
