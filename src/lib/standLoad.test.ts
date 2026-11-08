import { describe, expect, it } from "vitest";
import type { HostLoadSnapshot } from "../api/orchestrator";
import { toStandLoadValues } from "./standLoad";

function snapshot(overrides: Partial<HostLoadSnapshot> = {}): HostLoadSnapshot {
  return {
    cpu_percent: 0,
    ram_percent: 0,
    disk_read_bytes_per_sec: 0,
    disk_write_bytes_per_sec: 0,
    net_recv_bytes_per_sec: 0,
    net_sent_bytes_per_sec: 0,
    ...overrides,
  };
}

const GIB = 1024 ** 3;
const TOTAL_RAM = 30 * GIB;

describe("toStandLoadValues", () => {
  it("passes cpu through clamped to 0-100", () => {
    expect(toStandLoadValues(snapshot({ cpu_percent: 45 }), TOTAL_RAM).cpu).toBe(45);
    expect(toStandLoadValues(snapshot({ cpu_percent: 220 }), TOTAL_RAM).cpu).toBe(100);
  });

  it("turns the ram percentage into an absolute volume", () => {
    const values = toStandLoadValues(snapshot({ ram_percent: 25 }), TOTAL_RAM);
    expect(values.ramBytes).toBe(0.25 * TOTAL_RAM);
    expect(values.ramPercent).toBe(25);
  });

  it("keeps ram unknown when the stand volume is unknown", () => {
    const values = toStandLoadValues(snapshot({ ram_percent: 25 }), null);
    expect(values.ramBytes).toBeNull();
    // Процент остаётся — это честное отсутствие объёма, а не потеря данных.
    expect(values.ramPercent).toBe(25);
  });

  it("keeps read and write apart instead of summing them", () => {
    const values = toStandLoadValues(
      snapshot({ disk_read_bytes_per_sec: 1000, disk_write_bytes_per_sec: 2500 }),
      TOTAL_RAM
    );
    expect(values.diskRead).toBe(1000);
    expect(values.diskWrite).toBe(2500);
  });

  it("keeps receive and send apart instead of summing them", () => {
    const values = toStandLoadValues(
      snapshot({ net_recv_bytes_per_sec: 700, net_sent_bytes_per_sec: 300 }),
      TOTAL_RAM
    );
    expect(values.netRecv).toBe(700);
    expect(values.netSent).toBe(300);
  });

  it("never uses the download ceilings to scale disk or network", () => {
    // Величина в 3 МБ/с остаётся собой независимо от того, какой потолок
    // настроен для закачек: в графике состояния стенда потолков нет.
    const values = toStandLoadValues(snapshot({ disk_read_bytes_per_sec: 3 * 1024 ** 2 }), TOTAL_RAM);
    expect(values.diskRead).toBe(3 * 1024 ** 2);
  });

  it("does not produce negative rates from a counter reset", () => {
    const values = toStandLoadValues(snapshot({ disk_read_bytes_per_sec: -5 }), TOTAL_RAM);
    expect(values.diskRead).toBe(0);
  });
});
