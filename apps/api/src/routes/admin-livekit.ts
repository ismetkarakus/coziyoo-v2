import crypto from "node:crypto";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.js";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";
import { askOllamaChat } from "../services/ollama.js";
import {
  buildRoomScopedAgentIdentity,
  dispatchAgentJoin,
  ensureLiveKitRoom,
  isLiveKitConfigured,
  isParticipantInRoom,
  mintLiveKitToken,
  sendRoomData,
} from "../services/livekit.js";
import { getStarterAgentSettings, upsertStarterAgentSettings } from "../services/starter-agent-settings.js";
import { normalizeTtsEngine } from "../services/tts-engines.js";

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

const AgentChatSchema = z.object({
  roomName: z.string().min(1).max(128),
  text: z.string().min(1).max(8_000),
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
      voiceMode: "assistant_native_audio",
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
          voiceMode: "assistant_native_audio",
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

adminLiveKitRouter.post("/agent/chat", async (req, res) => {
  if (!isLiveKitConfigured()) {
    return res.status(503).json({
      error: {
        code: "LIVEKIT_NOT_CONFIGURED",
        message: "Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in API environment.",
      },
    });
  }

  const parsed = AgentChatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const agentIdentity = buildRoomScopedAgentIdentity(input.roomName);

  try {
    const answer = await askOllamaChat(input.text);
    const payload = {
      type: "agent_message",
      from: agentIdentity,
      text: answer.text,
      ts: new Date().toISOString(),
      model: answer.model,
    };

    await sendRoomData(input.roomName, payload, { topic: "chat" });

    return res.status(201).json({
      data: {
        roomName: input.roomName,
        agentIdentity,
        message: payload,
      },
    });
  } catch (error) {
    return res.status(502).json({
      error: {
        code: "AGENT_CHAT_FAILED",
        message: error instanceof Error ? error.message : "Agent chat failed",
      },
    });
  }
});

// ── Voice Agent Settings ─────────────────────────────────────────────────────

const AdminAgentSettingsSchema = z.object({
  agentName: z.string().max(128).optional(),
  voiceLanguage: z.string().min(2).max(16).optional(),
  ollamaModel: z.string().max(128).optional(),
  ollamaBaseUrl: z.string().optional(),
  ttsEngine: z.enum(["f5-tts", "xtts", "chatterbox"]).optional(),
  ttsEnabled: z.boolean().optional(),
  ttsBaseUrl: z.string().optional(),
  sttEnabled: z.boolean().optional(),
  sttProvider: z.string().max(64).optional(),
  sttBaseUrl: z.string().optional(),
  sttTranscribePath: z.string().max(256).optional(),
  sttModel: z.string().max(128).optional(),
  n8nBaseUrl: z.string().optional(),
  systemPrompt: z.string().max(4_000).optional(),
  greetingEnabled: z.boolean().optional(),
  greetingInstruction: z.string().max(2_000).optional(),
});

adminLiveKitRouter.get("/agent-settings", async (_req, res) => {
  const result = await pool.query(
    `SELECT device_id, agent_name, voice_language, ollama_model, tts_engine, tts_enabled, stt_enabled, updated_at
     FROM starter_agent_settings ORDER BY updated_at DESC`,
  );
  return res.json({ data: result.rows });
});

adminLiveKitRouter.get("/agent-settings/:deviceId", async (req, res) => {
  const settings = await getStarterAgentSettings(req.params.deviceId);
  if (!settings) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "No settings found for this device" } });
  }
  return res.json({ data: settings });
});

adminLiveKitRouter.put("/agent-settings/:deviceId", async (req, res) => {
  const parsed = AdminAgentSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const { deviceId } = req.params;
  const input = parsed.data;
  const existing = await getStarterAgentSettings(deviceId);

  const existingTtsConfig = (existing?.ttsConfig ?? {}) as Record<string, unknown>;
  const existingStt = (typeof existingTtsConfig.stt === "object" && existingTtsConfig.stt !== null ? existingTtsConfig.stt : {}) as Record<string, unknown>;
  const existingLlm = (typeof existingTtsConfig.llm === "object" && existingTtsConfig.llm !== null ? existingTtsConfig.llm : {}) as Record<string, unknown>;
  const existingN8n = (typeof existingTtsConfig.n8n === "object" && existingTtsConfig.n8n !== null ? existingTtsConfig.n8n : {}) as Record<string, unknown>;

  const mergedTtsConfig = {
    ...existingTtsConfig,
    ...(input.ttsBaseUrl !== undefined ? { baseUrl: input.ttsBaseUrl || null } : {}),
    stt: {
      ...existingStt,
      ...(input.sttProvider !== undefined ? { provider: input.sttProvider } : {}),
      ...(input.sttBaseUrl !== undefined ? { baseUrl: input.sttBaseUrl || null } : {}),
      ...(input.sttTranscribePath !== undefined ? { transcribePath: input.sttTranscribePath } : {}),
      ...(input.sttModel !== undefined ? { model: input.sttModel } : {}),
    },
    llm: {
      ...existingLlm,
      ...(input.ollamaBaseUrl !== undefined ? { ollamaBaseUrl: input.ollamaBaseUrl || null } : {}),
    },
    n8n: {
      ...existingN8n,
      ...(input.n8nBaseUrl !== undefined ? { baseUrl: input.n8nBaseUrl || null } : {}),
    },
  };

  const settings = await upsertStarterAgentSettings({
    deviceId,
    agentName: input.agentName ?? existing?.agentName ?? "coziyoo-agent",
    voiceLanguage: input.voiceLanguage ?? existing?.voiceLanguage ?? "en",
    ollamaModel: input.ollamaModel ?? existing?.ollamaModel ?? "llama3.1:8b",
    ttsEngine: normalizeTtsEngine(input.ttsEngine ?? existing?.ttsEngine),
    ttsEnabled: input.ttsEnabled ?? existing?.ttsEnabled ?? true,
    sttEnabled: input.sttEnabled ?? existing?.sttEnabled ?? true,
    ttsConfig: mergedTtsConfig,
    systemPrompt: input.systemPrompt ?? existing?.systemPrompt ?? undefined,
    greetingEnabled: input.greetingEnabled ?? existing?.greetingEnabled ?? true,
    greetingInstruction: input.greetingInstruction ?? existing?.greetingInstruction ?? undefined,
  });

  return res.json({ data: settings });
});
