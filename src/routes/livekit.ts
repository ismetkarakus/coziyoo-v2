import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { askOllamaChat } from "../services/ollama.js";
import { transcribeAudio } from "../services/speech-to-text.js";
import { getStarterAgentSettings, upsertStarterAgentSettings } from "../services/starter-agent-settings.js";
import { synthesizeSpeech } from "../services/text-to-speech.js";
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
});

const AgentChatSchema = z.object({
  roomName: z.string().min(1).max(128),
  text: z.string().min(1).max(8_000),
});

const StarterSessionSchema = z.object({
  roomName: z.string().min(1).max(128).optional(),
  username: z.string().min(2).max(64),
  ttlSeconds: z.coerce.number().int().positive().max(86_400).optional(),
});

const StarterAgentChatSchema = z.object({
  roomName: z.string().min(1).max(128),
  text: z.string().min(1).max(8_000),
});

const StarterToolRunSchema = z.object({
  toolId: z.string().min(1).max(128),
  input: z.string().max(8_000).optional(),
  roomName: z.string().min(1).max(128).optional(),
  username: z.string().min(1).max(64).optional(),
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
  ttsEnabled: z.boolean(),
  sttEnabled: z.boolean(),
  systemPrompt: z.string().max(4_000).optional(),
  greetingEnabled: z.boolean().default(true),
  greetingInstruction: z.string().max(2_000).optional(),
});

const SttSchema = z.object({
  audioBase64: z.string().min(4),
  mimeType: z.string().min(3).optional(),
  language: z.string().min(2).max(16).optional(),
  prompt: z.string().max(2_000).optional(),
  temperature: z.number().min(0).max(1).optional(),
});

const TtsSchema = z.object({
  text: z.string().min(1).max(8_000),
  language: z.string().min(2).max(16).optional(),
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

liveKitRouter.post("/session/start", requireAuth("app"), async (req, res) => {
  const parsed = StartSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const roomName = input.roomName ?? `coziyoo-room-${crypto.randomUUID().slice(0, 8)}`;
  const userIdentity = input.participantIdentity ?? `user-${req.auth!.userId}`;
  const userMetadata = input.metadata ?? JSON.stringify({ userId: req.auth!.userId, role: req.auth!.role, source: "session-start" });

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
  const agentMetadata = JSON.stringify({ kind: "ai-agent", source: "session-start", roomName });
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

liveKitRouter.post("/stt/transcribe", requireAuth("app"), async (req, res) => {
  const parsed = SttSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  try {
    const result = await transcribeAudio(parsed.data);
    return res.status(201).json({
      data: {
        text: result.text,
        provider: env.SPEECH_TO_TEXT_BASE_URL,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Speech-to-text failed";
    if (message.includes("STT_AUDIO_TOO_LARGE")) {
      return res.status(413).json({
        error: {
          code: "STT_AUDIO_TOO_LARGE",
          message: `Audio payload is too large. Max bytes: ${env.SPEECH_TO_TEXT_MAX_AUDIO_BYTES}.`,
        },
      });
    }
    return res.status(502).json({
      error: {
        code: "STT_TRANSCRIBE_FAILED",
        message,
      },
    });
  }
});

liveKitRouter.post("/tts/synthesize", requireAuth("app"), async (req, res) => {
  const parsed = TtsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  try {
    const result = await synthesizeSpeech(parsed.data);
    res.setHeader("content-type", result.contentType);
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-tts-provider", env.TTS_BASE_URL ?? "");
    return res.status(200).send(result.audio);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Text-to-speech failed";
    if (message.includes("TTS_NOT_CONFIGURED")) {
      return res.status(503).json({
        error: {
          code: "TTS_NOT_CONFIGURED",
          message: "Set TTS_BASE_URL in API environment.",
        },
      });
    }
    return res.status(502).json({
      error: {
        code: "TTS_SYNTHESIZE_FAILED",
        message,
      },
    });
  }
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
  const userMetadata = JSON.stringify({ username, source: "livekit-react-starter" });

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
  const agentMetadata = JSON.stringify({ kind: "ai-agent", source: "starter-session", roomName });
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

liveKitRouter.post("/starter/stt/transcribe", async (req, res) => {
  const parsed = SttSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  try {
    const result = await transcribeAudio(parsed.data);
    return res.status(201).json({
      data: {
        text: result.text,
        provider: env.SPEECH_TO_TEXT_BASE_URL,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Speech-to-text failed";
    if (message.includes("STT_AUDIO_TOO_LARGE")) {
      return res.status(413).json({
        error: {
          code: "STT_AUDIO_TOO_LARGE",
          message: `Audio payload is too large. Max bytes: ${env.SPEECH_TO_TEXT_MAX_AUDIO_BYTES}.`,
        },
      });
    }
    return res.status(502).json({
      error: {
        code: "STT_TRANSCRIBE_FAILED",
        message,
      },
    });
  }
});

liveKitRouter.get("/starter/agent-settings/:deviceId", async (req, res) => {
  const parsed = StarterAgentSettingsParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

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
      agentName: settings.agentName,
      voiceLanguage: settings.voiceLanguage,
      ttsEnabled: settings.ttsEnabled,
      sttEnabled: settings.sttEnabled,
      systemPrompt: settings.systemPrompt,
      greetingEnabled: settings.greetingEnabled,
      greetingInstruction: settings.greetingInstruction,
      updatedAt: settings.updatedAt,
    },
  });
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

  const settings = await upsertStarterAgentSettings({
    deviceId: params.data.deviceId,
    agentName: parsed.data.agentName,
    voiceLanguage: parsed.data.voiceLanguage,
    ttsEnabled: parsed.data.ttsEnabled,
    sttEnabled: parsed.data.sttEnabled,
    systemPrompt: parsed.data.systemPrompt,
    greetingEnabled: parsed.data.greetingEnabled,
    greetingInstruction: parsed.data.greetingInstruction,
  });

  return res.status(200).json({
    data: {
      agentName: settings.agentName,
      voiceLanguage: settings.voiceLanguage,
      ttsEnabled: settings.ttsEnabled,
      sttEnabled: settings.sttEnabled,
      systemPrompt: settings.systemPrompt,
      greetingEnabled: settings.greetingEnabled,
      greetingInstruction: settings.greetingInstruction,
      updatedAt: settings.updatedAt,
    },
  });
});

liveKitRouter.post("/starter/tts/synthesize", async (req, res) => {
  const parsed = TtsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  try {
    const result = await synthesizeSpeech(parsed.data);
    res.setHeader("content-type", result.contentType);
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-tts-provider", env.TTS_BASE_URL ?? "");
    return res.status(200).send(result.audio);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Text-to-speech failed";
    if (message.includes("TTS_NOT_CONFIGURED")) {
      return res.status(503).json({
        error: {
          code: "TTS_NOT_CONFIGURED",
          message: "Set TTS_BASE_URL in API environment.",
        },
      });
    }
    return res.status(502).json({
      error: {
        code: "TTS_SYNTHESIZE_FAILED",
        message,
      },
    });
  }
});

liveKitRouter.get("/starter/tools/status", async (_req, res) => {
  const configured = Boolean(env.N8N_BASE_URL);
  if (!configured) {
    return res.status(200).json({
      data: {
        configured: false,
        reachable: false,
        baseUrl: null,
      },
    });
  }

  let reachable = false;
  try {
    const endpoint = new URL("/healthz", env.N8N_BASE_URL).toString();
    const headers = new Headers();
    if (env.N8N_API_KEY) {
      headers.set("x-n8n-api-key", env.N8N_API_KEY);
    }
    const response = await fetch(endpoint, {
      method: "GET",
      headers,
    });
    reachable = response.ok;
  } catch {
    reachable = false;
  }

  return res.status(200).json({
    data: {
      configured: true,
      reachable,
      baseUrl: env.N8N_BASE_URL,
    },
  });
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
  if (!env.N8N_BASE_URL) {
    return res.status(503).json({
      error: {
        code: "N8N_NOT_CONFIGURED",
        message: "Set N8N_BASE_URL in API environment.",
      },
    });
  }

  const input = parsed.data;
  const webhookPath = `/webhook/coziyoo/${encodeURIComponent(input.toolId)}`;
  const endpoint = new URL(webhookPath, env.N8N_BASE_URL).toString();
  const headers = new Headers({ "content-type": "application/json" });
  if (env.N8N_API_KEY) {
    headers.set("x-n8n-api-key", env.N8N_API_KEY);
    headers.set("authorization", `Bearer ${env.N8N_API_KEY}`);
  }

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        toolId: input.toolId,
        input: input.input ?? "",
        roomName: input.roomName ?? null,
        username: input.username ?? null,
        source: "livekit-react-starter",
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

    if (!upstream.ok) {
      return res.status(502).json({
        error: {
          code: "N8N_TOOL_RUN_FAILED",
          message: `n8n webhook failed (${upstream.status})`,
          endpoint,
          response: body,
        },
      });
    }

    return res.status(201).json({
      data: {
        endpoint,
        toolId: input.toolId,
        result: body,
      },
    });
  } catch (error) {
    return res.status(502).json({
      error: {
        code: "N8N_TOOL_RUN_FAILED",
        message: error instanceof Error ? error.message : "Failed to call n8n",
        endpoint,
      },
    });
  }
});
