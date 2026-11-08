import { clearTokens, getAccessToken, getRefreshToken, setAccessToken } from "./tokens";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

export class AuthExpiredError extends Error {}

/** The orchestrator's own message for a rejected request. `ApiError.message`
 * is only "API error <status>", so a 409 like the duplicate-download guard's
 * would otherwise reach the user as that — the useful text is in the proxied
 * `detail` body. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const detail = (error.body as { detail?: unknown } | null)?.detail;
    if (typeof detail === "string" && detail) return detail;
    const message = (detail as { message?: unknown } | null)?.message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

/** Поле формы, к которому сервер отнёс ошибку (`detail.field`, например
 * `extensions.ru-tts-text.stress_mode`) — чтобы показать её у поля. */
export function apiErrorField(error: unknown): string | null {
  if (error instanceof ApiError) {
    const field = ((error.body as { detail?: unknown } | null)?.detail as { field?: unknown } | null)?.field;
    if (typeof field === "string" && field) return field;
  }
  return null;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;

  const response = await fetch("/auth/token/refresh/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!response.ok) return false;

  const data = (await response.json()) as { access: string };
  setAccessToken(data.access);
  return true;
}

function refreshOnce(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/** Attaches the access token, and on a 401 tries exactly one refresh before
 * retrying the request once — if that also fails, clears tokens and lets
 * the caller redirect to login (spec: token survives a page reload via
 * localStorage until the refresh token itself expires). */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const doFetch = (): Promise<Response> => {
    const token = getAccessToken();
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    // FormData (архив плагина или расширения, аудио консоли): заголовок с
    // границей частей ставит браузер, JSON-тип сломал бы multipart.
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return fetch(path, { ...init, headers });
  };

  let response = await doFetch();

  if (response.status === 401 && getRefreshToken()) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      response = await doFetch();
    } else {
      clearTokens();
      throw new AuthExpiredError();
    }
  }

  return response;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // no JSON body
    }
    throw new ApiError(response.status, body);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Ответ как текст, а не JSON: журнал запуска отдаётся строками, и
 * разбирать его как JSON нечего. */
export async function apiText(path: string, init: RequestInit = {}): Promise<string> {
  const response = await apiFetch(path, init);

  if (!response.ok) {
    throw new ApiError(response.status, null);
  }

  return response.text();
}
