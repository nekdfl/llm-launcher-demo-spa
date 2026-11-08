import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Sample } from "../hooks/useRollingWindow";
import type { StandLoadValues } from "../lib/standLoad";
import { StandLoadChart, standLoadScales } from "./StandLoadChart";

const GIB = 1024 ** 3;

function values(overrides: Partial<StandLoadValues> = {}): StandLoadValues {
  return {
    cpu: 0,
    ramBytes: null,
    ramPercent: 0,
    diskRead: 0,
    diskWrite: 0,
    netRecv: 0,
    netSent: 0,
    ...overrides,
  };
}

function sample(time: number, value: StandLoadValues): Sample<StandLoadValues> {
  return { time, value };
}

describe("StandLoadChart", () => {
  const now = Date.now();

  it("рисует один график вместо четырёх отдельных панелей", () => {
    render(<StandLoadChart samples={[sample(now, values({ cpu: 5 }))]} />);

    // Одна область отрисовки: события в один момент сопоставимы по времени.
    expect(screen.getAllByTestId("time-series-chart")).toHaveLength(1);
    expect(screen.queryByTestId("stand-load-cpu")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stand-load-disk")).not.toBeInTheDocument();
  });

  it("рисует шесть линий: cpu, mem, чтение/запись диска, приём/отдача сети", () => {
    render(<StandLoadChart samples={[sample(now, values({ cpu: 1, diskRead: 1, diskWrite: 1 }))]} />);

    const polylines = screen.getAllByTestId("chart-line-segment");
    expect(polylines).toHaveLength(6);
  });

  it("направления обмена остаются отдельными линиями, а не суммой", () => {
    const { container } = render(
      <StandLoadChart samples={[sample(now, values({ diskRead: 3 * 1024 ** 2, diskWrite: 1024 ** 2, netRecv: 125_000, netSent: 62_500 }))]} />
    );

    // Разные стили линий у пары: сплошная и пунктир — так пара различима.
    const dashes = Array.from(container.querySelectorAll("polyline")).map((node) =>
      node.getAttribute("stroke-dasharray")
    );
    expect(dashes.filter((value) => value !== null).length).toBeGreaterThanOrEqual(3);
  });

  /** Y последней точки линии с данным цветом и пунктиром. */
  function lastY(container: HTMLElement, stroke: string, dash: string | null): number {
    const line = Array.from(container.querySelectorAll("polyline")).find(
      (node) => node.getAttribute("stroke") === stroke && node.getAttribute("stroke-dasharray") === dash
    );
    const points = (line?.getAttribute("points") ?? "").trim().split(" ");
    return Number(points[points.length - 1].split(",")[1]);
  }
  // Область графика: y от 10 (верх) до 156 (ноль).
  const yOf = (fraction: number) => 156 - fraction * 146;

  it("CPU — шкала 0–100%: 20% стоят на пятой части высоты", () => {
    const { container } = render(
      <StandLoadChart samples={[sample(now - 5000, values({ cpu: 20 })), sample(now, values({ cpu: 20 }))]} />
    );

    expect(lastY(container, "#3987e5", null)).toBeCloseTo(yOf(0.2), 1);
  });

  it("память — шкала до всего объёма RAM: 32 из 128 ГиБ на четверти высоты", () => {
    const { container } = render(
      <StandLoadChart
        ramTotalBytes={128 * GIB}
        samples={[sample(now - 5000, values({ ramPercent: 25 })), sample(now, values({ ramPercent: 25 }))]}
      />
    );

    expect(lastY(container, "#d95926", "4,2")).toBeCloseTo(yOf(0.25), 1);
  });

  it("сеть и диск масштабируются по ступеням, а не по собственному пику", () => {
    // Сеть 30 Мбит/с → шкала 50; диск 40 МиБ/с → шкала 300 МиБ/с.
    const net = (30 * 1_000_000) / 8;
    const { container } = render(
      <StandLoadChart
        samples={[
          sample(now - 5000, values({ netRecv: net, diskRead: 40 * 1024 ** 2 })),
          sample(now, values({ netRecv: net, diskRead: 40 * 1024 ** 2 })),
        ]}
      />
    );

    expect(lastY(container, "#9085e9", null)).toBeCloseTo(yOf(30 / 50), 1);
    expect(lastY(container, "#199e70", null)).toBeCloseTo(yOf(40 / 300), 1);
  });

  it("показывает пустое состояние, когда отсчётов нет", () => {
    render(<StandLoadChart samples={[]} />);

    expect(screen.getAllByTestId("chart-empty")).toHaveLength(1);
  });

  it("рисует разрыв между отрезками разрывом, а не прямой через провал", () => {
    const samples = [
      sample(now - 60 * 60 * 1000, values({ diskRead: 1024 ** 2 })),
      sample(now - 60 * 60 * 1000 + 5000, values({ diskRead: 1024 ** 2 })),
      sample(now - 60_000, values({ diskRead: 4 * 1024 ** 2 })),
      sample(now, values({ diskRead: 4 * 1024 ** 2 })),
    ];
    render(<StandLoadChart samples={samples} />);

    // Два непрерывных отрезка на каждую из шести серий.
    const polylines = screen.getAllByTestId("chart-line-segment");
    expect(polylines.length).toBeGreaterThanOrEqual(12);
  });
});

describe("standLoadScales", () => {
  const MBIT = 1_000_000 / 8;
  const MIB = 1024 ** 2;
  const at = (overrides: Partial<StandLoadValues>) => [sample(0, values(overrides))];

  it("ступени сети: 1, 10, 50, 100, 500, 1000 Мбит/с", () => {
    const net = (mbit: number) => standLoadScales(at({ netRecv: mbit * MBIT }), null).netBytesPerSec / MBIT;
    expect(net(0)).toBe(1);
    expect(net(0.5)).toBe(1);
    expect(net(1)).toBe(1);
    expect(net(1.1)).toBe(10);
    expect(net(30)).toBe(50);
    expect(net(700)).toBe(1000);
    expect(net(2000)).toBe(1000);
  });

  it("сеть — общая шкала приёма и отдачи по большему из пиков", () => {
    expect(standLoadScales(at({ netRecv: 0, netSent: 80 * MBIT }), null).netBytesPerSec / MBIT).toBe(100);
  });

  it("ступени диска: 300, 600, 1000 МБ/с по пику чтения и записи", () => {
    const disk = (mb: number) => standLoadScales(at({ diskWrite: mb * MIB }), null).diskBytesPerSec / MIB;
    expect(disk(40)).toBe(300);
    expect(disk(300)).toBe(300);
    expect(disk(450)).toBe(600);
    expect(disk(800)).toBe(1000);
    expect(disk(2500)).toBe(1000);
  });

  it("CPU — всегда 100%, память — весь объём RAM или проценты без него", () => {
    expect(standLoadScales(at({ cpu: 5 }), 64 * GIB)).toMatchObject({ cpuPercent: 100, memBytes: 64 * GIB });
    expect(standLoadScales(at({}), null).memBytes).toBeNull();
  });
});
