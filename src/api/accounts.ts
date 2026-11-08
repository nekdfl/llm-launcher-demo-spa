import { apiJson } from "./client";
import type { SystemUser } from "./types";

const BASE = "/accounts";

/** DRF user management (web-auth-users-roles) — the whole ViewSet is
 * admin-only server-side; a non-admin gets 403 on every call. The SPA also
 * uses a successful `list` as its role probe: the JWT carries no role claim,
 * but only an admin can list users. */
export const accountsApi = {
  listUsers: () => apiJson<SystemUser[]>(`${BASE}/users/`),
  createUser: (username: string, password: string, role: string) =>
    apiJson<SystemUser>(`${BASE}/users/`, {
      method: "POST",
      body: JSON.stringify({ username, password, role }),
    }),
  updateUser: (id: number, payload: Partial<Pick<SystemUser, "role" | "is_active">> & { password?: string }) =>
    apiJson<SystemUser>(`${BASE}/users/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteUser: (id: number) => apiJson<void>(`${BASE}/users/${id}/`, { method: "DELETE" }),

  /** Role probe: 200 means the caller is admin, 403 means not. */
  async isAdmin(): Promise<boolean> {
    try {
      await this.listUsers();
      return true;
    } catch {
      return false;
    }
  },
};
