import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimeSeriesChart, type TimeSeriesSample } from "./TimeSeriesChart";

const series = [
  { key: "in", label: "вход", color: "#3987e5" },
  { key: "out", label: "выход", color: "#d95926" },
];

describe("TimeSeriesChart", () => {
  it("shows an empty state message with no samples", () => {
    render(<TimeSeriesChart samples={[]} series={series} yMax={100} yMaxLabel="100" />);
    expect(screen.getByTestId("chart-empty")).toBeInTheDocument();
  });

  it("draws one polyline per series", () => {
    const samples: TimeSeriesSample[] = [
      { time: Date.now() - 1000, values: { in: 10, out: 20 } },
      { time: Date.now(), values: { in: 15, out: 25 } },
    ];
    const { container } = render(<TimeSeriesChart samples={samples} series={series} yMax={100} yMaxLabel="100" />);

    const polylines = container.querySelectorAll("polyline");
    expect(polylines).toHaveLength(2);
  });

  it("applies the series dash pattern for secondary encoding", () => {
    const dashed = [{ key: "ram", label: "RAM", color: "#d95926", dash: "4,2" }];
    const samples: TimeSeriesSample[] = [{ time: Date.now(), values: { ram: 50 } }];
    const { container } = render(<TimeSeriesChart samples={samples} series={dashed} yMax={100} yMaxLabel="100%" />);

    const polyline = container.querySelector("polyline");
    expect(polyline).toHaveAttribute("stroke-dasharray", "4,2");
  });

  it("filters samples outside the 1h window", () => {
    const now = Date.now();
    const samples: TimeSeriesSample[] = [
      { time: now - 2 * 60 * 60 * 1000, values: { in: 999, out: 999 } }, // 2h ago, out of window
      { time: now, values: { in: 5, out: 5 } },
    ];
    const { container } = render(<TimeSeriesChart samples={samples} series={series} yMax={100} yMaxLabel="100" />);

    const polyline = container.querySelector("polyline");
    // Only one point plotted (the in-window sample) — a single M/L-less "x,y" pair.
    expect(polyline?.getAttribute("points")?.trim().split(" ")).toHaveLength(1);
  });
});

describe("TimeSeriesChart — чтение значения в позиции курсора", () => {
  const HOUR = 60 * 60 * 1000;

  function chart(container: HTMLElement) {
    const svg = container.querySelector("svg") as SVGSVGElement;
    // jsdom не считает layout: задаём ширину, от которой зависит пересчёт
    // экранных пикселей в координаты viewBox.
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 600, height: 205, right: 600, bottom: 205, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    return svg;
  }

  // jsdom отбрасывает clientX из init-объекта pointer-события, поэтому
  // координата ставится через defineProperty — иначе обработчик видит NaN.
  function moveTo(svg: SVGSVGElement, x: number) {
    const event = createEvent.pointerMove(svg);
    Object.defineProperty(event, "clientX", { value: x });
    Object.defineProperty(event, "clientY", { value: 80 });
    fireEvent(svg, event);
  }

  function leave(svg: SVGSVGElement) {
    fireEvent.pointerLeave(svg);
  }

  it("не рисует зон наведения по отметкам оси", () => {
    const samples: TimeSeriesSample[] = [{ time: Date.now(), values: { in: 10, out: 20 } }];
    const { container } = render(<TimeSeriesChart samples={samples} series={series} yMax={100} yMaxLabel="100" />);

    expect(container.querySelectorAll(".hit")).toHaveLength(0);
    expect(screen.queryAllByTestId("chart-hover-region")).toHaveLength(0);
  });

  it("ставит курсор туда, где курсор мыши, а не на отметку оси", () => {
    const now = Date.now();
    const samples: TimeSeriesSample[] = [
      { time: now - HOUR, values: { in: 0, out: 0 } },
      { time: now, values: { in: 100, out: 100 } },
    ];
    const { container } = render(<TimeSeriesChart samples={samples} series={series} yMax={100} yMaxLabel="100" />);
    const svg = chart(container);

    // x=250 — между контрольными отметками оси (они на 40, 85.8, 131.6, …).
    moveTo(svg, 250);

    const cursor = screen.getByTestId("chart-cursor");
    expect(Number(cursor.getAttribute("x1"))).toBeCloseTo(250, 6);
    // Крестовина не совпадает ни с одной отметкой оси.
    expect([40, 85.83, 131.67, 177.5]).not.toContain(Number(cursor.getAttribute("x1")));
  });

  it("читает интерполированное значение в точке между отметками", () => {
    const now = Date.now();
    const samples: TimeSeriesSample[] = [
      { time: now - HOUR, values: { in: 0, out: 0 } },
      { time: now, values: { in: 100, out: 200 } },
    ];
    const { container } = render(<TimeSeriesChart samples={samples} series={series} yMax={100} yMaxLabel="100" />);
    const svg = chart(container);

    moveTo(svg, 315); // середина plot-области (40…590)

    // Середина ряда даёт половину: 50, а не 0 и не 100 — именно этого не
    // хватало при чтении по контрольным отметкам.
    expect(screen.getByText("вход: 50")).toBeInTheDocument();
    expect(screen.getByText("выход: 100")).toBeInTheDocument();
  });

  it("снимает крестовину при уходе курсора с графика", () => {
    const samples: TimeSeriesSample[] = [{ time: Date.now(), values: { in: 10, out: 20 } }];
    const { container } = render(<TimeSeriesChart samples={samples} series={series} yMax={100} yMaxLabel="100" />);
    const svg = chart(container);

    moveTo(svg, 300);
    expect(screen.getByTestId("chart-cursor")).toBeInTheDocument();

    leave(svg);
    expect(screen.queryByTestId("chart-cursor")).not.toBeInTheDocument();
  });

  it("в разрыве данных показывает отсутствие значения, а не ноль", () => {
    const now = Date.now();
    const samples: TimeSeriesSample[] = [
      // Два отрезка с большим провалом между ними (порог разрыва — 15 с).
      { time: now - HOUR, values: { in: 0, out: 0 } },
      { time: now - HOUR + 60_000, values: { in: 10, out: 10 } },
      { time: now - 60_000, values: { in: 90, out: 90 } },
      { time: now, values: { in: 100, out: 100 } },
    ];
    const { container } = render(<TimeSeriesChart samples={samples} series={series} yMax={100} yMaxLabel="100" />);
    const svg = chart(container);

    // Середина часового окна — внутри провала.
    moveTo(svg, 315);

    expect(screen.getAllByText(/нет данных/).length).toBeGreaterThan(0);
    expect(screen.queryByText("вход: 0")).not.toBeInTheDocument();
  });
});
