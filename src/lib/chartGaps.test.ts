import { describe, expect, it } from "vitest";
import { splitSeriesSegments } from "./chartGaps";

const sample = (time: number) => ({ time, value: time });

describe("splitSeriesSegments", () => {
  it("даёт один отрезок на непрерывном ряде", () => {
    const samples = [0, 5000, 10000, 15000].map(sample);

    expect(splitSeriesSegments(samples)).toHaveLength(1);
  });

  it("разрывает ряд там, где данных нет", () => {
    const samples = [0, 5000, 10000, 3_600_000, 3_605_000].map(sample);

    const segments = splitSeriesSegments(samples);

    expect(segments).toHaveLength(2);
    expect(segments[0].map((s) => s.time)).toEqual([0, 5000, 10000]);
    expect(segments[1].map((s) => s.time)).toEqual([3_600_000, 3_605_000]);
  });

  it("дрожание интервала опроса разрывом не считается", () => {
    const samples = [0, 5200, 9900, 15400].map(sample);

    expect(splitSeriesSegments(samples)).toHaveLength(1);
  });

  it("пустой ряд даёт ни одного отрезка", () => {
    expect(splitSeriesSegments([])).toEqual([]);
  });

  it("один отсчёт — один отрезок", () => {
    expect(splitSeriesSegments([sample(42)])).toHaveLength(1);
  });

  it("история с шагом прореживания не рассыпается, сколько бы живых точек ни пришло", () => {
    const now = 1_000_000_000_000;
    // «Сутки»: 720 точек истории с шагом 121 с, затем 40 минут живых точек раз в 2 с.
    const history = Array.from({ length: 720 }, (_, i) => ({ time: now - (720 - i) * 121_000, value: 0, stepMs: 121_000 }));
    const live = Array.from({ length: 1200 }, (_, i) => ({ time: now + (i + 1) * 2000, value: 0, stepMs: 2000 }));

    expect(splitSeriesSegments([...history, ...live])).toHaveLength(1);
  });

  it("стык истории и живых точек разрывом не считается", () => {
    // Последняя точка истории — начало бакета; первая живая — через бакет и опрос.
    const samples = [
      { time: 0, value: 0, stepMs: 121_000 },
      { time: 121_000, value: 0, stepMs: 121_000 },
      { time: 121_000 + 123_000, value: 0, stepMs: 2000 },
      { time: 121_000 + 125_000, value: 0, stepMs: 2000 },
    ];

    expect(splitSeriesSegments(samples)).toHaveLength(1);
  });

  it("настоящий пропуск в живых точках — разрыв", () => {
    const samples = [0, 2000, 4000, 64_000, 66_000].map((time) => ({ time, value: 0, stepMs: 2000 }));

    expect(splitSeriesSegments(samples)).toHaveLength(2);
  });
});
