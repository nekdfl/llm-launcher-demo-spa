// SPA stores JWT in localStorage and attaches it as `Authorization: Bearer`
// (dashboard-and-inference-console spec — decided over httpOnly cookies
// because SPA and DRF share an origin behind nginx and CSRF doesn't apply
// to a bearer token in a header).
const ACCESS_KEY = "llm_launcher_access_token";
const REFRESH_KEY = "llm_launcher_refresh_token";

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function setAccessToken(access: string): void {
  localStorage.setItem(ACCESS_KEY, access);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function isLoggedIn(): boolean {
  return getAccessToken() !== null;
}
