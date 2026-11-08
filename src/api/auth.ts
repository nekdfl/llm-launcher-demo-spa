import { apiJson } from "./client";
import { clearTokens, setTokens } from "./tokens";

export async function login(username: string, password: string): Promise<void> {
  const data = await apiJson<{ access: string; refresh: string }>("/auth/token/", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  setTokens(data.access, data.refresh);
}

export function logout(): void {
  clearTokens();
}
