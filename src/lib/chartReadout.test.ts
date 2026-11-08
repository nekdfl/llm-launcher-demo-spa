import { describe, expect, it } from "vitest";
import type { TimeSeriesSample } from "../components/TimeSeriesChart";
import { readAtTime, segmentsFrom } from "./chartReadout";

function sample(time: number, values: Record<string, number>): TimeSeriesSample {
  return { time, values };
}

const single = (samples: TimeSeriesSample[]) => segmentsFrom([samples]);

describe("readAtTime", () => {
  it("returns the sample value where a sample sits", () => {
    const segments = single([sample(1000, { a: 10 }), sample(2000, { a: 20 })]);
    expect(readAtTime(segments, 1000)?.values.a).toBe(10);
    expect(readAtTime(segments, 2000)?.values.a).toBe(20);
  });

  it("interpolates between two samples instead of snapping to the nearest", () => {
    const segments = single([sample(1000, { a: 10 }), sample(2000, { a: 20 })]);
    // Середина шага — 15, а не 10 или 20: именно этого не хватало при чтении
    // по контрольным отметкам.
    expect(readAtTime(segments, 1500)?.values.a).toBeCloseTo(15);
    expect(readAtTime(segments, 1250)?.values.a).toBeCloseTo(12.5);
  });

  it("interpolates every series of the sample independently", () => {
    const segments = single([
      sample(1000, { read: 0, write: 100 }),
      sample(2000, { read: 100, write: 0 }),
    ]);
    const readout = readAtTime(segments, 1500);
    expect(readout?.values.read).toBeCloseTo(50);
    expect(readout?.values.write).toBeCloseTo(50);
  });

  it("returns nothing before the first and after the last sample", () => {
    const segments = single([sample(1000, { a: 10 }), sample(2000, { a: 20 })]);
    expect(readAtTime(segments, 999)).toBeNull();
    expect(readAtTime(segments, 2001)).toBeNull();
  });

  it("returns nothing inside a gap between segments, not zero", () => {
    const segments = segmentsFrom([
      [sample(1000, { a: 10 }), sample(2000, { a: 20 })],
      [sample(9000, { a: 90 }), sample(10000, { a: 100 })],
    ]);
    // 5000 — разрыв: нулей и любых других выдуманных значений быть не должно.
    expect(readAtTime(segments, 5000)).toBeNull();
    expect(readAtTime(segments, 2500)).toBeNull();
    // А внутри второго отрезка значение читается.
    expect(readAtTime(segments, 9500)?.values.a).toBeCloseTo(95);
  });

  it("reads the nearest sample at a segment edge", () => {
    const segments = segmentsFrom([
      [sample(1000, { a: 10 }), sample(2000, { a: 20 })],
      [sample(9000, { a: 90 }), sample(10000, { a: 100 })],
    ]);
    expect(readAtTime(segments, 1000)?.values.a).toBe(10);
    expect(readAtTime(segments, 9000)?.values.a).toBe(90);
  });

  it("returns nothing for an empty series", () => {
    expect(readAtTime([], 1000)).toBeNull();
  });

  it("handles a single-sample segment as a constant value", () => {
    const segments = single([sample(1000, { a: 42 })]);
    expect(readAtTime(segments, 1000)?.values.a).toBe(42);
  });
});
