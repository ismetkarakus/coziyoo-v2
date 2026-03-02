import { getTokens, setTokens } from "./auth";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

type RefreshResponse = {
  data?: {
    tokens?: {
      accessToken: string;
      refreshToken: string;
    };
  };
};

async function refreshToken(): Promise<boolean> {
  const tokens = getTokens();
  if (!tokens?.refreshToken) return false;
  const res = await fetch(`${API_BASE}/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  });
  if (!res.ok) {
    setTokens(null);
    return false;
  }
  const body = (await res.json()) as RefreshResponse;
  const refreshed = body.data?.tokens;
  if (!refreshed?.accessToken || !refreshed?.refreshToken) {
    setTokens(null);
    return false;
  }
  setTokens({ accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken });
  return true;
}

export async function request(path: string, init?: RequestInit, retry = true): Promise<Response> {
  const headers = new Headers(init?.headers);
  const tokens = getTokens();
  if (tokens?.accessToken) headers.set("authorization", `Bearer ${tokens.accessToken}`);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401 && retry && tokens?.refreshToken) {
    const ok = await refreshToken();
    if (ok) return request(path, init, false);
  }
  return res;
}

export async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
