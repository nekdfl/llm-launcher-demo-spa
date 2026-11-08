import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantHintsSection } from "./AssistantHintsSection";
import { orchestratorApi } from "../../api/orchestrator";

vi.mock("../../api/orchestrator", () => ({
  orchestratorApi: {
    getAssistantSuggestions: vi.fn(),
  },
}));

const mockedGet = vi.mocked(orchestratorApi.getAssistantSuggestions);

beforeEach(() => {
  mockedGet.mockReset();
});

describe("AssistantHintsSection", () => {
  it("profile creation never blocks: unavailable assistant renders a quiet note, no error", async () => {
    // Spec scenario: "Профиль создаётся без запущенного помощника" — the
    // endpoint answers available:false and the UI shows no error banner.
    mockedGet.mockResolvedValue({
      available: false,
      reason: "помощник недоступен: connection refused",
      suggestions: [],
      warnings: [],
    });

    render(<AssistantHintsSection modelId={1} onApply={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId("assistant-hints-unavailable")).toBeInTheDocument());
    expect(screen.getByText(/Помощник не запущен или не настроен/)).toBeInTheDocument();
    // Network failure is the same silent degradation:
    mockedGet.mockRejectedValue(new Error("network down"));
    render(<AssistantHintsSection modelId={2} onApply={() => undefined} />);
    await waitFor(() => expect(screen.getAllByText(/Помощник не запущен или не настроен/).length).toBe(2));
  });

  it("applies one suggestion per click without touching other fields (spec scenario)", async () => {
    mockedGet.mockResolvedValue({
      available: true,
      reason: null,
      suggestions: [
        { field: "ctx-size", value: "32768", reason: "README says so", quote: "--ctx-size 32768" },
        { field: "rope-scaling", value: "yarn", reason: "context beyond 32k", quote: "use --rope-scaling yarn" },
      ],
      warnings: ["requires llama.cpp b4100+"],
    });

    const onApply = vi.fn();
    render(<AssistantHintsSection modelId={1} onApply={onApply} />);

    await waitFor(() => expect(screen.getByTestId("assistant-hints")).toBeInTheDocument());
    // Every suggestion shows its README quote as evidence:
    expect(screen.getByText(/--ctx-size 32768/)).toBeInTheDocument();
    // Warnings are a separate list, not dropped (spec):
    expect(screen.getByTestId("assistant-warnings")).toHaveTextContent("requires llama.cpp b4100+");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("apply-ctx-size"));

    // Exactly one apply, and the other suggestion stays unapplied:
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith("ctx-size", "32768");
    expect(screen.getByTestId("apply-ctx-size")).toBeDisabled();
    expect(screen.getByTestId("apply-rope-scaling")).toBeEnabled();
  });

  it("renders nothing while no model is selected", () => {
    render(<AssistantHintsSection modelId={null} onApply={() => undefined} />);
    expect(screen.queryByTestId("assistant-hints")).not.toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalled();
  });
});
