import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, AuthExpiredError, apiFetch, apiJson } from "./client";
import { clearTokens, getAccessToken, setTokens } from "./tokens";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("apiFetch", () => {
  beforeEach(() => {
    clearTokens();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearTokens();
  });

  it("attaches the access token as Authorization: Bearer", async () => {
    setTokens("access-1", "refresh-1");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, { ok: true }));

    await apiFetch("/orchestrator/api/inferences");

    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer access-1");
  });

  it("refreshes once and retries on a 401, then keeps the new token", async () => {
    setTokens("expired-access", "refresh-1");
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      call += 1;
      const url = String(input);
      if (url.includes("/auth/token/refresh/")) {
        return jsonResponse(200, { access: "fresh-access" });
      }
      if (call === 1) {
        return jsonResponse(401, { detail: "expired" });
      }
      return jsonResponse(200, { ok: true });
    });

    const response = await apiFetch("/orchestrator/api/inferences");

    expect(response.status).toBe(200);
    expect(getAccessToken()).toBe("fresh-access");
  });

  it("clears tokens and throws AuthExpiredError when refresh itself fails", async () => {
    setTokens("expired-access", "expired-refresh");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/auth/token/refresh/")) {
        return jsonResponse(401, { detail: "invalid refresh" });
      }
      return jsonResponse(401, { detail: "expired" });
    });

    await expect(apiFetch("/orchestrator/api/inferences")).rejects.toBeInstanceOf(AuthExpiredError);
    expect(getAccessToken()).toBeNull();
  });

  it("does not attempt refresh when there is no refresh token", async () => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls += 1;
      return jsonResponse(401, { detail: "unauthorized" });
    });

    const response = await apiFetch("/orchestrator/api/inferences");

    expect(response.status).toBe(401);
    expect(calls).toBe(1);
  });
});

describe("apiJson", () => {
  beforeEach(() => {
    clearTokens();
    vi.restoreAllMocks();
  });

  it("returns parsed JSON on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, { hello: "world" }));

    const result = await apiJson<{ hello: string }>("/x");

    expect(result).toEqual({ hello: "world" });
  });

  it("throws ApiError with status and body on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(409, { detail: "конфликт" }));

    await expect(apiJson("/x")).rejects.toBeInstanceOf(ApiError);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(409, { detail: "конфликт" }));
    await expect(apiJson("/x")).rejects.toMatchObject({ status: 409 });
  });

  it("returns undefined for a 204 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    const result = await apiJson("/x");

    expect(result).toBeUndefined();
  });
});
