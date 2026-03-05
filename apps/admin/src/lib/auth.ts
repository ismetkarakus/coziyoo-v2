import type { AdminUser, Tokens } from "../types/core";

export const TOKEN_KEY = "coziyoo_admin_tokens";
export const ADMIN_KEY = "coziyoo_admin_me";
export const BUILD_COMMIT = (import.meta.env.VITE_GIT_COMMIT as string | undefined) ?? "unknown";

export function getTokens(): Tokens | null {
  const raw = sessionStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Tokens;
  } catch {
    return null;
  }
}

export function setTokens(tokens: Tokens | null) {
  if (!tokens) {
    sessionStorage.removeItem(TOKEN_KEY);
    return;
  }
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function getAdmin(): AdminUser | null {
  const raw = sessionStorage.getItem(ADMIN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AdminUser;
  } catch {
    return null;
  }
}

export function setAdmin(admin: AdminUser | null) {
  if (!admin) {
    sessionStorage.removeItem(ADMIN_KEY);
    return;
  }
  sessionStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
}
