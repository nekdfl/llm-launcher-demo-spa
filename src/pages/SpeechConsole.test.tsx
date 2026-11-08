import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpeechConsole } from "./SpeechConsole";
import { orchestratorApi } from "../api/orchestrator";

vi.mock("../api/orchestrator", () => ({
  orchestratorApi: {
    describeRouterModel: vi.fn(),
    synthesizeSpeech: vi.fn(),
    transcribeAudio: vi.fn(),
  },
}));

const describeModel = vi.mocked(orchestratorApi.describeRouterModel);

beforeEach(() => {
  describeModel.mockReset();
  globalThis.URL.createObjectURL = vi.fn(() => "blob:audio");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("SpeechConsole", () => {
  it("TTS: синтез выбранным голосом и проигрыватель", async () => {
    describeModel.mockResolvedValue({
      id: "i", slug: "tts", task: "text-to-speech", input_modalities: ["text"], output_modalities: ["speech"],
      supported_voices: ["ryan", "anna"],
    });
    vi.mocked(orchestratorApi.synthesizeSpeech).mockResolvedValue(new Blob(["RIFF"]));

    render(<SpeechConsole inferenceId="i" running />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByTestId("speech-voice"), "anna");
    await user.click(screen.getByText("Синтезировать"));

    await waitFor(() => expect(screen.getByTestId("speech-audio")).toBeInTheDocument());
    expect(orchestratorApi.synthesizeSpeech).toHaveBeenCalledWith("i", expect.any(String), "anna");
  });

  it("STT: файл распознаётся, текст показан", async () => {
    describeModel.mockResolvedValue({
      id: "i", slug: "stt", task: "automatic-speech-recognition", input_modalities: ["audio"],
      output_modalities: ["transcription"],
    });
    vi.mocked(orchestratorApi.transcribeAudio).mockResolvedValue({ text: "привет мир" });

    render(<SpeechConsole inferenceId="i" running />);
    const user = userEvent.setup();
    await user.upload(await screen.findByTestId("speech-file"), new File(["x"], "a.wav", { type: "audio/wav" }));
    await user.click(screen.getByText("Распознать"));

    expect(await screen.findByTestId("speech-transcript")).toHaveTextContent("привет мир");
  });

  it("текстовый движок — консоли нет", async () => {
    describeModel.mockResolvedValue({
      id: "i", slug: "llm", task: "text-generation", input_modalities: ["text"], output_modalities: ["text"],
    });

    render(<SpeechConsole inferenceId="i" running />);

    await waitFor(() => expect(describeModel).toHaveBeenCalled());
    expect(screen.queryByTestId("speech-console")).not.toBeInTheDocument();
  });
});
