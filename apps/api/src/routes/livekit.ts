import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { getN8nStatus, runN8nToolWebhook, sendSessionEndEvent } from "../services/n8n.js";
import { askOllamaChat, listOllamaModels } from "../services/ollama.js";
import { resolveProviders } from "../services/resolve-providers.js";
import { getStarterAgentSettings, upsertStarterAgentSettings } from "../services/starter-agent-settings.js";
import { TTS_ENGINES } from "../services/tts-engines.js";
import {
  buildRoomScopedAgentIdentity,
  dispatchAgentJoin,
  ensureLiveKitRoom,
  isLiveKitConfigured,
  isParticipantInRoom,
  mintLiveKitToken,
  sendRoomData,
} from "../services/livekit.js";

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

const StartSessionSchema = z.object({
  roomName: z.string().min(1).max(128).optional(),
  participantIdentity: z.string().min(3).max(128).optional(),
  participantName: z.string().min(1).max(128).optional(),
  metadata: z.string().max(2_000).optional(),
  ttlSeconds: z.coerce.number().int().positive().max(86_400).optional(),
  autoDispatchAgent: z.boolean().default(true),
  locale: z.string().max(32).optional(),
  campaignId: z.string().max(128).optional(),
  leadId: z.string().max(128).optional(),
  channel: z.string().max(64).optional(),
  deviceId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  settingsProfileId: z.string().max(128).optional(),
});

const EndSessionSchema = z.object({
  roomName: z.string().min(1).max(128),
  jobId: z.string().max(256).optional(),
  userIdentity: z.string().max(256).optional(),
  agentIdentity: z.string().max(256).optional(),
  summary: z.string().min(1).max(32_000),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
  outcome: z.string().max(128).optional(),
  sentiment: z.string().max(64).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  deviceId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
});

const AgentChatSchema = z.object({
  roomName: z.string().min(1).max(128),
  text: z.string().min(1).max(8_000),
});

const MobileTelemetrySchema = z.object({
  level: z.enum(["info", "warn", "error"]),
  eventType: z.string().min(1).max(128),
  message: z.string().min(1).max(2_000),
  roomName: z.string().min(1).max(128).optional(),
  requestId: z.string().max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const StarterSessionSchema = z.object({
  roomName: z.string().min(1).max(128).optional(),
  username: z.string().min(2).max(64),
  deviceId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/),
  ttlSeconds: z.coerce.number().int().positive().max(86_400).optional(),
});

const StarterAgentChatSchema = z.object({
  roomName: z.string().min(1).max(128),
  text: z.string().min(1).max(8_000),
  deviceId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
});

const StarterToolRunSchema = z.object({
  toolId: z.string().min(1).max(128),
  input: z.string().max(8_000).optional(),
  roomName: z.string().min(1).max(128).optional(),
  username: z.string().min(1).max(64).optional(),
  deviceId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
});

const StarterAgentSettingsParamsSchema = z.object({
  deviceId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/),
});

const StarterAgentSettingsSchema = z.object({
  agentName: z.string().max(128),
  voiceLanguage: z.string().min(2).max(16).regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
  ollamaModel: z.string().min(1).max(128).default(env.OLLAMA_CHAT_MODEL),
  ttsEngine: z.enum(TTS_ENGINES).default("f5-tts"),
  activeTtsServerId: z.string().max(128).optional(),
  ttsServers: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        name: z.string().min(1).max(128),
        engine: z.enum(TTS_ENGINES),
        config: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .max(20)
    .optional(),
  ttsConfig: z
    .object({
      baseUrl: z.string().url().optional(),
      path: z.string().max(256).optional(),
      f5: z
        .object({
          speakerId: z.string().max(128).optional(),
          speakerWavPath: z.string().max(1_024).optional(),
        })
        .optional(),
      xtts: z
        .object({
          speakerWavUrl: z.string().url().optional(),
        })
        .optional(),
      chatterbox: z
        .object({
          voiceMode: z.enum(["predefined", "clone"]).optional(),
          predefinedVoiceId: z.string().max(256).optional(),
          referenceAudioFilename: z.string().max(256).optional(),
          outputFormat: z.enum(["wav", "opus"]).optional(),
          splitText: z.boolean().optional(),
          chunkSize: z.number().int().min(50).max(500).optional(),
          temperature: z.number().min(0.1).max(1.5).optional(),
          exaggeration: z.number().optional(),
          cfgWeight: z.number().optional(),
          seed: z.number().int().optional(),
          speedFactor: z.number().positive().optional(),
        })
        .optional(),
    })
    .passthrough()
    .optional(),
  sttProvider: z.string().max(64).optional(),
  sttBaseUrl: z.string().url().optional(),
  sttTranscribePath: z.string().max(256).optional(),
  sttModel: z.string().max(128).optional(),
  ollamaBaseUrl: z.string().url().optional(),
  n8nBaseUrl: z.string().url().optional(),
  ttsEnabled: z.boolean(),
  sttEnabled: z.boolean(),
  systemPrompt: z.string().max(4_000).optional(),
  greetingEnabled: z.boolean().default(true),
  greetingInstruction: z.string().max(2_000).optional(),
});

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isValidSharedSecret(providedSecret: string) {
  if (!env.AI_SERVER_SHARED_SECRET) return false;
  const providedBuffer = Buffer.from(providedSecret, "utf8");
  const expectedBuffer = Buffer.from(env.AI_SERVER_SHARED_SECRET, "utf8");
  return (
    providedSecret.length > 0 &&
    providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

function readProviderConfigFromTtsConfig(raw: Record<string, unknown> | null | undefined) {
  const sttConfig =
    raw && typeof raw.stt === "object" && raw.stt !== null
      ? (raw.stt as Record<string, unknown>)
      : {};
  const llmConfig =
    raw && typeof raw.llm === "object" && raw.llm !== null
      ? (raw.llm as Record<string, unknown>)
      : {};
  const n8nConfig =
    raw && typeof raw.n8n === "object" && raw.n8n !== null
      ? (raw.n8n as Record<string, unknown>)
      : {};

  return {
    sttProvider: typeof sttConfig.provider === "string" ? sttConfig.provider : "remote-speech-server",
    sttBaseUrl: typeof sttConfig.baseUrl === "string" ? sttConfig.baseUrl : null,
    sttTranscribePath: typeof sttConfig.transcribePath === "string" ? sttConfig.transcribePath : env.SPEECH_TO_TEXT_TRANSCRIBE_PATH,
    sttModel: typeof sttConfig.model === "string" ? sttConfig.model : env.SPEECH_TO_TEXT_MODEL,
    ollamaBaseUrl: typeof llmConfig.ollamaBaseUrl === "string" ? llmConfig.ollamaBaseUrl : null,
    n8nBaseUrl: typeof n8nConfig.baseUrl === "string" ? n8nConfig.baseUrl : null,
  };
}

function buildMergedTtsConfig(input: z.infer<typeof StarterAgentSettingsSchema>) {
  const base = ((input.ttsConfig ?? {}) as Record<string, unknown>) ?? {};
  const current = readProviderConfigFromTtsConfig(base);

  const stt = {
    provider: input.sttProvider ?? current.sttProvider ?? "remote-speech-server",
    baseUrl: input.sttBaseUrl ?? current.sttBaseUrl ?? null,
    transcribePath: input.sttTranscribePath ?? current.sttTranscribePath ?? env.SPEECH_TO_TEXT_TRANSCRIBE_PATH,
    model: input.sttModel ?? current.sttModel ?? env.SPEECH_TO_TEXT_MODEL,
  };
  const llm = {
    ollamaBaseUrl: input.ollamaBaseUrl ?? current.ollamaBaseUrl ?? null,
  };
  const n8n = {
    baseUrl: input.n8nBaseUrl ?? current.n8nBaseUrl ?? null,
  };

  return {
    ...base,
    stt,
    llm,
    n8n,
  };
}

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
  if (!isValidSharedSecret(provided)) {
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

liveKitRouter.post("/session/end", async (req, res) => {
  if (!env.AI_SERVER_SHARED_SECRET) {
    return res.status(503).json({
      error: {
        code: "AI_SERVER_SHARED_SECRET_MISSING",
        message: "Set AI_SERVER_SHARED_SECRET before using /v1/livekit/session/end.",
      },
    });
  }

  const provided = String(req.headers["x-ai-server-secret"] ?? "");
  if (!isValidSharedSecret(provided)) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Invalid AI server shared secret" },
    });
  }

  const parsed = EndSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  let n8nBaseUrlOverride: string | null = null;
  if (input.deviceId) {
    const settings = await getStarterAgentSettings(input.deviceId);
    const ttsConfig = (settings?.ttsConfig as Record<string, unknown> | null) ?? null;
    const n8nConfig =
      ttsConfig && typeof ttsConfig.n8n === "object" && ttsConfig.n8n !== null
        ? (ttsConfig.n8n as Record<string, unknown>)
        : {};
    n8nBaseUrlOverride =
      typeof n8nConfig.baseUrl === "string" && n8nConfig.baseUrl.trim().length > 0
        ? n8nConfig.baseUrl.trim()
        : null;
  }

  try {
    const upstream = await sendSessionEndEvent({
      roomName: input.roomName,
      jobId: input.jobId,
      userIdentity: input.userIdentity,
      agentIdentity: input.agentIdentity,
      summary: input.summary,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      outcome: input.outcome,
      sentiment: input.sentiment,
      metadata: input.metadata,
      baseUrl: n8nBaseUrlOverride,
    });
    if (!upstream.ok) {
      return res.status(502).json({
        error: {
          code: "N8N_SESSION_END_FAILED",
          message: `n8n webhook failed (${upstream.status})`,
          endpoint: upstream.endpoint,
          response: upstream.body,
        },
      });
    }

    return res.status(201).json({
      data: {
        endpoint: upstream.endpoint,
        delivered: true,
        response: upstream.body,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("N8N_NOT_CONFIGURED")) {
      return res.status(503).json({
        error: {
          code: "N8N_NOT_CONFIGURED",
          message: "Set N8N_BASE_URL in API environment or save n8n.baseUrl in device settings.",
        },
      });
    }
    return res.status(502).json({
      error: {
        code: "N8N_SESSION_END_FAILED",
        message: error instanceof Error ? error.message : "Failed to call n8n session-end webhook",
      },
    });
  }
});

liveKitRouter.post("/session/start", requireAuth("app"), async (req, res) => {
  const parsed = StartSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const roomName = input.roomName ?? `coziyoo-room-${crypto.randomUUID().slice(0, 8)}`;
  const userIdentity = input.participantIdentity ?? `user-${req.auth!.userId}`;
  const userMetadata =
    input.metadata ??
    JSON.stringify({
      userId: req.auth!.userId,
      role: req.auth!.role,
      source: "session-start",
      locale: input.locale ?? null,
      campaignId: input.campaignId ?? null,
      leadId: input.leadId ?? null,
      channel: input.channel ?? "mobile",
      deviceId: input.deviceId ?? null,
      settingsProfileId: input.settingsProfileId ?? null,
    });

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

  const agentIdentity = buildRoomScopedAgentIdentity(roomName);
  const agentName = env.LIVEKIT_AGENT_IDENTITY;
  const agentMetadata = JSON.stringify({
    kind: "ai-agent",
    source: "session-start",
    roomName,
    locale: input.locale ?? null,
    campaignId: input.campaignId ?? null,
    leadId: input.leadId ?? null,
    channel: input.channel ?? "mobile",
    deviceId: input.deviceId ?? null,
    settingsProfileId: input.settingsProfileId ?? null,
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

  let dispatch: { endpoint: string; ok: boolean; status: number; body: unknown } | null = null;
  let alreadyRunning = false;
  if (input.autoDispatchAgent) {
    try {
      alreadyRunning = await isParticipantInRoom(roomName, agentIdentity);
      if (!alreadyRunning) {
        dispatch = await dispatchAgentJoin({
          roomName,
          participantIdentity: agentIdentity,
          participantName: agentName,
          token: agentToken,
          metadata: agentMetadata,
          payload: {
            locale: input.locale ?? null,
            campaignId: input.campaignId ?? null,
            leadId: input.leadId ?? null,
            channel: input.channel ?? "mobile",
            deviceId: input.deviceId ?? null,
            settingsProfileId: input.settingsProfileId ?? null,
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent dispatch failed";
      dispatch = {
        endpoint: env.AI_SERVER_URL
          ? new URL(env.AI_SERVER_LIVEKIT_JOIN_PATH, env.AI_SERVER_URL).toString()
          : "AI_SERVER_URL_NOT_CONFIGURED",
        ok: false,
        status: 0,
        body: { error: { code: "AI_SERVER_DISPATCH_FAILED", message } },
      };
    }
  }

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
      },
    },
  });
});

liveKitRouter.post("/agent/chat", requireAuth("app"), async (req, res) => {
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

liveKitRouter.post("/mobile/telemetry", requireAuth("app"), async (req, res) => {
  const parsed = MobileTelemetrySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const context = {
    userId: req.auth?.userId,
    role: req.auth?.role,
    eventType: input.eventType,
    level: input.level,
    roomName: input.roomName ?? null,
    requestId: input.requestId ?? null,
    metadata: input.metadata ?? null,
  };

  const sink = input.level === "error" ? console.error : input.level === "warn" ? console.warn : console.log;
  sink("[mobile-telemetry]", input.message, context);

  return res.status(201).json({ data: { accepted: true } });
});

liveKitRouter.post("/starter/session/start", async (req, res) => {
  const parsed = StarterSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const roomName = input.roomName ?? `coziyoo-room-${crypto.randomUUID().slice(0, 8)}`;
  const username = input.username.trim();
  const userIdentity = `starter-${username.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 48)}-${crypto.randomUUID().slice(0, 6)}`;
  const settings = await getStarterAgentSettings(input.deviceId);
  const resolved = resolveProviders(settings);

  const userMetadata = JSON.stringify({
    username,
    source: "agent",
    deviceId: input.deviceId,
    providers: resolved,
  });

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
    name: username,
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

  const agentIdentity = buildRoomScopedAgentIdentity(roomName);
  const agentName = env.LIVEKIT_AGENT_IDENTITY;
  const agentMetadata = JSON.stringify({
    kind: "ai-agent",
    source: "starter-session",
    roomName,
    deviceId: input.deviceId,
    providers: resolved,
    systemPrompt: settings?.systemPrompt ?? null,
    greetingEnabled: settings?.greetingEnabled ?? true,
    greetingInstruction: settings?.greetingInstruction ?? null,
    voiceLanguage: settings?.voiceLanguage ?? "en",
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

  let dispatch: { endpoint: string; ok: boolean; status: number; body: unknown } | null = null;
  let alreadyRunning = false;
  try {
    alreadyRunning = await isParticipantInRoom(roomName, agentIdentity);
    if (!alreadyRunning) {
      dispatch = await dispatchAgentJoin({
        roomName,
        participantIdentity: agentIdentity,
        participantName: agentName,
        token: agentToken,
        metadata: agentMetadata,
        voiceMode: "assistant_native_audio",
        payload: {
          deviceId: input.deviceId,
          providers: resolved,
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent dispatch failed";
    dispatch = {
      endpoint: env.AI_SERVER_URL
        ? new URL(env.AI_SERVER_LIVEKIT_JOIN_PATH, env.AI_SERVER_URL).toString()
        : "AI_SERVER_URL_NOT_CONFIGURED",
      ok: false,
      status: 0,
      body: { error: { code: "AI_SERVER_DISPATCH_FAILED", message } },
    };
  }

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
      },
    },
  });
});

liveKitRouter.post("/starter/agent/chat", async (req, res) => {
  const parsed = StarterAgentChatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const agentIdentity = buildRoomScopedAgentIdentity(input.roomName);

  try {
    const headerDeviceId = String(req.headers["x-device-id"] ?? "").trim();
    const candidateDeviceId = input.deviceId?.trim() || headerDeviceId;
    const validDeviceId = /^[a-zA-Z0-9_-]{8,128}$/.test(candidateDeviceId) ? candidateDeviceId : "";
    const settings = validDeviceId ? await getStarterAgentSettings(validDeviceId) : null;
    const activeTtsServer =
      settings?.ttsServers?.find((server) => server.id === settings.activeTtsServerId) ??
      settings?.ttsServers?.[0] ??
      null;
    const activeTtsConfig = ((activeTtsServer?.config as Record<string, unknown> | undefined) ??
      (settings?.ttsConfig as Record<string, unknown> | null) ??
      {}) as Record<string, unknown>;
    const llmConfig =
      activeTtsConfig.llm && typeof activeTtsConfig.llm === "object"
        ? (activeTtsConfig.llm as Record<string, unknown>)
        : {};
    const ollamaBaseUrl =
      typeof llmConfig.ollamaBaseUrl === "string" && llmConfig.ollamaBaseUrl.trim().length > 0
        ? llmConfig.ollamaBaseUrl.trim()
        : undefined;
    const answer = await askOllamaChat(input.text, {
      model: settings?.ollamaModel,
      baseUrl: ollamaBaseUrl,
    });
    const payload = {
      type: "agent_message",
      from: agentIdentity,
      text: answer.text,
      ts: new Date().toISOString(),
      model: answer.model,
      ttsEngine: activeTtsServer?.engine ?? settings?.ttsEngine ?? "f5-tts",
      ttsProfileId: activeTtsServer?.id ?? settings?.activeTtsServerId ?? null,
      ttsProfileName: activeTtsServer?.name ?? null,
      ttsConfig: activeTtsConfig,
      tts: {
        engine: activeTtsServer?.engine ?? settings?.ttsEngine ?? "f5-tts",
        profileId: activeTtsServer?.id ?? settings?.activeTtsServerId ?? null,
        profileName: activeTtsServer?.name ?? null,
        baseUrl:
          typeof activeTtsConfig.baseUrl === "string" && activeTtsConfig.baseUrl.trim().length > 0
            ? activeTtsConfig.baseUrl.trim()
            : null,
        path:
          typeof activeTtsConfig.path === "string" && activeTtsConfig.path.trim().length > 0
            ? activeTtsConfig.path.trim()
            : null,
        language: settings?.voiceLanguage ?? "tr",
        config: activeTtsConfig,
      },
      audioPublished: false,
      audioErrorCode: "API_TEXT_ONLY_PATH",
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

liveKitRouter.get("/starter/ollama/models", async (_req, res) => {
  try {
    const result = await listOllamaModels();
    return res.status(200).json({
      data: {
        baseUrl: env.OLLAMA_BASE_URL,
        endpoint: result.endpoint,
        defaultModel: env.OLLAMA_CHAT_MODEL,
        models: result.models,
      },
    });
  } catch (error) {
    return res.status(502).json({
      error: {
        code: "OLLAMA_MODELS_FETCH_FAILED",
        message: error instanceof Error ? error.message : "Failed to fetch Ollama models",
      },
    });
  }
});

liveKitRouter.get("/starter/agent-settings/:deviceId", async (req, res) => {
  const parsed = StarterAgentSettingsParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  try {
    const settings = await getStarterAgentSettings(parsed.data.deviceId);
    if (!settings) {
      return res.status(404).json({
        error: {
          code: "STARTER_AGENT_SETTINGS_NOT_FOUND",
          message: "No settings found for this device.",
        },
      });
    }

    return res.status(200).json({
      data: {
        ...readProviderConfigFromTtsConfig(settings.ttsConfig as Record<string, unknown> | null),
        agentName: settings.agentName,
        voiceLanguage: settings.voiceLanguage,
        ollamaModel: settings.ollamaModel,
        ttsEngine: settings.ttsEngine,
        activeTtsServerId: settings.activeTtsServerId,
        ttsServers: settings.ttsServers,
        ttsConfig: settings.ttsConfig,
        ttsEnabled: settings.ttsEnabled,
        sttEnabled: settings.sttEnabled,
        systemPrompt: settings.systemPrompt,
        greetingEnabled: settings.greetingEnabled,
        greetingInstruction: settings.greetingInstruction,
        updatedAt: settings.updatedAt,
      },
    });
  } catch (error) {
    return res.status(502).json({
      error: {
        code: "STARTER_AGENT_SETTINGS_FETCH_FAILED",
        message: error instanceof Error ? error.message : "Failed to fetch starter agent settings.",
      },
    });
  }
});

liveKitRouter.put("/starter/agent-settings/:deviceId", async (req, res) => {
  const params = StarterAgentSettingsParamsSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = StarterAgentSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  try {
    const mergedTtsConfig = buildMergedTtsConfig(parsed.data);
    const settings = await upsertStarterAgentSettings({
      deviceId: params.data.deviceId,
      agentName: parsed.data.agentName,
      voiceLanguage: parsed.data.voiceLanguage,
      ollamaModel: parsed.data.ollamaModel,
      ttsEngine: parsed.data.ttsEngine,
      activeTtsServerId: parsed.data.activeTtsServerId,
      ttsServers: parsed.data.ttsServers,
      ttsConfig: mergedTtsConfig,
      ttsEnabled: parsed.data.ttsEnabled,
      sttEnabled: parsed.data.sttEnabled,
      systemPrompt: parsed.data.systemPrompt,
      greetingEnabled: parsed.data.greetingEnabled,
      greetingInstruction: parsed.data.greetingInstruction,
    });

    return res.status(200).json({
      data: {
        ...readProviderConfigFromTtsConfig(settings.ttsConfig as Record<string, unknown> | null),
        agentName: settings.agentName,
        voiceLanguage: settings.voiceLanguage,
        ollamaModel: settings.ollamaModel,
        ttsEngine: settings.ttsEngine,
        activeTtsServerId: settings.activeTtsServerId,
        ttsServers: settings.ttsServers,
        ttsConfig: settings.ttsConfig,
        ttsEnabled: settings.ttsEnabled,
        sttEnabled: settings.sttEnabled,
        systemPrompt: settings.systemPrompt,
        greetingEnabled: settings.greetingEnabled,
        greetingInstruction: settings.greetingInstruction,
        updatedAt: settings.updatedAt,
      },
    });
  } catch (error) {
    return res.status(502).json({
      error: {
        code: "STARTER_AGENT_SETTINGS_SAVE_FAILED",
        message: error instanceof Error ? error.message : "Failed to save starter agent settings.",
      },
    });
  }
});

liveKitRouter.post("/starter/agent-settings/:deviceId/test/stt", async (req, res) => {
  const parsed = StarterAgentSettingsParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const settings = await getStarterAgentSettings(parsed.data.deviceId);
  const ttsConfig = (settings?.ttsConfig as Record<string, unknown> | null) ?? null;
  const sttConfig =
    ttsConfig && typeof ttsConfig.stt === "object" && ttsConfig.stt !== null
      ? (ttsConfig.stt as Record<string, unknown>)
      : {};

  const baseUrl =
    typeof sttConfig.baseUrl === "string" && sttConfig.baseUrl.trim().length > 0
      ? sttConfig.baseUrl.trim()
      : env.SPEECH_TO_TEXT_BASE_URL;
  const transcribePath =
    typeof sttConfig.transcribePath === "string" && sttConfig.transcribePath.trim().length > 0
      ? sttConfig.transcribePath.trim()
      : env.SPEECH_TO_TEXT_TRANSCRIBE_PATH;
  const model =
    typeof sttConfig.model === "string" && sttConfig.model.trim().length > 0
      ? sttConfig.model.trim()
      : env.SPEECH_TO_TEXT_MODEL;

  if (!baseUrl) {
    return res.status(503).json({
      error: {
        code: "STT_NOT_CONFIGURED",
        message: "Set SPEECH_TO_TEXT_BASE_URL or save stt.baseUrl in device settings.",
      },
    });
  }

  const endpoint = new URL(transcribePath, baseUrl).toString();

  try {
    const optionsResp = await fetchWithTimeout(endpoint, { method: "OPTIONS" }, Math.min(env.SPEECH_TO_TEXT_TIMEOUT_MS, 10_000));
    if (optionsResp.ok || optionsResp.status === 405 || optionsResp.status === 415) {
      return res.status(200).json({
        data: {
          configured: true,
          reachable: true,
          endpoint,
          status: optionsResp.status,
          model,
        },
      });
    }

    return res.status(502).json({
      error: {
        code: "STT_TEST_FAILED",
        message: `STT endpoint responded with HTTP ${optionsResp.status}`,
        endpoint,
      },
    });
  } catch (error) {
    return res.status(502).json({
      error: {
        code: "STT_TEST_FAILED",
        message: error instanceof Error ? error.message : "Failed to reach STT endpoint",
        endpoint,
      },
    });
  }
});

liveKitRouter.post("/starter/agent-settings/:deviceId/test/ollama", async (req, res) => {
  const parsed = StarterAgentSettingsParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const settings = await getStarterAgentSettings(parsed.data.deviceId);
  const ttsConfig = (settings?.ttsConfig as Record<string, unknown> | null) ?? null;
  const llmConfig =
    ttsConfig && typeof ttsConfig.llm === "object" && ttsConfig.llm !== null
      ? (ttsConfig.llm as Record<string, unknown>)
      : {};
  const ollamaBaseUrl =
    typeof llmConfig.ollamaBaseUrl === "string" && llmConfig.ollamaBaseUrl.trim().length > 0
      ? llmConfig.ollamaBaseUrl.trim()
      : undefined;

  try {
    const result = await listOllamaModels({ baseUrl: ollamaBaseUrl });
    return res.status(200).json({
      data: {
        reachable: true,
        endpoint: result.endpoint,
        modelCount: result.models.length,
        model: settings?.ollamaModel ?? env.OLLAMA_CHAT_MODEL,
      },
    });
  } catch (error) {
    return res.status(502).json({
      error: {
        code: "OLLAMA_TEST_FAILED",
        message: error instanceof Error ? error.message : "Failed to reach Ollama",
      },
    });
  }
});

liveKitRouter.post("/starter/agent-settings/:deviceId/test/n8n", async (req, res) => {
  const parsed = StarterAgentSettingsParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const settings = await getStarterAgentSettings(parsed.data.deviceId);
  const ttsConfig = (settings?.ttsConfig as Record<string, unknown> | null) ?? null;
  const n8nConfig =
    ttsConfig && typeof ttsConfig.n8n === "object" && ttsConfig.n8n !== null
      ? (ttsConfig.n8n as Record<string, unknown>)
      : {};
  const n8nBaseUrl =
    typeof n8nConfig.baseUrl === "string" && n8nConfig.baseUrl.trim().length > 0
      ? n8nConfig.baseUrl.trim()
      : null;

  const status = await getN8nStatus({ baseUrl: n8nBaseUrl });
  return res.status(200).json({
    data: status,
  });
});

liveKitRouter.get("/starter/tools/status", async (_req, res) => {
  const rawDeviceId = String(_req.query.deviceId ?? "").trim();
  let n8nBaseUrlOverride: string | null = null;
  if (/^[a-zA-Z0-9_-]{8,128}$/.test(rawDeviceId)) {
    const settings = await getStarterAgentSettings(rawDeviceId);
    const ttsConfig = (settings?.ttsConfig as Record<string, unknown> | null) ?? null;
    const n8nConfig =
      ttsConfig && typeof ttsConfig.n8n === "object" && ttsConfig.n8n !== null
        ? (ttsConfig.n8n as Record<string, unknown>)
        : {};
    n8nBaseUrlOverride =
      typeof n8nConfig.baseUrl === "string" && n8nConfig.baseUrl.trim().length > 0
        ? n8nConfig.baseUrl.trim()
        : null;
  }

  const status = await getN8nStatus({ baseUrl: n8nBaseUrlOverride });
  return res.status(200).json({ data: status });
});

liveKitRouter.get("/starter/tools/registry", async (_req, res) => {
  try {
    const response = await fetch(env.TOOLS_REGISTRY_URL, { method: "GET" });
    const raw = await response.text();

    if (!response.ok) {
      return res.status(502).json({
        error: {
          code: "TOOLS_REGISTRY_FETCH_FAILED",
          message: `Registry request failed (${response.status})`,
        },
      });
    }

    const payload = raw ? (JSON.parse(raw) as unknown) : null;
    const tools =
      payload && typeof payload === "object" && "tools" in payload && Array.isArray((payload as { tools?: unknown }).tools)
        ? ((payload as { tools: unknown[] }).tools ?? [])
            .filter((item) => typeof item === "object" && item !== null)
            .map((item) => {
              const value = item as Record<string, unknown>;
              return {
                id: String(value.id ?? value.name ?? crypto.randomUUID()),
                name: String(value.name ?? value.id ?? "Tool"),
                description: typeof value.description === "string" ? value.description : "",
                webhookPath: typeof value.webhookPath === "string" ? value.webhookPath : null,
                method: typeof value.method === "string" ? value.method : "POST",
              };
            })
        : [];

    return res.status(200).json({
      data: {
        source: env.TOOLS_REGISTRY_URL,
        tools,
      },
    });
  } catch (error) {
    return res.status(502).json({
      error: {
        code: "TOOLS_REGISTRY_FETCH_FAILED",
        message: error instanceof Error ? error.message : "Failed to fetch tools registry",
      },
    });
  }
});

liveKitRouter.post("/starter/tools/run", async (req, res) => {
  const parsed = StarterToolRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  let n8nBaseUrlOverride: string | null = null;
  if (input.deviceId) {
    const settings = await getStarterAgentSettings(input.deviceId);
    const ttsConfig = (settings?.ttsConfig as Record<string, unknown> | null) ?? null;
    const n8nConfig =
      ttsConfig && typeof ttsConfig.n8n === "object" && ttsConfig.n8n !== null
        ? (ttsConfig.n8n as Record<string, unknown>)
        : {};
    n8nBaseUrlOverride =
      typeof n8nConfig.baseUrl === "string" && n8nConfig.baseUrl.trim().length > 0
        ? n8nConfig.baseUrl.trim()
        : null;
  }

  try {
    const upstream = await runN8nToolWebhook({
      toolId: input.toolId,
      toolInput: input.input,
      roomName: input.roomName,
      username: input.username,
      baseUrl: n8nBaseUrlOverride,
    });
    if (!upstream.ok) {
      return res.status(502).json({
        error: {
          code: "N8N_TOOL_RUN_FAILED",
          message: `n8n webhook failed (${upstream.status})`,
          endpoint: upstream.endpoint,
          response: upstream.body,
        },
      });
    }

    return res.status(201).json({
      data: {
        endpoint: upstream.endpoint,
        toolId: input.toolId,
        result: upstream.body,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("N8N_NOT_CONFIGURED")) {
      return res.status(503).json({
        error: {
          code: "N8N_NOT_CONFIGURED",
          message: "Set N8N_BASE_URL in API environment or save n8n.baseUrl in device settings.",
        },
      });
    }
    return res.status(502).json({
      error: {
        code: "N8N_TOOL_RUN_FAILED",
        message: error instanceof Error ? error.message : "Failed to call n8n",
      },
    });
  }
});
