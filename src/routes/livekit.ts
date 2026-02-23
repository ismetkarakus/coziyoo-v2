import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { isLiveKitConfigured, mintLiveKitToken } from "../services/livekit.js";

const RoomTokenSchema = z.object({
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

export const liveKitRouter = Router();

liveKitRouter.use((_, res, next) => {
  if (!isLiveKitConfigured()) {
    return res.status(503).json({
      error: {
        code: "LIVEKIT_NOT_CONFIGURED",
        message: "Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in API environment.",
      },
    });
  }
  return next();
});

liveKitRouter.post("/token", requireAuth("app"), async (req, res) => {
  const parsed = RoomTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const identity = input.participantIdentity ?? `user-${req.auth!.userId}`;
  const metadata = input.metadata ?? JSON.stringify({ userId: req.auth!.userId, role: req.auth!.role });

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
    },
  });
});

liveKitRouter.post("/agent-token", async (req, res) => {
  if (!env.AI_SERVER_SHARED_SECRET) {
    return res.status(503).json({
      error: {
        code: "AI_SERVER_SHARED_SECRET_MISSING",
        message: "Set AI_SERVER_SHARED_SECRET before using /v1/livekit/agent-token.",
      },
    });
  }

  const provided = String(req.headers["x-ai-server-secret"] ?? "");
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(env.AI_SERVER_SHARED_SECRET, "utf8");

  const valid =
    provided.length > 0 &&
    providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer);

  if (!valid) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Invalid AI server shared secret" },
    });
  }

  const parsed = AgentTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const identity = input.participantIdentity ?? `${env.LIVEKIT_AGENT_IDENTITY}-${crypto.randomUUID().slice(0, 8)}`;
  const metadata = input.metadata ?? JSON.stringify({ kind: "ai-agent", source: "coziyoo-api" });

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
    },
  });
});
