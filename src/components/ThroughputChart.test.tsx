import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThroughputChart } from "./ThroughputChart";

const point = (tokensInPerSec: number, tokensOutPerSec: number) => ({ tokensInPerSec, tokensOutPerSec });

describe("ThroughputChart", () => {
  it("рисует ряд пропускной способности", () => {
    render(
      <ThroughputChart
        samples={[
          { time: 0, value: point(10, 20) },
          { time: 5000, value: point(12, 24) },
        ]}
      />
    );

    expect(screen.getAllByTestId("chart-line-segment").length).toBeGreaterThan(0);
  });

  it("отсутствие данных за период остаётся разрывом, а не нулевой линией", () => {
    render(
      <ThroughputChart
        samples={[
          { time: 0, value: point(10, 20) },
          { time: 5000, value: point(12, 24) },
          // Такт без учтённых токенов точки не оставляет — здесь провал.
          { time: 600_000, value: point(8, 16) },
          { time: 605_000, value: point(9, 18) },
        ]}
      />
    );

    // По два отрезка на каждую из двух линий: вход и выход.
    expect(screen.getAllByTestId("chart-line-segment")).toHaveLength(4);
  });
});
