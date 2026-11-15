import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { orchestratorApi } from "../api/orchestrator";
import { LaunchCommandField } from "./LaunchCommandField";

vi.mock("../api/orchestrator", () => ({
  orchestratorApi: { previewLaunchCommand: vi.fn() },
}));

const INPUT = { plugin_id: 1, model_id: 1, port: 8080, gpu_ids: [0], structural_fields: {}, cli_options: "--ctx-size=4096" };
const COMMAND = "CUDA_VISIBLE_DEVICES=0 /opt/llama-server -m /m.gguf --port 8080 --ctx-size=4096";

/** Что попало в буфер: execCommand("copy") копирует выделение временного textarea. */
let copied: string | null = null;

beforeEach(() => {
  copied = null;
  document.execCommand = vi.fn(() => {
    copied = (document.activeElement as HTMLTextAreaElement | null)?.value ?? null;
    return true;
  });
  vi.mocked(orchestratorApi.previewLaunchCommand)
    .mockReset()
    .mockResolvedValue({ argv: [], env: {}, command: COMMAND, plugin_name: "llama.cpp (cuda)" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LaunchCommandField — копирование", () => {
  it("копирует построенную команду и показывает «Скопировано»", async () => {
    render(<LaunchCommandField label="Команда запуска" input={INPUT} testId="cmd" />);
    await waitFor(() => expect(screen.getByTestId("cmd-value")).toHaveValue(COMMAND));

    fireEvent.click(screen.getByTestId("cmd-copy"));
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(copied).toBe(COMMAND);
    expect(screen.getByTestId("cmd-copy")).toHaveTextContent("Скопировано");
  });

  it("без модели и плагина копировать нечего", () => {
    render(<LaunchCommandField label="Команда запуска" input={null} testId="cmd" />);
    expect(screen.getByTestId("cmd-copy")).toBeDisabled();
  });

  it("при ошибке превью кнопка недоступна", async () => {
    vi.mocked(orchestratorApi.previewLaunchCommand).mockRejectedValue(new Error("у движка llama.cpp не заданы install-поля"));
    render(<LaunchCommandField label="Команда запуска" input={INPUT} testId="cmd" />);
    await waitFor(() => expect(screen.getByTestId("cmd-value")).toHaveValue("⚠ у движка llama.cpp не заданы install-поля"));
    expect(screen.getByTestId("cmd-copy")).toBeDisabled();
  });

  it("неудачное копирование не выдаётся за успех", async () => {
    document.execCommand = vi.fn(() => false);
    render(<LaunchCommandField label="Команда запуска" input={INPUT} testId="cmd" />);
    await waitFor(() => expect(screen.getByTestId("cmd-value")).toHaveValue(COMMAND));
    fireEvent.click(screen.getByTestId("cmd-copy"));
    expect(screen.getByTestId("cmd-copy")).toHaveTextContent("Не удалось");
  });
});
