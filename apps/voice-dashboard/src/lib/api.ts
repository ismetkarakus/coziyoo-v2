import { getTokens, setTokens, setAdmin } from "./auth";

const configuredApiBase =
  (process.env.NEXT_PUBLIC_API_BASE_URL as string | undefined)?.trim() || "https://api.coziyoo.com";

// Call API directly instead of same-origin proxy routes.
export const API_BASE = configuredApiBase.replace(/\/+$/, "");

export let refreshInFlight: Promise<boolean> | null = null;

export async function request(path: string, init?: RequestInit, retry = true): Promise<Response> {
  const tokens = getTokens();
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("content-type") && init?.body) {
    headers.set("content-type", "application/json");
  }
  if (tokens?.accessToken) {
    headers.set("authorization", `Bearer ${tokens.accessToken}`);
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (response.status === 401 && retry && tokens?.refreshToken) {
    const refreshed = await refreshTokenSerialized(tokens.refreshToken);
    if (refreshed) {
      return request(path, init, false);
    }
  }

  return response;
}

export async function refreshTokenSerialized(refreshTokenValue: string): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = refreshToken(refreshTokenValue).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function refreshToken(refreshTokenValue: string): Promise<boolean> {
  const response = await fetch(`${API_BASE}/v1/admin/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: refreshTokenValue }),
  });

  if (response.status !== 200) {
    setTokens(null);
    setAdmin(null);
    return false;
  }

  const json = (await response.json()) as { data: { tokens: { accessToken: string; refreshToken: string } } };
  setTokens({
    accessToken: json.data.tokens.accessToken,
    refreshToken: json.data.tokens.refreshToken,
  });
  return true;
}

export async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function postJsonWith415Fallback(path: string, payload: unknown): Promise<Response> {
  const asJson = JSON.stringify(payload);

  const primary = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: asJson,
  });
  if (primary.status !== 415) return primary;

  return fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "text/plain; charset=utf-8", accept: "application/json" },
    body: asJson,
  });
}

export async function logout(): Promise<void> {
  try {
    await request("/v1/admin/auth/logout", { method: "POST" });
  } finally {
    setTokens(null);
    setAdmin(null);
  }
}
