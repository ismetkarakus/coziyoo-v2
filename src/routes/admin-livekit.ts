import crypto from "node:crypto";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import {
  buildRoomScopedAgentIdentity,
  dispatchAgentJoin,
  ensureLiveKitRoom,
  isLiveKitConfigured,
  isParticipantInRoom,
  mintLiveKitToken,
} from "../services/livekit.js";

const UserTokenSchema = z.object({
  roomName: z.string().min(1).max(128),
  participantIdentity: z.string().min(3).max(128).optional(),
  participantName: z.string().min(1).max(128).optional(),
  metadata: z.string().max(2_000).optional(),
  canPublish: z.boolean().optional(),
  canSubscribe: z.boolean().optional(),
  canPublishData: z.boolean().optional(),
  ttlSeconds: z.coerce.number().int().positive().max(86_400).optional(),
});

const AgentTokenSchema = z.object({
  roomName: z.string().min(1).max(128),
  participantIdentity: z.string().min(3).max(128).optional(),
  participantName: z.string().min(1).max(128).optional(),
  metadata: z.string().max(2_000).optional(),
  ttlSeconds: z.coerce.number().int().positive().max(86_400).optional(),
});

const DispatchAgentSchema = AgentTokenSchema.extend({
  payload: z.record(z.string(), z.unknown()).optional(),
});

const StartSessionSchema = z.object({
  roomName: z.string().min(1).max(128).optional(),
  participantIdentity: z.string().min(3).max(128).optional(),
  participantName: z.string().min(1).max(128).optional(),
  metadata: z.string().max(2_000).optional(),
  ttlSeconds: z.coerce.number().int().positive().max(86_400).optional(),
});

function tokenPreview(token: string) {
  const payload = jwt.decode(token);
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const iat = typeof payload.iat === "number" ? new Date(payload.iat * 1000).toISOString() : null;
  const exp = typeof payload.exp === "number" ? new Date(payload.exp * 1000).toISOString() : null;

  return {
    iat,
    exp,
    claims: payload,
  };
}

export const adminLiveKitRouter = Router();

adminLiveKitRouter.use(requireAuth("admin"));

adminLiveKitRouter.get("/status", (_req, res) => {
  return res.json({
    data: {
      configured: isLiveKitConfigured(),
      wsUrl: env.LIVEKIT_URL ?? null,
      aiServerUrl: env.AI_SERVER_URL ?? null,
      aiServerJoinPath: env.AI_SERVER_LIVEKIT_JOIN_PATH,
      hasApiKey: Boolean(env.LIVEKIT_API_KEY),
      hasApiSecret: Boolean(env.LIVEKIT_API_SECRET),
      hasAiSharedSecret: Boolean(env.AI_SERVER_SHARED_SECRET),
      defaultTtlSeconds: env.LIVEKIT_TOKEN_TTL_SECONDS,
      agentIdentityDefault: env.LIVEKIT_AGENT_IDENTITY,
    },
  });
});

adminLiveKitRouter.post("/token/user", async (req, res) => {
  if (!isLiveKitConfigured()) {
    return res.status(503).json({
      error: {
        code: "LIVEKIT_NOT_CONFIGURED",
        message: "Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in API environment.",
      },
    });
  }

  const parsed = UserTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const identity = input.participantIdentity ?? `admin-preview-user-${Date.now()}`;
  const metadata = input.metadata ?? JSON.stringify({ source: "admin-panel", kind: "user-token-preview" });

  const token = await mintLiveKitToken({
    identity,
    name: input.participantName,
    metadata,
    ttlSeconds: input.ttlSeconds,
    grant: {
      roomJoin: true,
      room: input.roomName,
      canPublish: input.canPublish ?? true,
      canSubscribe: input.canSubscribe ?? true,
      canPublishData: input.canPublishData ?? true,
    },
  });

  return res.status(201).json({
    data: {
      roomName: input.roomName,
      participantIdentity: identity,
      wsUrl: env.LIVEKIT_URL,
      token,
      preview: tokenPreview(token),
    },
  });
});

adminLiveKitRouter.post("/token/agent", async (req, res) => {
  if (!isLiveKitConfigured()) {
    return res.status(503).json({
      error: {
        code: "LIVEKIT_NOT_CONFIGURED",
        message: "Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in API environment.",
      },
    });
  }

  const parsed = AgentTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const identity = input.participantIdentity ?? `${env.LIVEKIT_AGENT_IDENTITY}-${Date.now()}`;
  const metadata = input.metadata ?? JSON.stringify({ source: "admin-panel", kind: "agent-token-preview" });

  const token = await mintLiveKitToken({
    identity,
    name: input.participantName ?? env.LIVEKIT_AGENT_IDENTITY,
    metadata,
    ttlSeconds: input.ttlSeconds,
    grant: {
      roomJoin: true,
      room: input.roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  });

  return res.status(201).json({
    data: {
      roomName: input.roomName,
      participantIdentity: identity,
      wsUrl: env.LIVEKIT_URL,
      token,
      preview: tokenPreview(token),
    },
  });
});

adminLiveKitRouter.post("/dispatch/agent", async (req, res) => {
  if (!isLiveKitConfigured()) {
    return res.status(503).json({
      error: {
        code: "LIVEKIT_NOT_CONFIGURED",
        message: "Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in API environment.",
      },
    });
  }

  if (!env.AI_SERVER_URL) {
    return res.status(503).json({
      error: {
        code: "AI_SERVER_URL_MISSING",
        message: "Set AI_SERVER_URL to dispatch agent tokens.",
      },
    });
  }

  const parsed = DispatchAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const identity = input.participantIdentity ?? `${env.LIVEKIT_AGENT_IDENTITY}-${Date.now()}`;
  const metadata = input.metadata ?? JSON.stringify({ source: "admin-panel", kind: "agent-dispatch" });

  const token = await mintLiveKitToken({
    identity,
    name: input.participantName ?? env.LIVEKIT_AGENT_IDENTITY,
    metadata,
    ttlSeconds: input.ttlSeconds,
    grant: {
      roomJoin: true,
      room: input.roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  });

  try {
    const dispatch = await dispatchAgentJoin({
      roomName: input.roomName,
      participantIdentity: identity,
      participantName: input.participantName ?? env.LIVEKIT_AGENT_IDENTITY,
      token,
      metadata,
      payload: input.payload,
    });

    return res.status(201).json({
      data: {
        roomName: input.roomName,
        participantIdentity: identity,
        wsUrl: env.LIVEKIT_URL,
        token,
        preview: tokenPreview(token),
        dispatch,
      },
    });
  } catch (error) {
    return res.status(502).json({
      error: {
        code: "AI_SERVER_DISPATCH_FAILED",
        message: error instanceof Error ? error.message : "Dispatch failed",
      },
    });
  }
});

adminLiveKitRouter.post("/session/start", async (req, res) => {
  if (!isLiveKitConfigured()) {
    return res.status(503).json({
      error: {
        code: "LIVEKIT_NOT_CONFIGURED",
        message: "Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in API environment.",
      },
    });
  }

  if (!env.AI_SERVER_URL) {
    return res.status(503).json({
      error: {
        code: "AI_SERVER_URL_MISSING",
        message: "Set AI_SERVER_URL to auto-join agent.",
      },
    });
  }

  const parsed = StartSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const roomName = input.roomName ?? `coziyoo-room-${crypto.randomUUID().slice(0, 8)}`;
  const userIdentity = input.participantIdentity ?? `admin-preview-user-${Date.now()}`;
  const userMetadata = input.metadata ?? JSON.stringify({ source: "admin-panel", kind: "session-start-user" });
  const agentIdentity = buildRoomScopedAgentIdentity(roomName);
  const agentName = env.LIVEKIT_AGENT_IDENTITY;
  const agentMetadata = JSON.stringify({ source: "admin-panel", kind: "session-start-agent", roomName });

  try {
    await ensureLiveKitRoom(roomName);
  } catch (error) {
    return res.status(502).json({
      error: {
        code: "LIVEKIT_ROOM_CREATE_FAILED",
        message: error instanceof Error ? error.message : "Room create failed",
      },
    });
  }

  const userToken = await mintLiveKitToken({
    identity: userIdentity,
    name: input.participantName,
    metadata: userMetadata,
    ttlSeconds: input.ttlSeconds,
    grant: {
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  });

  const agentToken = await mintLiveKitToken({
    identity: agentIdentity,
    name: agentName,
    metadata: agentMetadata,
    ttlSeconds: input.ttlSeconds,
    grant: {
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  });

  try {
    const alreadyRunning = await isParticipantInRoom(roomName, agentIdentity);
    const dispatch = alreadyRunning
      ? null
      : await dispatchAgentJoin({
          roomName,
          participantIdentity: agentIdentity,
          participantName: agentName,
          token: agentToken,
          metadata: agentMetadata,
        });

    return res.status(201).json({
      data: {
        roomName,
        wsUrl: env.LIVEKIT_URL,
        user: {
          participantIdentity: userIdentity,
          token: userToken,
        },
        agent: {
          participantIdentity: agentIdentity,
          dispatched: alreadyRunning ? false : (dispatch?.ok ?? false),
          alreadyRunning,
          dispatch,
          preview: tokenPreview(agentToken),
        },
      },
    });
  } catch (error) {
    return res.status(502).json({
      error: {
        code: "AI_SERVER_DISPATCH_FAILED",
        message: error instanceof Error ? error.message : "Agent dispatch failed",
      },
    });
  }
});
