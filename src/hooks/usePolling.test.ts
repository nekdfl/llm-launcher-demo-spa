import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePolling } from "./usePolling";

describe("usePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches immediately on mount", async () => {
    const fetchFn = vi.fn().mockResolvedValue(42);
    const { result } = renderHook(() => usePolling(fetchFn, 2000));

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe(42);
  });

  it("polls again after the interval elapses", async () => {
    const fetchFn = vi.fn().mockResolvedValue(1);
    renderHook(() => usePolling(fetchFn, 2000));

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not poll when disabled", async () => {
    const fetchFn = vi.fn().mockResolvedValue(1);
    renderHook(() => usePolling(fetchFn, 2000, false));

    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
    });

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("surfaces a rejected fetch as an error without throwing", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => usePolling(fetchFn, 2000));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.error).toBeInstanceOf(Error);
  });
});
