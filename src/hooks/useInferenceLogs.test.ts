import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTokens, setTokens } from "../api/tokens";
import { useInferenceLogs } from "./useInferenceLogs";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  emit(data: string) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  close() {
    this.closed = true;
  }
}

describe("useInferenceLogs", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    // @ts-expect-error - test stub
    globalThis.EventSource = FakeEventSource;
    setTokens("access-token-1", "refresh-1");
  });

  afterEach(() => {
    clearTokens();
  });

  it("connects with the access token as a query parameter", () => {
    renderHook(() => useInferenceLogs("inf-1"));

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toContain("/orchestrator/inferences/inf-1/logs/stream/");
    expect(FakeEventSource.instances[0].url).toContain("token=access-token-1");
  });

  it("appends each incoming line", () => {
    const { result } = renderHook(() => useInferenceLogs("inf-1"));
    const source = FakeEventSource.instances[0];

    act(() => {
      source.emit("first line");
    });
    act(() => {
      source.emit("second line");
    });

    expect(result.current).toEqual(["first line", "second line"]);
  });

  it("closes the connection on unmount", () => {
    const { unmount } = renderHook(() => useInferenceLogs("inf-1"));
    const source = FakeEventSource.instances[0];

    unmount();

    expect(source.closed).toBe(true);
  });

  it("does not connect when inferenceId is null", () => {
    renderHook(() => useInferenceLogs(null));

    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
