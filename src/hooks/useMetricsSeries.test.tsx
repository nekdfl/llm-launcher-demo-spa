import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMetricsSeries, type MetricsRangeKey } from "./useMetricsSeries";

function Probe({
  rangeKey,
  loadHistory,
  pollLive,
}: {
  rangeKey: MetricsRangeKey;
  loadHistory: (range: MetricsRangeKey) => Promise<{ time: number; value: number }[]>;
  pollLive: () => Promise<number | null>;
}) {
  const series = useMetricsSeries<number>({ loadHistory, pollLive, rangeKey, intervalMs: 1000 });
  return (
    <div>
      <span data-testid="values">{series.samples.map((s) => s.value).join(",")}</span>
      <span data-testid="window">{series.windowMs}</span>
      <span data-testid="error">{series.error ?? ""}</span>
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMetricsSeries", () => {
  it("при открытии отдаёт историю с сервера, а не пустой ряд", async () => {
    const loadHistory = vi.fn().mockResolvedValue([
      { time: 1000, value: 1 },
      { time: 2000, value: 2 },
    ]);

    render(<Probe rangeKey="all" loadHistory={loadHistory} pollLive={vi.fn().mockResolvedValue(9)} />);

    await waitFor(() => expect(screen.getByTestId("values")).toHaveTextContent("1,2"));
    expect(loadHistory).toHaveBeenCalledWith("all");
  });

  it("живой опрос дописывает точки к загруженной истории", async () => {
    const loadHistory = vi.fn().mockResolvedValue([{ time: Date.now() - 1000, value: 1 }]);
    const pollLive = vi.fn().mockResolvedValue(7);

    render(<Probe rangeKey="1h" loadHistory={loadHistory} pollLive={pollLive} />);
    await waitFor(() => expect(screen.getByTestId("values")).toHaveTextContent("1"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    await waitFor(() => expect(screen.getByTestId("values")).toHaveTextContent("1,7"));
  });

  it("такт без точки (null) не добавляет выдуманного нуля", async () => {
    const loadHistory = vi.fn().mockResolvedValue([{ time: Date.now() - 1000, value: 1 }]);
    const pollLive = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(9);

    render(<Probe rangeKey="1h" loadHistory={loadHistory} pollLive={pollLive} />);
    await waitFor(() => expect(screen.getByTestId("values")).toHaveTextContent("1"));

    // Первый такт без ответа — точка не добавляется.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByTestId("values").textContent).toBe("1");

    // Второй такт с ответом — точка добавляется.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await waitFor(() => expect(screen.getByTestId("values")).toHaveTextContent("1,9"));
  });

  it("смена диапазона перезапрашивает ряд", async () => {
    const loadHistory = vi.fn().mockResolvedValue([{ time: 1000, value: 1 }]);
    const { rerender } = render(
      <Probe rangeKey="1h" loadHistory={loadHistory} pollLive={vi.fn().mockResolvedValue(0)} />
    );
    await waitFor(() => expect(loadHistory).toHaveBeenCalledWith("1h"));

    rerender(<Probe rangeKey="7d" loadHistory={loadHistory} pollLive={vi.fn().mockResolvedValue(0)} />);

    await waitFor(() => expect(loadHistory).toHaveBeenCalledWith("7d"));
  });

  it("окно фиксированного диапазона — его длительность", async () => {
    render(
      <Probe rangeKey="24h" loadHistory={vi.fn().mockResolvedValue([])} pollLive={vi.fn().mockResolvedValue(0)} />
    );

    await waitFor(() => expect(screen.getByTestId("window")).toHaveTextContent(String(24 * 60 * 60 * 1000)));
  });

  it("у «всё время» окно растягивается до самой старой точки", async () => {
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    render(
      <Probe
        rangeKey="all"
        loadHistory={vi.fn().mockResolvedValue([{ time: twoDaysAgo, value: 1 }])}
        pollLive={vi.fn().mockResolvedValue(0)}
      />
    );

    await waitFor(() => {
      const windowMs = Number(screen.getByTestId("window").textContent);
      expect(windowMs).toBeGreaterThan(24 * 60 * 60 * 1000);
    });
  });

  it("ошибка загрузки истории видна, а не проглатывается", async () => {
    render(
      <Probe
        rangeKey="all"
        loadHistory={vi.fn().mockRejectedValue(new Error("503 метрики недоступны"))}
        pollLive={vi.fn().mockResolvedValue(0)}
      />
    );

    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("метрики недоступны"));
  });

  it("возврат во вкладку перезагружает историю и сохраняет более свежие живые точки", async () => {
    const loadHistory = vi
      .fn()
      .mockResolvedValueOnce([{ time: Date.now() - 1000, value: 1 }])
      .mockResolvedValue([
        { time: Date.now() - 1000, value: 1 },
        { time: Date.now() - 500, value: 2 },
      ]);

    render(<Probe rangeKey="1h" loadHistory={loadHistory} pollLive={vi.fn().mockResolvedValue(7)} />);
    await waitFor(() => expect(screen.getByTestId("values")).toHaveTextContent("1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await waitFor(() => expect(screen.getByTestId("values")).toHaveTextContent("1,7"));

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // История пришла заново (с точкой 2 за период скрытия), живая точка 7
    // новее истории — осталась на месте.
    await waitFor(() => expect(screen.getByTestId("values")).toHaveTextContent("1,2,7"));
    expect(loadHistory).toHaveBeenCalledTimes(2);
  });

  it("долгий пропуск живого опроса перезагружает историю", async () => {
    const loadHistory = vi.fn().mockResolvedValue([{ time: Date.now() - 1000, value: 1 }]);
    let failing = true;
    const pollLive = vi.fn().mockImplementation(() => (failing ? Promise.reject(new Error("сеть")) : Promise.resolve(7)));

    render(<Probe rangeKey="1h" loadHistory={loadHistory} pollLive={pollLive} />);
    await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(1));

    // 20 с без единого ответа — дольше порога пропуска (15 с).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    failing = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    await waitFor(() => expect(loadHistory.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("живые точки несут шаг опроса", async () => {
    let seen: { stepMs?: number }[] = [];
    function StepProbe() {
      const series = useMetricsSeries<number>({
        loadHistory: async () => [],
        pollLive: async () => 5,
        rangeKey: "1h",
        intervalMs: 1000,
      });
      seen = series.samples;
      return null;
    }

    render(<StepProbe />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0].stepMs).toBe(1000);
  });
});
