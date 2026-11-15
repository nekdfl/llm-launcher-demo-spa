import { describe, expect, it } from "vitest";
import type { Inference, Profile } from "../api/types";
import { inferenceEntry } from "../api/__fixtures__/inference";
import { hasProfileDiscrepancy } from "./discrepancy";

function makeInference(overrides: Partial<Inference> = {}): Inference {
  return inferenceEntry({
    gpu_ids: [0],
    structural_fields: { driver: "cpu" },
    cli_options: "--ctx-size 4096",
    ...overrides,
  });
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 1,
    name: "default",
    model_id: 1,
    plugin_id: 1,
    gpu_ids: [0],
    port: 8080,
    structural_fields: { driver: "cpu" },
    cli_options: "--ctx-size 4096",
    system_prompt: "",
    plugin_version: "0.1.0",
    schema_hash: "abc",
    origin_profile_id: null,
    needs_review: false,
    extensions: {},
    ...overrides,
  };
}

describe("hasProfileDiscrepancy", () => {
  it("is false when values match exactly", () => {
    expect(hasProfileDiscrepancy(makeInference(), makeProfile())).toBe(false);
  });

  it("is true when cli_options diverge", () => {
    const inference = makeInference({ cli_options: "--ctx-size 8192" });
    expect(hasProfileDiscrepancy(inference, makeProfile())).toBe(true);
  });

  it("is true when gpu_ids diverge regardless of order", () => {
    const inference = makeInference({ gpu_ids: [1, 0] });
    const profile = makeProfile({ gpu_ids: [0, 1] });
    expect(hasProfileDiscrepancy(inference, profile)).toBe(false); // same set, different order

    const divergedInference = makeInference({ gpu_ids: [0] });
    const divergedProfile = makeProfile({ gpu_ids: [0, 1] });
    expect(hasProfileDiscrepancy(divergedInference, divergedProfile)).toBe(true);
  });

  it("is true when structural_fields diverge", () => {
    const inference = makeInference({ structural_fields: { driver: "nvidia" } });
    expect(hasProfileDiscrepancy(inference, makeProfile())).toBe(true);
  });

  it("is true when extensions diverge", () => {
    const inference = makeInference({ extensions: { "ru-stress": { stress_mode: "auto" } } });
    expect(hasProfileDiscrepancy(inference, makeProfile())).toBe(true);
  });

  it("ignores key order in structural_fields", () => {
    const inference = makeInference({ structural_fields: { b: 1, driver: "cpu" } });
    const profile = makeProfile({ structural_fields: { driver: "cpu", b: 1 } });
    expect(hasProfileDiscrepancy(inference, profile)).toBe(false);
  });

  it("is true when port diverges", () => {
    const inference = makeInference({ port: 9090 });
    expect(hasProfileDiscrepancy(inference, makeProfile())).toBe(true);
  });

  it("is true when belonging to a different profile id", () => {
    const inference = makeInference({ profile_id: 2 });
    expect(hasProfileDiscrepancy(inference, makeProfile({ id: 1 }))).toBe(true);
  });

  it("ignores profile.port being null (no default port set)", () => {
    const inference = makeInference({ port: 9090 });
    const profile = makeProfile({ port: null });
    expect(hasProfileDiscrepancy(inference, profile)).toBe(false);
  });
});
