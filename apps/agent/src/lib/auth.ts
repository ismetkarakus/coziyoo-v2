import type { Tokens } from "../types";

const TOKEN_KEY = "coziyoo_agent_tokens";

export function getTokens(): Tokens | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Tokens;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setTokens(tokens: Tokens | null) {
  if (!tokens) {
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function isLoggedIn() {
  return Boolean(getTokens()?.accessToken);
}
