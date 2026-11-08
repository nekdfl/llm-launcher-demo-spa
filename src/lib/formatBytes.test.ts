import { describe, expect, it } from "vitest";
import { formatBytes } from "./formatBytes";

describe("formatBytes", () => {
  it("returns an em-dash for null", () => {
    expect(formatBytes(null)).toBe("—");
  });

  it("formats gigabytes with one decimal", () => {
    expect(formatBytes(21.4 * 1024 ** 3)).toBe("21.4 GB");
  });

  it("formats sub-gigabyte values in MB", () => {
    expect(formatBytes(512 * 1024 ** 2)).toBe("512 MB");
  });

  it("formats sub-megabyte values in KB instead of rounding to 0 MB", () => {
    expect(formatBytes(900 * 1024)).toBe("900 KB");
  });

  it("formats sub-kilobyte values in whole bytes", () => {
    expect(formatBytes(300)).toBe("300 B");
  });

  it("formats exactly zero as 0 B, not an em-dash", () => {
    expect(formatBytes(0)).toBe("0 B");
  });
});
