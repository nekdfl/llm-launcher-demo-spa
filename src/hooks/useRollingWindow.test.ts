import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRollingWindow } from "./useRollingWindow";

describe("useRollingWindow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accumulates a sample on each poll", async () => {
    let n = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      n += 1;
      return n;
    });
    const { result } = renderHook(() => useRollingWindow(fetchFn, 1000));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toHaveLength(1);
    expect(result.current[0].value).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(result.current).toHaveLength(2);
    expect(result.current[1].value).toBe(2);
  });

  it("drops samples older than the 1h window", async () => {
    const fetchFn = vi.fn().mockResolvedValue(1);
    const { result } = renderHook(() => useRollingWindow(fetchFn, 1000));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(61 * 60 * 1000); // 61 minutes later, single big jump
      await Promise.resolve();
    });

    // The very first sample (now 61 minutes old) must have been pruned.
    const oldestAge = Date.now() - result.current[0].time;
    expect(oldestAge).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it("does not accumulate when disabled", async () => {
    const fetchFn = vi.fn().mockResolvedValue(1);
    const { result } = renderHook(() => useRollingWindow(fetchFn, 1000, false));

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(result.current).toHaveLength(0);
  });

  it("skips a failed poll without throwing", async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(5);
    const { result } = renderHook(() => useRollingWindow(fetchFn, 1000));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(result.current).toHaveLength(1);
    expect(result.current[0].value).toBe(5);
  });
});
