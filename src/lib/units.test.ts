import { describe, expect, it } from "vitest";
import { formatBitRate, formatByteRate, formatMemory } from "./units";

describe("formatMemory", () => {
  it("uses ГиБ above one gibibyte", () => {
    expect(formatMemory(1024 ** 3)).toBe("1.0 ГиБ");
    expect(formatMemory(12 * 1024 ** 3)).toBe("12 ГиБ");
  });

  it("uses МиБ between mebibyte and gibibyte", () => {
    expect(formatMemory(1024 ** 2)).toBe("1 МиБ");
    expect(formatMemory(512 * 1024 ** 2)).toBe("512 МиБ");
  });

  it("falls back to КиБ and bytes below a mebibyte", () => {
    expect(formatMemory(2048)).toBe("2 КиБ");
    expect(formatMemory(512)).toBe("512 Б");
    expect(formatMemory(0)).toBe("0 Б");
  });

  it("shows a dash for missing data instead of zero", () => {
    expect(formatMemory(null)).toBe("—");
    expect(formatMemory(Number.NaN)).toBe("—");
  });
});

describe("formatByteRate", () => {
  it("uses КБ/с below a megabyte per second", () => {
    expect(formatByteRate(1024)).toBe("1 КБ/с");
    expect(formatByteRate(286_000)).toBe("279 КБ/с");
  });

  it("uses МБ/с at and above a megabyte per second", () => {
    expect(formatByteRate(1024 ** 2)).toBe("1.0 МБ/с");
    expect(formatByteRate(45 * 1024 ** 2)).toBe("45 МБ/с");
  });

  it("shows bytes per second below a kilobyte per second", () => {
    expect(formatByteRate(999)).toBe("999 Б/с");
  });

  it("shows a dash for missing data", () => {
    expect(formatByteRate(null)).toBe("—");
  });
});

describe("formatBitRate", () => {
  it("converts bytes per second to bits and uses Кбит/с", () => {
    // 15 000 B/s = 120 000 bit/s = 120 Кбит/с
    expect(formatBitRate(15_000)).toBe("120 Кбит/с");
  });

  it("uses Мбит/с from one megabit per second", () => {
    // 125 000 B/s = 1 000 000 bit/s = 1 Мбит/с
    expect(formatBitRate(125_000)).toBe("1.0 Мбит/с");
    // 10 GbE: 1.25 GB/s = 10 Gbit/s
    expect(formatBitRate(1_250_000_000)).toBe("10000 Мбит/с");
  });

  it("shows bits per second below a kilobit per second", () => {
    expect(formatBitRate(100)).toBe("800 бит/с");
  });

  it("shows a dash for missing data", () => {
    expect(formatBitRate(null)).toBe("—");
  });
});
