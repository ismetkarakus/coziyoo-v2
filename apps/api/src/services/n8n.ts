import { env } from "../config/env.js";

export type N8nStatus = {
  configured: boolean;
  reachable: boolean;
  baseUrl: string | null;
};

function buildHeaders() {
  const headers = new Headers();
  if (env.N8N_API_KEY) {
    headers.set("x-n8n-api-key", env.N8N_API_KEY);
    headers.set("authorization", `Bearer ${env.N8N_API_KEY}`);
  }
  return headers;
}

export async function getN8nStatus(options?: { baseUrl?: string | null }): Promise<N8nStatus> {
  const configuredBaseUrl = options?.baseUrl?.trim() || env.N8N_BASE_URL || null;
  if (!configuredBaseUrl) {
    return {
      configured: false,
      reachable: false,
      baseUrl: null,
    };
  }

  try {
    const endpoint = new URL("/healthz", configuredBaseUrl).toString();
    const response = await fetch(endpoint, {
      method: "GET",
      headers: buildHeaders(),
    });
    return {
      configured: true,
      reachable: response.ok,
      baseUrl: configuredBaseUrl,
    };
  } catch {
    return {
      configured: true,
      reachable: false,
      baseUrl: configuredBaseUrl,
    };
  }
}

export function resolveToolWebhookEndpoint(toolId: string, options?: { baseUrl?: string | null }) {
  const configuredBaseUrl = options?.baseUrl?.trim() || env.N8N_BASE_URL || null;
  if (!configuredBaseUrl) {
    throw new Error("N8N_NOT_CONFIGURED");
  }

  const webhookPath = `/webhook/coziyoo/${encodeURIComponent(toolId)}`;
  return new URL(webhookPath, configuredBaseUrl).toString();
}

export async function runN8nToolWebhook(input: {
  toolId: string;
  toolInput?: string;
  roomName?: string;
  username?: string;
  baseUrl?: string | null;
}) {
  const endpoint = resolveToolWebhookEndpoint(input.toolId, { baseUrl: input.baseUrl });

  const upstream = await fetch(endpoint, {
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      ...Object.fromEntries(buildHeaders().entries()),
    }),
    body: JSON.stringify({
      toolId: input.toolId,
      input: input.toolInput ?? "",
      roomName: input.roomName ?? null,
      username: input.username ?? null,
      source: "agent",
      timestamp: new Date().toISOString(),
    }),
  });

  const raw = await upstream.text();
  let body: unknown = raw;
  try {
    body = raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    body = raw;
  }

  return {
    endpoint,
    ok: upstream.ok,
    status: upstream.status,
    body,
  };
}
