import { AccessToken, RoomServiceClient, type VideoGrant } from "livekit-server-sdk";
import { env } from "../config/env.js";

function configured() {
  return Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);
}

export function isLiveKitConfigured() {
  return configured();
}

type MintTokenInput = {
  identity: string;
  name?: string;
  metadata?: string;
  ttlSeconds?: number;
  grant: VideoGrant;
};

export async function mintLiveKitToken(input: MintTokenInput) {
  if (!configured()) {
    throw new Error("LIVEKIT_NOT_CONFIGURED");
  }

  const token = new AccessToken(env.LIVEKIT_API_KEY as string, env.LIVEKIT_API_SECRET as string, {
    identity: input.identity,
    name: input.name,
    metadata: input.metadata,
    ttl: `${input.ttlSeconds ?? env.LIVEKIT_TOKEN_TTL_SECONDS}s`,
  });
  token.addGrant(input.grant);

  return token.toJwt();
}

function liveKitHttpUrl() {
  const raw = env.LIVEKIT_URL as string;
  if (raw.startsWith("wss://")) return `https://${raw.slice("wss://".length).replace(/\/+$/, "")}`;
  if (raw.startsWith("ws://")) return `http://${raw.slice("ws://".length).replace(/\/+$/, "")}`;
  if (raw.startsWith("https://") || raw.startsWith("http://")) return raw.replace(/\/+$/, "");
  return raw.replace(/\/+$/, "");
}

function isRoomAlreadyExistsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return lower.includes("already exists") || lower.includes("already_exists") || lower.includes("alreadyexists");
}

export async function ensureLiveKitRoom(roomName: string) {
  if (!configured()) {
    throw new Error("LIVEKIT_NOT_CONFIGURED");
  }

  const client = new RoomServiceClient(
    liveKitHttpUrl(),
    env.LIVEKIT_API_KEY as string,
    env.LIVEKIT_API_SECRET as string
  );

  try {
    await client.createRoom({ name: roomName });
  } catch (error) {
    if (!isRoomAlreadyExistsError(error)) {
      throw error;
    }
  }
}

export function buildRoomScopedAgentIdentity(roomName: string) {
  const normalized = roomName
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const fallback = normalized.length > 0 ? normalized : "room";
  const suffix = fallback.slice(0, 96);
  return `${env.LIVEKIT_AGENT_IDENTITY}-${suffix}`;
}

export async function isParticipantInRoom(roomName: string, identity: string) {
  if (!configured()) {
    throw new Error("LIVEKIT_NOT_CONFIGURED");
  }

  const client = new RoomServiceClient(
    liveKitHttpUrl(),
    env.LIVEKIT_API_KEY as string,
    env.LIVEKIT_API_SECRET as string
  );

  const participants = await client.listParticipants(roomName);
  return participants.some((participant) => participant.identity === identity);
}

export type DispatchAgentInput = {
  roomName: string;
  participantIdentity: string;
  participantName: string;
  token: string;
  metadata: string;
  payload?: Record<string, unknown>;
};

export async function dispatchAgentJoin(input: DispatchAgentInput) {
  if (!env.AI_SERVER_URL) {
    throw new Error("AI_SERVER_URL_MISSING");
  }

  const endpoint = new URL(env.AI_SERVER_LIVEKIT_JOIN_PATH, env.AI_SERVER_URL).toString();
  const headers = new Headers({ "content-type": "application/json" });
  if (env.AI_SERVER_SHARED_SECRET) {
    headers.set("x-ai-server-secret", env.AI_SERVER_SHARED_SECRET);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.AI_SERVER_TIMEOUT_MS);

  try {
    const downstream = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        roomName: input.roomName,
        participantIdentity: input.participantIdentity,
        participantName: input.participantName,
        wsUrl: env.LIVEKIT_URL,
        token: input.token,
        metadata: input.metadata,
        ...(input.payload ? { payload: input.payload } : {}),
      }),
      signal: controller.signal,
    });

    let body: unknown = null;
    try {
      body = await downstream.json();
    } catch {
      body = await downstream.text();
    }

    return {
      endpoint,
      ok: downstream.ok,
      status: downstream.status,
      body,
    };
  } finally {
    clearTimeout(timeout);
  }
}
