import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DownloadStatsPanel } from "./DownloadStatsPanel";
import { orchestratorApi } from "../api/orchestrator";

vi.mock("../api/orchestrator", () => ({
  orchestratorApi: {
    getDownloadStats: vi.fn(),
  },
}));

const mockedStats = vi.mocked(orchestratorApi.getDownloadStats);

const STATS = {
  active_count: 8,
  completed_count: 2,
  models_count: 24,
  free_bytes: 773_500_000_000,
  remaining_bytes: 523_500_000_000,
  speed_bytes_per_sec: 3_000_000,
  eta_active_seconds: 80400,
  eta_all_seconds: null,
  active_etas: {},
};

describe("DownloadStatsPanel", () => {
  it("сам запрашивает сводку и показывает все цифры, включая число моделей", async () => {
    mockedStats.mockReset().mockResolvedValue(STATS as never);

    render(<DownloadStatsPanel />);

    await waitFor(() => expect(screen.getByTestId("download-stats")).toBeInTheDocument());
    expect(mockedStats).toHaveBeenCalled();
    const panel = screen.getByTestId("download-stats");
    expect(panel).toHaveTextContent("Активно");
    expect(panel).toHaveTextContent("8");
    expect(panel).toHaveTextContent("Моделей");
    expect(panel).toHaveTextContent("24");
    expect(panel).toHaveTextContent("ETA загружаемых");
  });

  it("при недоступной сводке ничего не рисует", async () => {
    mockedStats.mockReset().mockRejectedValue(new Error("503"));

    render(<DownloadStatsPanel />);

    await waitFor(() => expect(mockedStats).toHaveBeenCalled());
    expect(screen.queryByTestId("download-stats")).not.toBeInTheDocument();
  });

  it("сбой опроса не убирает панель — остаются прежние цифры", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockedStats.mockReset().mockResolvedValueOnce(STATS as never).mockRejectedValue(new Error("503"));

      render(<DownloadStatsPanel />);
      await waitFor(() => expect(screen.getByTestId("download-stats")).toBeInTheDocument());
      await vi.advanceTimersByTimeAsync(2000);

      expect(mockedStats.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(screen.getByTestId("download-stats")).toHaveTextContent("24");
    } finally {
      vi.useRealTimers();
    }
  });

  it("скорость не пропадает, пока закачки идут, и нулевая скорость — ноль", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockedStats
        .mockReset()
        .mockResolvedValueOnce({ ...STATS, downloading_count: 1, speed_bytes_per_sec: 3_000_000 } as never)
        .mockResolvedValueOnce({ ...STATS, downloading_count: 1, speed_bytes_per_sec: null } as never)
        .mockResolvedValue({ ...STATS, downloading_count: 1, speed_bytes_per_sec: 0 } as never);

      render(<DownloadStatsPanel />);
      await waitFor(() => expect(screen.getByTestId("download-stats")).toHaveTextContent("/с"));
      const speedText = () => screen.getByText("Скорость").nextElementSibling?.textContent;
      const first = speedText();

      await vi.advanceTimersByTimeAsync(2000);
      await waitFor(() => expect(mockedStats).toHaveBeenCalledTimes(2));
      // Скорость неизвестна на этом опросе — показано последнее известное значение.
      expect(speedText()).toBe(first);

      await vi.advanceTimersByTimeAsync(2000);
      await waitFor(() => expect(speedText()).toMatch(/^0/));
    } finally {
      vi.useRealTimers();
    }
  });

  it("без загружающихся закачек скорости нет", async () => {
    mockedStats.mockReset().mockResolvedValue({ ...STATS, downloading_count: 0, speed_bytes_per_sec: null } as never);

    render(<DownloadStatsPanel />);

    await waitFor(() => expect(screen.getByTestId("download-stats")).toBeInTheDocument());
    expect(screen.getByText("Скорость").nextElementSibling?.textContent).toBe("—");
  });
});
