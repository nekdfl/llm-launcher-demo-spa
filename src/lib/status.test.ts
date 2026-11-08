import { describe, expect, it } from "vitest";
import { accentClassFor, hasLikelyTraffic, presentStatus, statusLineClass } from "./status";

describe("presentStatus", () => {
  it("maps running to the primary color and Russian label", () => {
    const p = presentStatus("running");
    expect(p.label).toBe("работает");
    expect(p.color).toBe("#3ce36a");
  });

  it("maps failed and unresponsive to the same red but different labels", () => {
    const failed = presentStatus("failed");
    const unresponsive = presentStatus("unresponsive");
    expect(failed.color).toBe(unresponsive.color);
    expect(failed.label).not.toBe(unresponsive.label);
  });

  it("maps stopped to a neutral color", () => {
    expect(presentStatus("stopped").label).toBe("остановлен");
  });
});

describe("hasLikelyTraffic", () => {
  it("is true for running and unresponsive", () => {
    expect(hasLikelyTraffic("running")).toBe(true);
    expect(hasLikelyTraffic("unresponsive")).toBe(true);
  });

  it("is false for warming and stopped — no false flat-zero graph", () => {
    expect(hasLikelyTraffic("warming")).toBe(false);
    expect(hasLikelyTraffic("stopped")).toBe(false);
  });

  it("is false for failed", () => {
    expect(hasLikelyTraffic("failed")).toBe(false);
  });
});

describe("accentClassFor", () => {
  it("gives every status an accent class", () => {
    expect(accentClassFor("running")).toBe("tactical-accent");
    expect(accentClassFor("warming")).toBe("tactical-accent-warn");
    expect(accentClassFor("unresponsive")).toBe("tactical-accent-danger");
    expect(accentClassFor("failed")).toBe("tactical-accent-danger");
    expect(accentClassFor("stopped")).toBe("tactical-accent-off");
  });
});

describe("statusLineClass", () => {
  it("is green only while running", () => {
    expect(statusLineClass("running")).toBe("tactical-accent");
  });

  it("is yellow for warming", () => {
    expect(statusLineClass("warming")).toBe("tactical-accent-warn");
  });

  it("is red for every status that is not serving", () => {
    expect(statusLineClass("stopped")).toBe("tactical-accent-danger");
    expect(statusLineClass("failed")).toBe("tactical-accent-danger");
    expect(statusLineClass("unresponsive")).toBe("tactical-accent-danger");
  });

  it("is yellow while an action is in flight, whatever the status says", () => {
    expect(statusLineClass("running", { transitioning: true })).toBe("tactical-accent-warn");
    expect(statusLineClass("stopped", { transitioning: true })).toBe("tactical-accent-warn");
  });

  it("falls back to neutral before the first status arrives", () => {
    expect(statusLineClass(null)).toBe("tactical-accent-off");
  });
});
