import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_POWER_SCALE_WATTS,
  powerScaleMax,
  ThroughputPowerChart,
  throughputScaleMax,
} from "./ThroughputPowerChart";

const tok = (time: number, tokensInPerSec: number, tokensOutPerSec: number) => ({
  time,
  value: { tokensInPerSec, tokensOutPerSec },
});

describe("throughputScaleMax", () => {
  it("растёт ступенями по 50", () => {
    expect(throughputScaleMax(0)).toBe(50);
    expect(throughputScaleMax(50)).toBe(50);
    expect(throughputScaleMax(50.1)).toBe(100);
    expect(throughputScaleMax(120)).toBe(150);
  });
});

describe("powerScaleMax", () => {
  it("берёт предел самой мощной карты", () => {
    expect(powerScaleMax([350, 390, null])).toBe(390);
  });

  it("без известных пределов — 390 W", () => {
    expect(powerScaleMax([null, null])).toBe(DEFAULT_POWER_SCALE_WATTS);
    expect(powerScaleMax([])).toBe(390);
  });
});

describe("ThroughputPowerChart", () => {
  it("tok/s и мощность карт — на одном полотне с правой осью", () => {
    render(
      <ThroughputPowerChart
        throughput={[tok(0, 10, 20), tok(5000, 12, 24)]}
        power={[
          { time: 0, value: { "0": 12, "1": 310 } },
          { time: 5000, value: { "0": 15, "1": 320 } },
        ]}
        gpuIds={[0, 1]}
        powerLimitsWatts={[390, 350]}
      />
    );

    expect(screen.getAllByTestId("time-series-chart")).toHaveLength(1);
    // Вход, выход и по линии на каждую из двух карт.
    expect(screen.getAllByTestId("chart-line-segment")).toHaveLength(4);
    expect(screen.getByTestId("chart-right-axis").textContent).toContain("390 W");
  });

  it("шкала мощности фиксирована: 60 W на шкале 390 W — нижняя часть полотна", () => {
    render(
      <ThroughputPowerChart
        throughput={[tok(0, 0, 0), tok(5000, 0, 0)]}
        power={[
          { time: 0, value: { "0": 60 } },
          { time: 5000, value: { "0": 60 } },
        ]}
        gpuIds={[0]}
        powerLimitsWatts={[390]}
      />
    );

    const powerLine = screen
      .getAllByTestId("chart-line-segment")
      .find((line) => line.getAttribute("stroke") === "#199e70");
    const y = Number(powerLine?.getAttribute("points")?.split(" ")[0].split(",")[1]);
    // Область 10..156: 60/390 высоты от низа ≈ 133.5.
    expect(y).toBeCloseTo(156 - (60 / 390) * 146, 1);
  });

  it("шкала tok/s — ступень 50, без запаса", () => {
    render(<ThroughputPowerChart throughput={[tok(0, 30, 120), tok(5000, 10, 20)]} power={[]} gpuIds={[]} powerLimitsWatts={[]} />);

    expect(screen.getByTestId("time-series-chart").textContent).toContain("150");
  });

  it("пустой пул GPU — без правой оси и линий мощности", () => {
    render(<ThroughputPowerChart throughput={[tok(0, 10, 20), tok(5000, 12, 24)]} power={[]} gpuIds={[]} powerLimitsWatts={[]} />);

    expect(screen.queryByTestId("chart-right-axis")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("chart-line-segment")).toHaveLength(2);
  });

  it("нет данных мощности — без правой оси, а не нулевые линии", () => {
    render(
      <ThroughputPowerChart throughput={[tok(0, 10, 20), tok(5000, 12, 24)]} power={[]} gpuIds={[0, 1]} powerLimitsWatts={[null, null]} />
    );

    expect(screen.queryByTestId("chart-right-axis")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("chart-line-segment")).toHaveLength(2);
  });

  it("разрыв по одной карте не даёт нулевой линии", () => {
    render(
      <ThroughputPowerChart
        throughput={[]}
        gpuIds={[0, 1]}
        powerLimitsWatts={[390, 390]}
        power={[
          { time: 0, value: { "0": 12, "1": 310 } },
          { time: 5000, value: { "0": 15, "1": 320 } },
          { time: 10000, value: { "0": 17, "1": 315 } },
          { time: 200_000, value: { "0": 18 } },
          { time: 205_000, value: { "0": 20, "1": 300 } },
          { time: 210_000, value: { "0": 22, "1": 290 } },
        ]}
      />
    );

    const cardOneLines = screen
      .getAllByTestId("chart-line-segment")
      .filter((line) => line.getAttribute("stroke") === "#9085e9");
    expect(cardOneLines).toHaveLength(2);
  });
});
